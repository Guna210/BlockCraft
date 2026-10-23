import { isItemAffix, items } from './items';
import { smelting } from './smelting';
import {
  blockEntityRegistry,
  type BlockEntityInstance,
  type JsonValue,
} from '../world/block-entities';
import { BlockRegistry } from '../world/blocks/registry';
import type { World } from '../world/world';
import type { ItemEntityManager } from '../entity/item-entity';

export const COOK_TICKS_PER_ITEM = 200; // 10 seconds at 20 tps

export interface KilnSlot {
  id: string;
  count: number;
  damage: number | null;
  [key: string]: JsonValue;
}

export interface KilnState {
  input: KilnSlot | null;
  fuel: KilnSlot | null;
  output: KilnSlot | null;
  burnRemaining: number;
  burnTotal: number;
  cookProgress: number;
  storedXp: number;
  [key: string]: JsonValue;
}

export function createKilnState(_x: number, _y: number, _z: number, _stateId: number): KilnState {
  return {
    input: null,
    fuel: null,
    output: null,
    burnRemaining: 0,
    burnTotal: 0,
    cookProgress: 0,
    storedXp: 0,
  };
}

export function canSmelt(state: KilnState): boolean {
  if (!state.input || state.input.count <= 0) return false;
  const recipe = smelting.getByInput(state.input.id);
  if (!recipe) return false;
  if (!state.output) return true;
  if (state.output.id !== recipe.output) return false;
  const max = items.get(recipe.output).maxStack;
  return state.output.count + recipe.count <= max;
}

export function tickKiln(entity: BlockEntityInstance<KilnState>, world: World): void {
  const state = entity.state;
  const smeltable = canSmelt(state);

  // If burning out or extinguished and there is a smeltable recipe, consume fuel if available
  if (state.burnRemaining <= 0 && smeltable && state.fuel && state.fuel.count > 0) {
    const burnTime = smelting.getBurnTime(state.fuel.id);
    if (burnTime > 0) {
      state.fuel.count--;
      if (state.fuel.count <= 0) state.fuel = null;
      state.burnTotal = burnTime;
      state.burnRemaining = burnTime;
    }
  }

  // If currently burning fuel
  if (state.burnRemaining > 0) {
    state.burnRemaining--;
    if (smeltable) {
      state.cookProgress++;
      if (state.cookProgress >= COOK_TICKS_PER_ITEM) {
        const recipe = smelting.getByInput(state.input!.id)!;
        if (!state.output) {
          state.output = { id: recipe.output, count: recipe.count, damage: null };
        } else {
          state.output.count += recipe.count;
        }
        state.input!.count--;
        if (state.input!.count <= 0) state.input = null;
        state.storedXp += recipe.xp;
        state.cookProgress = 0;
      }
    } else if (state.cookProgress > 0) {
      state.cookProgress = Math.max(0, state.cookProgress - 2);
    }
  } else if (state.cookProgress > 0) {
    state.cookProgress = Math.max(0, state.cookProgress - 2);
  }

  // Synchronize lit block state in world (emission 13 and lit texture)
  const isLit = state.burnRemaining > 0;
  const currentStateId = world.getBlockStateId(entity.x, entity.y, entity.z);
  const resolved = BlockRegistry.getInstance().getResolvedState(currentStateId);
  if (resolved && resolved.blockId === 'kiln') {
    const currentLit = String(resolved.properties.lit) === 'true';
    if (currentLit !== isLit) {
      const facing = (resolved.properties.facing as string) || 'north';
      const newStateId = BlockRegistry.getInstance().getStateId('kiln', {
        facing,
        lit: isLit ? 'true' : 'false',
      });
      if (newStateId !== undefined) {
        world.setBlockStateId(entity.x, entity.y, entity.z, newStateId);
      }
    }
  }
}

export function registerKilnBlockEntity(): void {
  if (blockEntityRegistry.has('kiln')) return;
  if (!BlockRegistry.getInstance().getBlockDefinition('kiln')) return;
  blockEntityRegistry.register<KilnState>({
    blockId: 'kiln',
    tickInterval: 1,
    create: (x, y, z, stateId) => createKilnState(x, y, z, stateId),
    tick: (entity, world) => tickKiln(entity, world),
    container: (entity) => ({
      slots: [entity.state.input, entity.state.fuel, entity.state.output],
    }),
  });
}

/** Spawns a kiln's input, fuel and output as item entities; false (nothing spawned) if the pool is short. */
export function spillKilnContents(
  world: World,
  entities: ItemEntityManager,
  x: number,
  y: number,
  z: number,
): boolean {
  const state = world.getBlockEntity<KilnState>(x, y, z);
  if (!state) return true;
  const stacks = [state.input, state.fuel, state.output].filter(
    (stack): stack is NonNullable<KilnState['input']> => !!stack && stack.count > 0,
  );
  const free = entities.pool.reduce((count, entity) => count + Number(!entity.active), 0);
  if (stacks.length > free) return false;
  for (const stack of stacks)
    if (
      !entities.spawn(stack.id, stack.count, x + 0.5, y + 0.5, z + 0.5, undefined, {
        damage: stack.damage,
        ...(isItemAffix(stack['affix']) ? { affix: stack['affix'] } : {}),
      })
    )
      return false;
  return true;
}

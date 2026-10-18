import { items } from '../items';
import { blockEntityRegistry, type BlockEntityState } from '../../world/block-entities';
import { BlockRegistry } from '../../world/blocks/registry';
import type { BlockTick } from '../../world/ticks';
import type { World } from '../../world/world';
import {
  CURRENT_BLOCK_IDS,
  FACING_OFFSET,
  HORIZONTAL_OFFSETS,
  NEIGHBOR_OFFSETS,
  comparePositions,
  offsetPosition,
  oppositeFacing,
  positionKey,
  type BlockPosition,
  type CurrentFacing,
} from './types';

export * from './types';

export const CURRENT_RELAY_TICK = 'current_relay';
export const CURRENT_BUTTON_RELEASE_TICK = 'current_button_release';
export const CURRENT_TORCH_COOLDOWN_TICK = 'current_torch_cooldown';
export const TORCH_BURNOUT_WINDOW = 60;
export const TORCH_BURNOUT_THRESHOLD = 8;
export const TORCH_COOLDOWN_TICKS = 160;

/** Lower priorities execute first; source timers precede delayed relay transitions. */
export const CURRENT_TICK_PRIORITY = {
  source: 0,
  relay: 1,
} as const;

export interface InverterTorchState extends BlockEntityState {
  toggleTicks: number[];
  coolingUntil: number;
}

export interface GaugeState extends BlockEntityState {
  outputLevel: number;
}

export function registerCurrentBlockEntities(): void {
  const registry = BlockRegistry.getInstance();
  if (registry.getBlockDefinition('inverter_torch') && !blockEntityRegistry.has('inverter_torch')) {
    blockEntityRegistry.register<InverterTorchState>({
      blockId: 'inverter_torch',
      create: () => ({ toggleTicks: [], coolingUntil: 0 }),
    });
  }
  if (registry.getBlockDefinition('gauge') && !blockEntityRegistry.has('gauge')) {
    blockEntityRegistry.register<GaugeState>({
      blockId: 'gauge',
      create: () => ({ outputLevel: 0 }),
    });
  }
}

const BOOL = (value: unknown): boolean => String(value) === 'true';

/** One deterministic simulation engine for all M15a sources, wires and receivers. */
export class CurrentEngine {
  private readonly blocks = new Map<string, BlockPosition>();
  private readonly neighborQueue: BlockPosition[] = [];
  private updating = false;
  private dirty = false;
  private readonly registry = BlockRegistry.getInstance();

  constructor(private readonly world: World) {
    registerCurrentBlockEntities();
  }

  get hasComponents(): boolean {
    return this.blocks.size > 0;
  }

  /** Skip world block-change dispatch entirely until a circuit is present. */
  shouldObserveBlockChange(newBlockId: string): boolean {
    return this.blocks.size > 0 || CURRENT_BLOCK_IDS.has(newBlockId);
  }

  onBlockChanged(x: number, y: number, z: number, newBlockId: string): void {
    const position = { x, y, z };
    const key = positionKey(position);
    const wasCurrent = this.blocks.has(key);
    const isCurrent = CURRENT_BLOCK_IDS.has(newBlockId);
    if (!wasCurrent && !isCurrent) {
      // Ordinary terrain edits never enter the current simulation. Once a circuit exists,
      // only a changed block touching a tracked component can affect its state.
      if (this.blocks.size === 0) return;
      const touchesCurrent = NEIGHBOR_OFFSETS.some((offset) =>
        this.blocks.has(positionKey(offsetPosition(position, offset))),
      );
      if (!touchesCurrent) return;
    }
    this.track(position, newBlockId);
    // Enqueue neighbour invalidations in the documented fixed axis order.
    for (const offset of NEIGHBOR_OFFSETS)
      this.neighborQueue.push(offsetPosition(position, offset));
    if (this.updating) {
      this.dirty = true;
      return;
    }
    this.drainNeighborUpdates();
  }

  private track(position: BlockPosition, knownBlockId?: string): void {
    const key = positionKey(position);
    const id = knownBlockId ?? this.world.getBlock(position.x, position.y, position.z).id;
    if (CURRENT_BLOCK_IDS.has(id)) this.blocks.set(key, position);
    else this.blocks.delete(key);
  }

  private drainNeighborUpdates(): void {
    this.updating = true;
    try {
      while (this.neighborQueue.length > 0) {
        const neighbor = this.neighborQueue.shift()!;
        this.track(neighbor);
      }
      this.settle();
    } finally {
      this.updating = false;
    }
    if (this.dirty || this.neighborQueue.length > 0) {
      this.dirty = false;
      this.drainNeighborUpdates();
    }
  }

  private settle(): void {
    // Circuits can feed back through torches. Iterate in stable Y/Z/X order until all
    // combinational states and trace strengths stop changing.
    const limit = Math.max(8, this.blocks.size * 2 + 8);
    for (let pass = 0; pass < limit; pass++) {
      this.dirty = false;
      const positions = [...this.blocks.values()].sort(comparePositions);
      for (const position of positions) {
        this.updateComponent(position);
      }
      this.updateTracePower(positions);
      if (!this.dirty) return;
      while (this.neighborQueue.length > 0) this.track(this.neighborQueue.shift()!);
    }
    // Keep a deterministic state if a deliberately oscillating circuit does not settle.
    this.dirty = false;
  }

  tick(): void {
    if (this.blocks.size === 0) return;
    let changed = false;
    const positions = [...this.blocks.values()].sort(comparePositions);
    for (const position of positions) {
      const block = this.world.getBlock(position.x, position.y, position.z);
      if (block.id === 'gauge') {
        this.updateGauge(position, block.state);
      } else if (block.id === 'pressure_plate') {
        const pressed =
          this.world.entityQuery.query({
            minX: position.x,
            minY: position.y,
            minZ: position.z,
            maxX: position.x + 1,
            maxY: position.y + 0.2,
            maxZ: position.z + 1,
          }).length > 0;
        changed = this.setState(position, { powered: String(pressed) }) || changed;
      } else if (block.id === 'tripwire_hook') {
        changed = this.updateTripwire(position) || changed;
      }
    }
    if ((changed || this.dirty) && !this.updating) this.drainNeighborUpdates();
  }

  handleScheduledTick(tick: BlockTick): boolean {
    if (tick.type === CURRENT_BUTTON_RELEASE_TICK) {
      const id = this.world.getBlock(tick.x, tick.y, tick.z).id;
      if (id === 'stone_button' || id === 'wooden_button')
        this.setState(tick, { powered: 'false' });
      return true;
    }

    if (tick.type === CURRENT_RELAY_TICK) {
      const block = this.world.getBlock(tick.x, tick.y, tick.z);
      if (block.id === 'relay' && !BOOL(block.state.locked)) {
        const facing = String(block.state.facing) as CurrentFacing;
        const back = this.backPosition(tick, facing);
        const target = this.receivedPower(back) > 0;
        if (BOOL(block.state.powered) !== target) this.setState(tick, { powered: String(target) });
      }
      return true;
    }

    if (tick.type === CURRENT_TORCH_COOLDOWN_TICK) {
      const state = this.world.blockEntities.get<InverterTorchState>(tick.x, tick.y, tick.z)?.state;
      if (state && state.coolingUntil <= this.world.ticks.time) {
        state.coolingUntil = 0;
        state.toggleTicks = [];
        this.recompute();
      }
      return true;
    }
    return false;
  }

  useBlock(x: number, y: number, z: number): boolean {
    const position = { x, y, z };
    const block = this.world.getBlock(x, y, z);
    if (block.id === 'lever') {
      this.setState(position, { powered: String(!BOOL(block.state.powered)) });
      return true;
    }
    if (block.id === 'stone_button' || block.id === 'wooden_button') {
      if (!BOOL(block.state.powered)) {
        this.setState(position, { powered: 'true' });
        this.world.ticks.schedule(
          { ...position, type: CURRENT_BUTTON_RELEASE_TICK },
          block.id === 'stone_button' ? 20 : 30,
          CURRENT_TICK_PRIORITY.source,
        );
      }
      return true;
    }
    return false;
  }

  getOutputLevel(x: number, y: number, z: number): number {
    return this.outputAt({ x, y, z });
  }

  getWeakPower(x: number, y: number, z: number): number {
    return this.weakPowerAt({ x, y, z });
  }

  getStrongPower(x: number, y: number, z: number): number {
    return this.strongPowerAt({ x, y, z });
  }

  private recompute(): void {
    if (this.updating) {
      this.dirty = true;
      return;
    }
    this.drainNeighborUpdates();
  }

  private updateComponent(position: BlockPosition): void {
    const block = this.world.getBlock(position.x, position.y, position.z);
    if (block.id === 'inverter_torch') {
      const facing = String(block.state.attachment ?? 'floor');
      const support = this.attachmentPosition(position, facing);
      const state = this.world.blockEntities.get<InverterTorchState>(
        position.x,
        position.y,
        position.z,
      )?.state;
      if (!state) return;
      const cooling = state.coolingUntil > this.world.ticks.time;
      const shouldLight = !cooling && this.strongPowerAt(support) === 0;
      if (BOOL(block.state.lit) !== shouldLight) {
        this.recordTorchToggle(state, position);
        if (state.coolingUntil > this.world.ticks.time) {
          this.setState(position, { lit: 'false' });
        } else {
          this.setState(position, { lit: String(shouldLight) });
        }
      }
    } else if (block.id === 'relay') {
      const facing = String(block.state.facing) as CurrentFacing;
      const locked = this.relaySidePowered(position, facing);
      if (BOOL(block.state.locked) !== locked) this.setState(position, { locked: String(locked) });
      if (!locked) {
        const target = this.receivedPower(this.backPosition(position, facing)) > 0;
        if (BOOL(block.state.powered) !== target) {
          this.world.ticks.schedule(
            { ...position, type: CURRENT_RELAY_TICK },
            Number(block.state.delay) || 1,
            CURRENT_TICK_PRIORITY.relay,
          );
        }
      }
    } else if (block.id === 'gauge') {
      this.updateGauge(position, block.state);
    } else if (block.id === 'lamp') {
      const lit = this.weakPowerAt(position) > 0;
      if (BOOL(block.state.lit) !== lit) this.setState(position, { lit: String(lit) });
    }
  }

  private recordTorchToggle(state: InverterTorchState, position: BlockPosition): void {
    const now = this.world.ticks.time;
    state.toggleTicks = state.toggleTicks.filter((tick) => now - tick < TORCH_BURNOUT_WINDOW);
    state.toggleTicks.push(now);
    if (state.toggleTicks.length > TORCH_BURNOUT_THRESHOLD) {
      state.coolingUntil = now + TORCH_COOLDOWN_TICKS;
      this.world.ticks.schedule(
        {
          ...position,
          type: CURRENT_TORCH_COOLDOWN_TICK,
        },
        TORCH_COOLDOWN_TICKS,
        CURRENT_TICK_PRIORITY.source,
      );
    }
  }

  private updateGauge(position: BlockPosition, state: Record<string, string | number>): void {
    const facing = String(state.facing) as CurrentFacing;
    const vector = FACING_OFFSET[facing];
    const back = { x: position.x - vector[0], y: position.y, z: position.z - vector[2] };
    const container = this.world.blockEntities.getContainer(back.x, back.y, back.z);
    const backPower = container ? this.containerSignal(container.slots) : this.receivedPower(back);
    const sideVectors: ReadonlyArray<readonly [number, number, number]> =
      facing === 'north' || facing === 'south'
        ? [FACING_OFFSET.east, FACING_OFFSET.west]
        : [FACING_OFFSET.north, FACING_OFFSET.south];
    const sidePower = Math.max(
      ...sideVectors.map((side) =>
        this.receivedPower({ x: position.x + side[0], y: position.y, z: position.z + side[2] }),
      ),
    );
    const mode = String(state.mode);
    const output = Math.max(
      0,
      Math.min(
        15,
        mode === 'subtract' ? backPower - sidePower : backPower >= sidePower ? backPower : 0,
      ),
    );
    const entity = this.world.blockEntities.get<GaugeState>(position.x, position.y, position.z);
    if (entity && entity.state.outputLevel !== output) {
      entity.state.outputLevel = output;
      this.dirty = true;
    }
    const powered = output > 0;
    if (BOOL(state.powered) !== powered) this.setState(position, { powered: String(powered) });
  }

  private containerSignal(slots: ReadonlyArray<{ id: string; count: number } | null>): number {
    let fraction = 0;
    for (const slot of slots) {
      if (!slot || slot.count <= 0) continue;
      fraction += Math.max(0, Math.min(1, slot.count / items.get(slot.id).maxStack));
    }
    fraction /= slots.length;
    return fraction <= 0 ? 0 : Math.min(15, Math.floor(1 + fraction * 14));
  }

  private updateTracePower(positions: readonly BlockPosition[]): void {
    const traces = positions.filter(
      (position) => this.world.getBlock(position.x, position.y, position.z).id === 'copper_trace',
    );
    const levels = new Map<string, number>();
    const queue: BlockPosition[] = [];
    for (const position of traces) {
      const key = positionKey(position);
      let initial = 0;
      for (const offset of NEIGHBOR_OFFSETS) {
        const source = offsetPosition(position, offset);
        if (this.world.getBlock(source.x, source.y, source.z).id === 'copper_trace') continue;
        if (this.canPowerTarget(source, position))
          initial = Math.max(initial, this.outputAt(source));
      }
      levels.set(key, initial);
      if (initial > 0) queue.push(position);
    }
    for (let head = 0; head < queue.length; head++) {
      const position = queue[head]!;
      const level = levels.get(positionKey(position)) ?? 0;
      if (level <= 1) continue;
      for (const neighbor of this.traceNeighbors(position)) {
        const key = positionKey(neighbor);
        const next = level - 1;
        if (next <= (levels.get(key) ?? 0)) continue;
        levels.set(key, next);
        queue.push(neighbor);
      }
    }
    for (const position of traces) {
      const level = levels.get(positionKey(position)) ?? 0;
      const block = this.world.getBlock(position.x, position.y, position.z);
      if (Number(block.state.power) !== level) this.setState(position, { power: String(level) });
    }
  }

  private traceNeighbors(position: BlockPosition): BlockPosition[] {
    const out: BlockPosition[] = [];
    for (const offset of NEIGHBOR_OFFSETS) {
      const direct = offsetPosition(position, offset);
      if (this.world.getBlock(direct.x, direct.y, direct.z).id === 'copper_trace') out.push(direct);
    }
    for (const offset of HORIZONTAL_OFFSETS) {
      const same = offsetPosition(position, offset);
      if (this.world.getBlock(same.x, same.y, same.z).id === 'copper_trace') continue;
      const up = { ...same, y: same.y + 1 };
      const down = { ...same, y: same.y - 1 };
      if (this.world.getBlock(up.x, up.y, up.z).id === 'copper_trace') out.push(up);
      else if (this.world.getBlock(down.x, down.y, down.z).id === 'copper_trace') out.push(down);
    }
    return out;
  }

  private updateTripwire(hook: BlockPosition): boolean {
    const block = this.world.getBlock(hook.x, hook.y, hook.z);
    const facing = String(block.state.facing) as CurrentFacing;
    const [dx, , dz] = FACING_OFFSET[facing];
    let tripped = false;
    let length = 0;
    let farHook: BlockPosition | null = null;
    for (let step = 1; step <= 40; step++) {
      const point = { x: hook.x + dx * step, y: hook.y, z: hook.z + dz * step };
      const next = this.world.getBlock(point.x, point.y, point.z);
      if (next.id === 'tripwire') {
        length++;
        tripped =
          this.world.entityQuery.query({
            minX: point.x,
            minY: point.y + 0.25,
            minZ: point.z,
            maxX: point.x + 1,
            maxY: point.y + 0.85,
            maxZ: point.z + 1,
          }).length > 0 || tripped;
        continue;
      }
      if (
        next.id === 'tripwire_hook' &&
        String(next.state.facing) === oppositeFacing(facing) &&
        length > 0
      ) {
        farHook = point;
      }
      break;
    }
    const changed = this.setState(hook, { powered: String(Boolean(farHook && tripped)) });
    if (farHook) return this.setState(farHook, { powered: String(tripped) }) || changed;
    return changed;
  }

  private relaySidePowered(position: BlockPosition, facing: CurrentFacing): boolean {
    const sides =
      facing === 'north' || facing === 'south'
        ? [FACING_OFFSET.east, FACING_OFFSET.west]
        : [FACING_OFFSET.north, FACING_OFFSET.south];
    return sides.some((side) =>
      this.receivedPower({ x: position.x + side[0], y: position.y, z: position.z + side[2] }),
    );
  }

  private backPosition(position: BlockPosition, facing: CurrentFacing): BlockPosition {
    const vector = FACING_OFFSET[facing];
    return { x: position.x - vector[0], y: position.y, z: position.z - vector[2] };
  }

  private attachmentPosition(position: BlockPosition, attachment: string): BlockPosition {
    switch (attachment) {
      case 'ceiling':
        return { x: position.x, y: position.y + 1, z: position.z };
      case 'wall_north':
        return { x: position.x, y: position.y, z: position.z - 1 };
      case 'wall_south':
        return { x: position.x, y: position.y, z: position.z + 1 };
      case 'wall_east':
        return { x: position.x + 1, y: position.y, z: position.z };
      case 'wall_west':
        return { x: position.x - 1, y: position.y, z: position.z };
      default:
        return { x: position.x, y: position.y - 1, z: position.z };
    }
  }

  private outputAt(position: BlockPosition): number {
    const block = this.world.getBlock(position.x, position.y, position.z);
    if (block.id === 'copper_trace')
      return Math.max(0, Math.min(15, Number(block.state.power) || 0));
    if (block.id === 'gauge')
      return (
        this.world.blockEntities.get<GaugeState>(position.x, position.y, position.z)?.state
          .outputLevel ?? 0
      );
    if (
      ['lever', 'stone_button', 'wooden_button', 'pressure_plate', 'tripwire_hook'].includes(
        block.id,
      )
    )
      return BOOL(block.state.powered) ? 15 : 0;
    if (block.id === 'inverter_torch') return BOOL(block.state.lit) ? 15 : 0;
    if (block.id === 'relay') return BOOL(block.state.powered) ? 15 : 0;
    return 0;
  }

  private receivedPower(position: BlockPosition): number {
    return Math.max(this.outputAt(position), this.weakPowerAt(position));
  }

  private weakPowerAt(position: BlockPosition): number {
    let power = 0;
    for (const offset of NEIGHBOR_OFFSETS) {
      const source = offsetPosition(position, offset);
      if (!this.canPowerTarget(source, position)) continue;
      power = Math.max(power, this.outputAt(source));
    }
    return power;
  }

  private strongPowerAt(position: BlockPosition): number {
    let power = 0;
    for (const offset of NEIGHBOR_OFFSETS) {
      const source = offsetPosition(position, offset);
      const block = this.world.getBlock(source.x, source.y, source.z);
      const output = this.outputAt(source);
      if (output <= 0) continue;
      if (block.id === 'lever' || block.id === 'stone_button' || block.id === 'wooden_button') {
        if (
          positionKey(this.attachmentPosition(source, String(block.state.face))) ===
          positionKey(position)
        )
          power = Math.max(power, output);
      } else if (
        block.id === 'copper_trace' &&
        source.x === position.x &&
        source.z === position.z
      ) {
        if (source.y === position.y + 1) power = Math.max(power, output);
      } else if (this.canPowerTarget(source, position)) {
        power = Math.max(power, output);
      }
    }
    const definition = this.world.getBlockDefinition(
      this.world.getBlock(position.x, position.y, position.z).id,
    );
    return definition?.fullOpaqueCube ? Math.max(power, this.weakPowerAt(position)) : power;
  }

  private canPowerTarget(source: BlockPosition, target: BlockPosition): boolean {
    const block = this.world.getBlock(source.x, source.y, source.z);
    if (block.id === 'inverter_torch') {
      return (
        positionKey(this.attachmentPosition(source, String(block.state.attachment))) !==
        positionKey(target)
      );
    }
    if (block.id === 'relay' || block.id === 'gauge') {
      const facing = String(block.state.facing) as CurrentFacing;
      const direction = FACING_OFFSET[facing];
      return (
        target.x === source.x + direction[0] &&
        target.y === source.y &&
        target.z === source.z + direction[2]
      );
    }
    if (block.id === 'lever' || block.id === 'stone_button' || block.id === 'wooden_button') {
      return (
        positionKey(this.attachmentPosition(source, String(block.state.face))) !==
        positionKey(target)
      );
    }
    return true;
  }

  private setState(position: BlockPosition, patch: Record<string, string | number>): boolean {
    const block = this.world.getBlock(position.x, position.y, position.z);
    if (!CURRENT_BLOCK_IDS.has(block.id)) return false;
    const properties = { ...block.state, ...patch };
    const stateId = this.registry.getStateId(block.id, properties);
    if (
      stateId === undefined ||
      stateId === this.world.getBlockStateId(position.x, position.y, position.z)
    )
      return false;
    this.world.setBlockStateId(position.x, position.y, position.z, stateId);
    return true;
  }
}

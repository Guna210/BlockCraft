import { BlockRegistry } from './blocks/registry';
import type { World } from './world';

export const BLOCK_ENTITY_TICK_TYPE = 'block_entity';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type BlockEntityState = Record<string, JsonValue>;

export interface BlockEntityInstance<TState extends BlockEntityState = BlockEntityState> {
  readonly blockId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  state: TState;
}

export interface BlockEntityTypeDefinition<TState extends BlockEntityState = BlockEntityState> {
  readonly blockId: string;
  readonly tickInterval?: number;
  create: (x: number, y: number, z: number, stateId: number) => TState;
  tick?: (entity: BlockEntityInstance<TState>, world: World) => void;
  afterPlaced?: (entity: BlockEntityInstance<TState>, world: World) => void;
  afterStateChanged?: (entity: BlockEntityInstance<TState>, world: World) => void;
  afterRemoved?: (entity: BlockEntityInstance<TState>, world: World) => void;
}

export function isPlainJsonObject(value: unknown): value is BlockEntityState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const checkValue = (v: unknown): boolean => {
    if (v === null) return true;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return true;
    if (t === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(checkValue);
    if (t === 'object') {
      if (Object.getPrototypeOf(v) !== Object.prototype) return false;
      return Object.values(v as Record<string, unknown>).every(checkValue);
    }
    return false;
  };
  return Object.values(value).every(checkValue);
}

export class BlockEntityRegistry {
  private static instance: BlockEntityRegistry | null = null;
  private readonly types = new Map<string, BlockEntityTypeDefinition>();

  public static getInstance(): BlockEntityRegistry {
    if (!BlockEntityRegistry.instance) {
      BlockEntityRegistry.instance = new BlockEntityRegistry();
    }
    return BlockEntityRegistry.instance;
  }

  public register<TState extends BlockEntityState>(
    definition: BlockEntityTypeDefinition<TState>,
  ): void {
    const blockDef = BlockRegistry.getInstance().getBlockDefinition(definition.blockId);
    if (!blockDef || definition.blockId === 'air') {
      throw new Error(`Cannot register block entity for unknown block '${definition.blockId}'`);
    }
    if (
      definition.tickInterval !== undefined &&
      (!Number.isSafeInteger(definition.tickInterval) || definition.tickInterval < 1)
    ) {
      throw new Error(`Invalid block entity tickInterval for '${definition.blockId}'`);
    }
    this.types.set(definition.blockId, definition as unknown as BlockEntityTypeDefinition);
  }

  public unregister(blockId: string): boolean {
    return this.types.delete(blockId);
  }

  public get(blockId: string): BlockEntityTypeDefinition | undefined {
    return this.types.get(blockId);
  }

  public has(blockId: string): boolean {
    return this.types.has(blockId);
  }

  public clear(): void {
    this.types.clear();
  }
}

export const blockEntityRegistry = BlockEntityRegistry.getInstance();

export class BlockEntityManager {
  private readonly entities = new Map<string, BlockEntityInstance>();

  constructor(private readonly world: World) {}

  public static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  public get count(): number {
    return this.entities.size;
  }

  public get<TState extends BlockEntityState = BlockEntityState>(
    x: number,
    y: number,
    z: number,
  ): BlockEntityInstance<TState> | undefined {
    return this.entities.get(BlockEntityManager.key(x, y, z)) as
      BlockEntityInstance<TState> | undefined;
  }

  public getState<TState extends BlockEntityState = BlockEntityState>(
    x: number,
    y: number,
    z: number,
  ): TState | undefined {
    return this.get<TState>(x, y, z)?.state;
  }

  public getAll(): ReadonlyArray<BlockEntityInstance> {
    return [...this.entities.values()];
  }

  public onBlockChanged(
    x: number,
    y: number,
    z: number,
    oldBlockId: string,
    newBlockId: string,
    newStateId: number,
    oldStateId = 0,
  ): void {
    const k = BlockEntityManager.key(x, y, z);
    const existing = this.entities.get(k);
    if (oldBlockId === newBlockId && existing) {
      if (oldStateId !== newStateId) {
        blockEntityRegistry.get(newBlockId)?.afterStateChanged?.(existing, this.world);
      }
      return;
    }

    if (existing) {
      this.entities.delete(k);
      blockEntityRegistry.get(oldBlockId)?.afterRemoved?.(existing, this.world);
    }

    const typeDef = blockEntityRegistry.get(newBlockId);
    if (!typeDef) return;

    const initialState = typeDef.create(x, y, z, newStateId);
    if (!isPlainJsonObject(initialState)) {
      throw new Error(`Block entity state for '${newBlockId}' must be a plain JSON object`);
    }

    const instance: BlockEntityInstance = {
      blockId: newBlockId,
      x,
      y,
      z,
      state: initialState,
    };
    this.entities.set(k, instance);
    typeDef.afterPlaced?.(instance, this.world);

    if (typeDef.tick) {
      this.world.ticks.schedule(
        { x, y, z, type: BLOCK_ENTITY_TICK_TYPE },
        typeDef.tickInterval ?? 1,
      );
    }
  }

  public removeColumn(cx: number, cz: number): void {
    for (const [k, entity] of this.entities.entries()) {
      if (Math.floor(entity.x / 16) === cx && Math.floor(entity.z / 16) === cz) {
        this.entities.delete(k);
      }
    }
  }

  public tickBlockEntity(x: number, y: number, z: number): void {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    if (!this.world.hasColumn(cx, cz)) return;

    const k = BlockEntityManager.key(x, y, z);
    const entity = this.entities.get(k);
    if (!entity) return;

    const currentBlock = this.world.getBlock(x, y, z);
    if (currentBlock.id !== entity.blockId) {
      this.entities.delete(k);
      return;
    }

    const typeDef = blockEntityRegistry.get(entity.blockId);
    if (!typeDef?.tick) return;

    typeDef.tick(entity, this.world);

    if (this.entities.get(k) === entity && this.world.hasColumn(cx, cz)) {
      this.world.ticks.schedule(
        { x, y, z, type: BLOCK_ENTITY_TICK_TYPE },
        typeDef.tickInterval ?? 1,
      );
    }
  }
}

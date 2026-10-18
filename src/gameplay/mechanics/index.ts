import {
  blockEntityRegistry,
  type BlockEntityContainer,
  type BlockEntityState,
} from '../../world/block-entities';
import { BlockRegistry } from '../../world/blocks/registry';
import type { BlockTick } from '../../world/ticks';
import type { World } from '../../world/world';
import { items } from '../items';
import { setOpenable } from '../shape-blocks';
import { comparePositions, positionKey, type BlockPosition } from '../current/types';

export const PISTON_LAND_TICK = 'piston_land';
/** Ticks a pushed or pulled block takes to slide one cell. */
export const PISTON_MOVE_TICKS = 2;
/** Most blocks one piston moves; a longer line means the piston does not extend. */
export const PISTON_PUSH_LIMIT = 12;
export const DISPENSER_SLOTS = 9;
export const NOTE_COUNT = 25;
const MOVE_PRIORITY = 2;
const EJECT_SPEED = 3;
const EJECT_PICKUP_DELAY = 20;
const SIZE_LIMIT_Y = 320;

export type MechanicFacing = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

export const FACING_VECTORS: Record<MechanicFacing, readonly [number, number, number]> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const PISTON_IDS = new Set(['piston', 'sticky_piston']);
const HEAD_IDS = new Set(['piston_head', 'sticky_piston_head']);
const RECEIVER_IDS = new Set([...PISTON_IDS, ...HEAD_IDS, 'dispenser', 'note_block']);
const ALWAYS_FIXED = new Set(['foundation_stone', 'blackglass', 'piston_moving']);

/** One block drawn mid-move, offset from its cell by `from` plus the cell's movement times progress. */
export type MovingPart = { stateId: number; from: number[] };

export interface MovingBlockState extends BlockEntityState {
  parts: MovingPart[];
  /** Movement over the whole move, in blocks. */
  move: number[];
  start: number;
  duration: number;
  /** State the cell turns into when the move finishes (0 is air). */
  landState: number;
  /** Position of the piston that owns this move. */
  owner: number[];
}

export type DispenserSlot = { id: string; count: number };

export interface DispenserState extends BlockEntityState {
  slots: Array<DispenserSlot | null>;
}

export interface MovingBlockView {
  x: number;
  y: number;
  z: number;
  parts: ReadonlyArray<MovingPart>;
  move: readonly number[];
  start: number;
  duration: number;
}

export interface ToneEvent {
  x: number;
  y: number;
  z: number;
  /** Semitone step, 0..24. */
  note: number;
  /** Playback-rate ratio, 1 at note 12. */
  pitch: number;
}

export type ItemSpawner = (
  id: string,
  count: number,
  x: number,
  y: number,
  z: number,
  velocity: [number, number, number],
  pickupDelay: number,
) => void;

export function registerMechanicsBlockEntities(): void {
  const registry = BlockRegistry.getInstance();
  if (registry.getBlockDefinition('dispenser') && !blockEntityRegistry.has('dispenser')) {
    blockEntityRegistry.register<DispenserState>({
      blockId: 'dispenser',
      create: () => ({ slots: Array.from({ length: DISPENSER_SLOTS }, () => null) }),
      container: (entity): BlockEntityContainer => ({ slots: entity.state.slots }),
    });
  }
  if (registry.getBlockDefinition('piston_moving') && !blockEntityRegistry.has('piston_moving')) {
    blockEntityRegistry.register<MovingBlockState>({
      blockId: 'piston_moving',
      create: () => ({
        parts: [],
        move: [0, 0, 0],
        start: 0,
        duration: PISTON_MOVE_TICKS,
        landState: 0,
        owner: [0, 0, 0],
      }),
    });
  }
}

/**
 * Pistons, powered doors, dispensers and note blocks. It sits inside the CurrentEngine: the engine
 * supplies received power and calls `reconcile` after every settle, so there is one power system.
 */
export class Mechanics {
  private readonly receivers = new Map<string, BlockPosition>();
  private readonly moving = new Map<string, BlockPosition>();
  private readonly owners = new Map<string, number>();
  private readonly doorPower = new Map<string, boolean>();
  /** Receivers whose inputs may have changed since the last reconcile. */
  private readonly dirty = new Set<string>();
  private readonly listeners = new Set<(event: ToneEvent) => void>();
  private readonly registry = BlockRegistry.getInstance();
  private readonly openableCache = new Map<string, boolean>();

  constructor(
    private readonly world: World,
    private readonly powerAt: (position: BlockPosition) => number,
    private readonly refresh: () => void,
  ) {
    registerMechanicsBlockEntities();
  }

  get active(): boolean {
    return this.receivers.size > 0 || this.moving.size > 0;
  }

  has(key: string): boolean {
    return this.receivers.has(key);
  }

  isReceiverId(id: string): boolean {
    if (RECEIVER_IDS.has(id)) return true;
    let openable = this.openableCache.get(id);
    if (openable === undefined) {
      const model = this.registry.getBlockDefinition(id)?.model;
      openable = model === 'door' || model === 'trapdoor';
      this.openableCache.set(id, openable);
    }
    return openable;
  }

  observe(position: BlockPosition, id: string): void {
    const key = positionKey(position);
    if (this.isReceiverId(id)) {
      if (!this.receivers.has(key)) this.dirty.add(key);
      this.receivers.set(key, position);
    } else {
      this.receivers.delete(key);
      this.doorPower.delete(key);
    }
  }

  /** Subscribes to note block tones; returns the unsubscribe function. */
  onTone(listener: (event: ToneEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Blocks currently sliding between cells, for the renderer. */
  movingBlocks(): MovingBlockView[] {
    const out: MovingBlockView[] = [];
    for (const position of [...this.moving.values()].sort(comparePositions)) {
      const entity = this.world.blockEntities.get<MovingBlockState>(
        position.x,
        position.y,
        position.z,
      );
      if (!entity) continue;
      out.push({
        x: position.x,
        y: position.y,
        z: position.z,
        parts: entity.state.parts,
        move: entity.state.move,
        start: entity.state.start,
        duration: entity.state.duration,
      });
    }
    return out;
  }

  /** Pistons that have unfinished moves. */
  isBusy(x: number, y: number, z: number): boolean {
    return (this.owners.get(positionKey({ x, y, z })) ?? 0) > 0;
  }

  /**
   * Flags every receiver within two cells of a changed block: power reaches a receiver from a
   * neighbour, or through a solid neighbour from a component one cell further out.
   */
  markAround(position: BlockPosition): void {
    if (this.receivers.size === 0) return;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2 + Math.abs(dx); dy <= 2 - Math.abs(dx); dy++)
        for (
          let dz = -2 + Math.abs(dx) + Math.abs(dy);
          dz <= 2 - Math.abs(dx) - Math.abs(dy);
          dz++
        ) {
          const key = `${position.x + dx},${position.y + dy},${position.z + dz}`;
          if (this.receivers.has(key)) this.dirty.add(key);
        }
  }

  reconcile(): void {
    if (this.dirty.size === 0) return;
    const positions: BlockPosition[] = [];
    for (const key of this.dirty) {
      const position = this.receivers.get(key);
      if (position) positions.push(position);
    }
    this.dirty.clear();
    for (const position of positions.sort(comparePositions)) {
      const block = this.world.getBlock(position.x, position.y, position.z);
      if (!this.isReceiverId(block.id)) continue;
      if (PISTON_IDS.has(block.id)) this.reconcilePiston(position, block.id, block.state);
      else if (HEAD_IDS.has(block.id)) this.reconcileHead(position, block.id, block.state);
      else if (block.id === 'dispenser') this.reconcileDispenser(position, block.state);
      else if (block.id === 'note_block') this.reconcileNote(position, block.state);
      else this.reconcileOpenable(position, block.state);
    }
  }

  handleScheduledTick(tick: BlockTick): boolean {
    if (tick.type !== PISTON_LAND_TICK) return false;
    const key = positionKey(tick);
    this.moving.delete(key);
    if (this.world.getBlock(tick.x, tick.y, tick.z).id !== 'piston_moving') return true;
    const entity = this.world.blockEntities.get<MovingBlockState>(tick.x, tick.y, tick.z);
    const landState = entity?.state.landState ?? 0;
    const owner = entity ? positionKey(arrayPosition(entity.state.owner)) : '';
    const left = (this.owners.get(owner) ?? 1) - 1;
    if (left > 0) this.owners.set(owner, left);
    else {
      this.owners.delete(owner);
      this.dirty.add(owner);
    }
    this.world.setBlockStateId(tick.x, tick.y, tick.z, landState);
    if (left <= 0) this.refresh();
    return true;
  }

  /** Using a note block steps its pitch and plays it. */
  useBlock(x: number, y: number, z: number): boolean {
    const block = this.world.getBlock(x, y, z);
    if (block.id !== 'note_block') return false;
    const note = (Number(block.state.note) + 1) % NOTE_COUNT;
    this.patch({ x, y, z }, { note: String(note) });
    this.emitTone({ x, y, z }, note);
    return true;
  }

  /** Adds one item to the dispenser; false when it is full or the item is unknown. */
  insertItem(x: number, y: number, z: number, id: string, count = 1): boolean {
    const entity = this.world.blockEntities.get<DispenserState>(x, y, z);
    if (!entity || this.world.getBlock(x, y, z).id !== 'dispenser') return false;
    const maxStack = items.get(id).maxStack;
    const slots = entity.state.slots;
    for (const slot of slots) {
      if (slot && slot.id === id && slot.count + count <= maxStack) {
        slot.count += count;
        return true;
      }
    }
    const free = slots.findIndex((slot) => slot === null || slot.count <= 0);
    if (free < 0 || count > maxStack) return false;
    slots[free] = { id, count };
    return true;
  }

  /** Ejects one item from the first stocked slot; returns the item id, or null when empty. */
  eject(position: BlockPosition): string | null {
    const block = this.world.getBlock(position.x, position.y, position.z);
    const entity = this.world.blockEntities.get<DispenserState>(position.x, position.y, position.z);
    if (!entity || block.id !== 'dispenser') return null;
    const slot = entity.state.slots.find((candidate) => candidate && candidate.count > 0);
    if (!slot) return null;
    const vector = FACING_VECTORS[String(block.state.facing) as MechanicFacing];
    const id = slot.id;
    slot.count--;
    if (slot.count <= 0) entity.state.slots[entity.state.slots.indexOf(slot)] = null;
    this.world.itemSpawner?.(
      id,
      1,
      position.x + 0.5 + vector[0] * 0.7,
      position.y + 0.5 + vector[1] * 0.7 - (vector[1] === 0 ? 0.2 : 0),
      position.z + 0.5 + vector[2] * 0.7,
      [vector[0] * EJECT_SPEED, vector[1] * EJECT_SPEED + 0.5, vector[2] * EJECT_SPEED],
      EJECT_PICKUP_DELAY,
    );
    return id;
  }

  /** The block a piston at this position would push to, or null when it cannot extend. */
  pushLine(piston: BlockPosition, facing: MechanicFacing): BlockPosition[] | null {
    const vector = FACING_VECTORS[facing];
    const line: BlockPosition[] = [];
    for (let step = 1; ; step++) {
      const cell = {
        x: piston.x + vector[0] * step,
        y: piston.y + vector[1] * step,
        z: piston.z + vector[2] * step,
      };
      if (!this.inWorld(cell)) return null;
      const block = this.world.getBlock(cell.x, cell.y, cell.z);
      if (block.id === 'air') return line;
      if (!this.isMovable(cell) || line.length >= PISTON_PUSH_LIMIT) return null;
      line.push(cell);
    }
  }

  isMovable(position: BlockPosition): boolean {
    const block = this.world.getBlock(position.x, position.y, position.z);
    if (block.id === 'air' || ALWAYS_FIXED.has(block.id) || HEAD_IDS.has(block.id)) return false;
    if (PISTON_IDS.has(block.id) && String(block.state.extended) === 'true') return false;
    return !this.world.blockEntities.get(position.x, position.y, position.z);
  }

  private inWorld(cell: BlockPosition): boolean {
    return (
      cell.y >= 0 &&
      cell.y < SIZE_LIMIT_Y &&
      this.world.hasColumn(Math.floor(cell.x / 16), Math.floor(cell.z / 16))
    );
  }

  private reconcilePiston(
    position: BlockPosition,
    id: string,
    state: Record<string, string | number>,
  ): void {
    if (this.isBusy(position.x, position.y, position.z)) return;
    const facing = String(state.facing) as MechanicFacing;
    const extended = String(state.extended) === 'true';
    const powered = this.powerAt(position) > 0;
    const vector = FACING_VECTORS[facing];
    const front = {
      x: position.x + vector[0],
      y: position.y + vector[1],
      z: position.z + vector[2],
    };
    if (extended) {
      const headId = id === 'piston' ? 'piston_head' : 'sticky_piston_head';
      const head = this.world.getBlock(front.x, front.y, front.z);
      if (head.id !== headId || String(head.state.facing) !== facing) {
        this.patch(position, { extended: 'false' });
        return;
      }
      if (!powered) this.retract(position, id, facing, front);
    } else if (powered) {
      this.extend(position, id, facing);
    }
  }

  private extend(position: BlockPosition, id: string, facing: MechanicFacing): void {
    const line = this.pushLine(position, facing);
    if (!line) return;
    const vector = FACING_VECTORS[facing];
    const back = [-vector[0], -vector[1], -vector[2]];
    const owner = [position.x, position.y, position.z];
    const sources = line.map((cell) => this.world.getBlockStateId(cell.x, cell.y, cell.z));
    const headState = this.stateOf(id === 'piston' ? 'piston_head' : 'sticky_piston_head', {
      facing,
    });
    this.patch(position, { extended: 'true' });
    for (let k = line.length - 1; k >= 0; k--) {
      const cell = line[k]!;
      this.place(
        { x: cell.x + vector[0], y: cell.y + vector[1], z: cell.z + vector[2] },
        [{ stateId: sources[k]!, from: back }],
        vector,
        sources[k]!,
        owner,
        facing,
      );
    }
    this.place(
      { x: position.x + vector[0], y: position.y + vector[1], z: position.z + vector[2] },
      [{ stateId: headState, from: back }],
      vector,
      headState,
      owner,
      facing,
    );
  }

  private retract(
    position: BlockPosition,
    id: string,
    facing: MechanicFacing,
    front: BlockPosition,
  ): void {
    const vector = FACING_VECTORS[facing];
    const back = [-vector[0], -vector[1], -vector[2]];
    const owner = [position.x, position.y, position.z];
    const headState = this.world.getBlockStateId(front.x, front.y, front.z);
    const behind = {
      x: front.x + vector[0],
      y: front.y + vector[1],
      z: front.z + vector[2],
    };
    const pull = id === 'sticky_piston' && this.inWorld(behind) && this.isMovable(behind);
    const pulled = pull ? this.world.getBlockStateId(behind.x, behind.y, behind.z) : 0;
    this.patch(position, { extended: 'false' });
    if (pull) this.world.setBlockStateId(behind.x, behind.y, behind.z, 0);
    const parts: MovingPart[] = [{ stateId: headState, from: [0, 0, 0] }];
    if (pull) parts.push({ stateId: pulled, from: [vector[0], vector[1], vector[2]] });
    this.place(front, parts, back, pulled, owner, facing);
  }

  private place(
    cell: BlockPosition,
    parts: MovingPart[],
    move: ArrayLike<number>,
    landState: number,
    owner: number[],
    facing: MechanicFacing,
  ): void {
    this.world.setBlockStateId(cell.x, cell.y, cell.z, this.stateOf('piston_moving', { facing }));
    const entity = this.world.blockEntities.get<MovingBlockState>(cell.x, cell.y, cell.z);
    if (!entity) throw new Error('piston_moving block entity missing');
    entity.state.parts = parts;
    entity.state.move = [move[0]!, move[1]!, move[2]!];
    entity.state.start = this.world.ticks.time;
    entity.state.duration = PISTON_MOVE_TICKS;
    entity.state.landState = landState;
    entity.state.owner = owner;
    const ownerKey = positionKey(arrayPosition(owner));
    this.owners.set(ownerKey, (this.owners.get(ownerKey) ?? 0) + 1);
    this.moving.set(positionKey(cell), cell);
    this.world.ticks.schedule(
      { ...cell, type: PISTON_LAND_TICK },
      PISTON_MOVE_TICKS,
      MOVE_PRIORITY,
    );
  }

  private reconcileHead(
    position: BlockPosition,
    id: string,
    state: Record<string, string | number>,
  ): void {
    const vector = FACING_VECTORS[String(state.facing) as MechanicFacing];
    const base = this.world.getBlock(
      position.x - vector[0],
      position.y - vector[1],
      position.z - vector[2],
    );
    const pistonId = id === 'piston_head' ? 'piston' : 'sticky_piston';
    const owned =
      base.id === pistonId &&
      String(base.state.facing) === String(state.facing) &&
      String(base.state.extended) === 'true';
    if (
      !owned &&
      !this.isBusy(position.x - vector[0], position.y - vector[1], position.z - vector[2])
    )
      this.world.setBlockStateId(position.x, position.y, position.z, 0);
  }

  private reconcileDispenser(
    position: BlockPosition,
    state: Record<string, string | number>,
  ): void {
    const powered = this.powerAt(position) > 0;
    const triggered = String(state.triggered) === 'true';
    if (powered === triggered) return;
    this.patch(position, { triggered: String(powered) });
    if (powered) this.eject(position);
  }

  private reconcileNote(position: BlockPosition, state: Record<string, string | number>): void {
    const powered = this.powerAt(position) > 0;
    if (powered === (String(state.powered) === 'true')) return;
    this.patch(position, { powered: String(powered) });
    if (powered) this.emitTone(position, Number(state.note));
  }

  private reconcileOpenable(position: BlockPosition, state: Record<string, string | number>): void {
    if (state.half === 'upper') return;
    const door = this.world.getBlock(position.x, position.y, position.z);
    const isDoor = this.registry.getBlockDefinition(door.id)?.model === 'door';
    const powered =
      this.powerAt(position) > 0 ||
      (isDoor && this.powerAt({ ...position, y: position.y + 1 }) > 0);
    const key = positionKey(position);
    if (powered === (this.doorPower.get(key) ?? false)) return;
    this.doorPower.set(key, powered);
    setOpenable(this.registry, this.world, position.x, position.y, position.z, powered);
  }

  private emitTone(position: BlockPosition, note: number): void {
    const event: ToneEvent = {
      x: position.x,
      y: position.y,
      z: position.z,
      note,
      pitch: 2 ** ((note - 12) / 12),
    };
    for (const listener of this.listeners) listener(event);
  }

  private stateOf(blockId: string, properties: Record<string, string>): number {
    const state = this.registry.getStateId(blockId, properties);
    if (state === undefined) throw new Error(`No state for ${blockId}`);
    return state;
  }

  private patch(position: BlockPosition, patch: Record<string, string>): void {
    const block = this.world.getBlock(position.x, position.y, position.z);
    const state = this.registry.getStateId(block.id, { ...block.state, ...patch });
    if (state !== undefined) this.world.setBlockStateId(position.x, position.y, position.z, state);
  }
}

function arrayPosition(value: number[]): BlockPosition {
  return { x: value[0]!, y: value[1]!, z: value[2]! };
}

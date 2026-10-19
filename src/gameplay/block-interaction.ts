import type { Player } from '../entity/player';
import type { Action } from '../engine/input';
import { BlockRegistry } from '../world/blocks/registry';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { breakSeconds, BARE_HAND, type MiningTool } from './mining';
import { HALF_WIDTH } from '../entity/physics';
import { items } from './items';
import {
  removeShapeBlock,
  shapeModel,
  shapePlacement,
  toggleOpenable,
  updateFenceNeighbours,
  type PlacedCell,
} from './shape-blocks';
import { chestFacingFromYaw } from './chests';
import type { RayHit } from '../world/raycast';
const NORMALS = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
} as const;
export class BlockInteraction {
  readonly raycaster: VoxelRaycaster;
  readonly target = createRayHit();
  progress = 0;
  tool: MiningTool = BARE_HAND;
  onBreak?: (state: number, x: number, y: number, z: number, tool: MiningTool) => void;
  onBreakBeforeRemove?: (state: number, x: number, y: number, z: number) => boolean | void;
  onUse?: (blockId: string, target: RayHit) => boolean;
  private attack = false;
  private use = false;
  private pick = false;
  private usePressed = false;
  private pickPressed = false;
  private bx = NaN;
  private by = NaN;
  private bz = NaN;
  private state = -1;
  private readonly eye = new Float64Array(3);
  private readonly look = new Float64Array(3);
  private readonly registry = BlockRegistry.getInstance();
  constructor(
    readonly player: Player,
    private readonly edited: (x: number, y: number, z: number) => void,
  ) {
    this.raycaster = new VoxelRaycaster(player.collision.world);
  }
  input(action: Action, down: boolean): void {
    if (action === 'attack') {
      this.attack = down;
      if (!down) this.reset();
    }
    if (action === 'use') {
      if (down && !this.use) this.usePressed = true;
      this.use = down;
    }
    if (action === 'pick') {
      if (down && !this.pick) this.pickPressed = true;
      this.pick = down;
    }
  }
  reset(): void {
    this.progress = 0;
    this.bx = NaN;
    this.state = -1;
  }
  clear(): void {
    this.attack = this.use = this.pick = this.usePressed = this.pickPressed = false;
    this.player.survival.useConsumed = false;
    this.reset();
    this.target.hit = false;
  }
  updateTarget(): void {
    const p = this.player;
    if (p.detached) {
      this.target.hit = false;
      return;
    }
    this.eye.set([p.pos[0], p.pos[1] + p.eye, p.pos[2]]);
    this.look.set([
      Math.cos(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      Math.sin(p.yaw) * Math.cos(p.pitch),
    ]);
    this.raycaster.cast(
      this.eye[0]!,
      this.eye[1]!,
      this.eye[2]!,
      this.look[0]!,
      this.look[1]!,
      this.look[2]!,
      p.mode === 'creative' ? 5 : 4.5,
      this.target,
    );
    const t = this.target;
    if (!t.hit || t.x !== this.bx || t.y !== this.by || t.z !== this.bz || t.stateId !== this.state)
      this.reset();
  }
  tick(): void {
    this.updateTarget();
    const t = this.target,
      p = this.player;
    const selected = p.inventory.held;
    this.tool = selected ? (items.get(selected.id).tool ?? BARE_HAND) : BARE_HAND;
    if (this.pickPressed && t.hit && p.mode === 'creative') {
      const id = this.registry.getResolvedState(t.stateId)!.blockId;
      p.heldBlock = this.registry.getDefaultStateId(id)!;
      p.inventory.pickBlock(id);
    }
    this.pickPressed = false;
    if (this.usePressed && t.hit) {
      const blockId = this.registry.getResolvedState(t.stateId)!.blockId;
      const consumedByBlock = Boolean(this.onUse?.(blockId, t) || this.toggle());
      if (consumedByBlock) {
        this.player.survival.useConsumed = true;
      } else {
        this.place();
      }
    }
    this.usePressed = false;
    if (!t.hit || !this.attack || p.detached) {
      this.reset();
      return;
    }
    this.bx = t.x;
    this.by = t.y;
    this.bz = t.z;
    this.state = t.stateId;
    const def = this.registry.getResolvedState(t.stateId)!.definition;
    const seconds = breakSeconds(def, this.tool, p.inFluid === 'water', !p.onGround);
    if (seconds === Infinity) return;
    this.progress =
      p.mode === 'creative' || seconds === 0 ? 1 : Math.min(1, this.progress + 0.05 / seconds);
    if (this.progress >= 1 - 1e-10) {
      const brokenState = t.stateId;
      if (this.onBreakBeforeRemove?.(brokenState, t.x, t.y, t.z) === false) return;
      for (const cell of removeShapeBlock(this.registry, p.collision.world, t.x, t.y, t.z))
        this.edited(cell.x, cell.y, cell.z);
      this.onBreak?.(brokenState, t.x, t.y, t.z, this.tool);
      this.reset();
      t.hit = false;
    }
  }
  /** Right-clicking a door or trapdoor opens or closes it instead of placing a block. */
  private toggle(): boolean {
    const t = this.target;
    const model = shapeModel(this.registry, t.stateId);
    if (model !== 'door' && model !== 'trapdoor') return false;
    for (const cell of toggleOpenable(this.registry, this.player.collision.world, t.x, t.y, t.z))
      this.edited(cell.x, cell.y, cell.z);
    return true;
  }
  private place(): boolean {
    const t = this.target,
      p = this.player,
      world = p.collision.world,
      shapes = this.raycaster.shapes;
    let held = p.heldBlock;
    const selected = p.inventory.held;
    if (selected) {
      const block = items.get(selected.id).block;
      if (!block) return false;
      held = this.registry.getDefaultStateId(block)!;
    }
    if (held === null) return false;
    const normal = NORMALS[t.face];
    const replace = shapes.replaceable[t.stateId] === 1;
    const x = t.x + (replace ? 0 : normal[0]),
      y = t.y + (replace ? 0 : normal[1]),
      z = t.z + (replace ? 0 : normal[2]);
    if (
      y < 0 ||
      y >= 320 ||
      !world.hasColumn(Math.floor(x / 16), Math.floor(z / 16)) ||
      !shapes.replaceable[world.getBlockStateId(x, y, z)]
    )
      return false;
    const s = this.registry.getResolvedState(held)!;
    if (s.properties.axis !== undefined)
      held = this.registry.getStateId(s.blockId, {
        axis: normal[0] ? 'x' : normal[1] ? 'y' : 'z',
      })!;
    if (s.blockId === 'chest')
      held = this.registry.getStateId('chest', {
        facing: chestFacingFromYaw(p.yaw),
        pair: 'single',
      })!;
    if (s.blockId === 'torch' || s.blockId === 'wall_torch') {
      if (t.face === 'bottom') return false;
      held =
        t.face === 'top'
          ? this.registry.getDefaultStateId('torch')!
          : this.registry.getStateId('wall_torch', { facing: t.face })!;
    }
    if (s.blockId === 'kiln') {
      const angle = (((p.yaw / (Math.PI / 4)) % 8) + 8) % 8;
      const facing =
        angle >= 7 || angle < 1
          ? 'west'
          : angle >= 1 && angle < 3
            ? 'north'
            : angle >= 3 && angle < 5
              ? 'east'
              : 'south';
      held = this.registry.getStateId('kiln', { facing, lit: 'false' })!;
    }
    if (s.blockId === 'piston' || s.blockId === 'sticky_piston' || s.blockId === 'dispenser') {
      const look = Math.cos(p.pitch);
      const facing =
        look < 0.5
          ? p.pitch > 0
            ? 'up'
            : 'down'
          : (['east', 'south', 'west', 'north'] as const)[
              Math.floor(((((p.yaw + Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4)
            ]!;
      held = this.registry.getStateId(s.blockId, { ...s.properties, facing })!;
    }
    let cells: PlacedCell[] = [{ x, y, z, state: held }];
    if (shapeModel(this.registry, held)) {
      const px = this.eye[0]! + this.look[0]! * t.distance - t.x;
      const py = this.eye[1]! + this.look[1]! * t.distance - t.y;
      const pz = this.eye[2]! + this.look[2]! * t.distance - t.z;
      const placed = shapePlacement(
        this.registry,
        world,
        s.blockId,
        {
          x,
          y,
          z,
          face: t.face,
          hitX: px,
          hitY: py,
          hitZ: pz,
          lookX: Math.cos(p.yaw),
          lookZ: Math.sin(p.yaw),
        },
        (fx, fy, fz) =>
          fy >= 0 && fy < 320 && shapes.replaceable[world.getBlockStateId(fx, fy, fz)] === 1,
      );
      if (!placed) return false;
      cells = placed;
    }
    for (const cell of cells) {
      const parts = shapes.parts[cell.state];
      if (!parts) return false;
      for (const box of parts)
        if (
          p.pos[0] + HALF_WIDTH > cell.x + box[0] &&
          p.pos[0] - HALF_WIDTH < cell.x + box[3] &&
          p.pos[1] + p.height > cell.y + box[1] &&
          p.pos[1] < cell.y + box[4] &&
          p.pos[2] + HALF_WIDTH > cell.z + box[2] &&
          p.pos[2] - HALF_WIDTH < cell.z + box[5]
        )
          return false;
    }
    for (const cell of cells) world.setBlockStateId(cell.x, cell.y, cell.z, cell.state);
    if (selected && p.mode === 'survival') p.inventory.consumeSelected();
    for (const cell of cells) {
      this.edited(cell.x, cell.y, cell.z);
      for (const n of updateFenceNeighbours(this.registry, world, cell.x, cell.y, cell.z))
        this.edited(n.x, n.y, n.z);
    }
    return true;
  }
}

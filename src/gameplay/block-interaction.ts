import type { Player } from '../entity/player';
import type { Action } from '../engine/input';
import { BlockRegistry } from '../world/blocks/registry';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { breakSeconds, BARE_HAND, type MiningTool } from './mining';
import { HALF_WIDTH } from '../entity/physics';
import { items } from './items';
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
  onBreak?: (
    state: number,
    x: number,
    y: number,
    z: number,
    tool: MiningTool,
    blockEntity?: import('../world/block-entities').BlockEntityInstance | null,
  ) => void;
  onInteract?: (blockEntity: import('../world/block-entities').BlockEntityInstance) => void;
  private attack = false;
  private use = false;
  private pick = false;
  private usePressed = false;
  private pickPressed = false;
  private bx = NaN;
  private by = NaN;
  private bz = NaN;
  private state = -1;
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
    this.reset();
    this.target.hit = false;
  }
  updateTarget(): void {
    const p = this.player;
    if (p.detached) {
      this.target.hit = false;
      return;
    }
    this.raycaster.cast(
      p.pos[0],
      p.pos[1] + p.eye,
      p.pos[2],
      Math.cos(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      Math.sin(p.yaw) * Math.cos(p.pitch),
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
      const resolved = this.registry.getResolvedState(t.stateId);
      if (resolved && resolved.blockId === 'kiln') {
        const be = p.collision.world.blockEntities.get(t.x, t.y, t.z);
        if (be) {
          this.onInteract?.(be);
        }
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
      const blockEntity = p.collision.world.blockEntities.get(t.x, t.y, t.z);
      p.collision.world.setBlockStateId(t.x, t.y, t.z, 0);
      this.edited(t.x, t.y, t.z);
      this.onBreak?.(t.stateId, t.x, t.y, t.z, this.tool, blockEntity);
      this.reset();
      t.hit = false;
    }
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
    const box = shapes.boxes[held];
    if (!box) return false;
    if (
      p.pos[0] + HALF_WIDTH > x + box[0] &&
      p.pos[0] - HALF_WIDTH < x + box[3] &&
      p.pos[1] + p.height > y + box[1] &&
      p.pos[1] < y + box[4] &&
      p.pos[2] + HALF_WIDTH > z + box[2] &&
      p.pos[2] - HALF_WIDTH < z + box[5]
    )
      return false;
    world.setBlockStateId(x, y, z, held);
    if (selected && p.mode === 'survival') p.inventory.consumeSelected();
    this.edited(x, y, z);
    return true;
  }
}

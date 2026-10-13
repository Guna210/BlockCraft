import { BlockRegistry } from './blocks/registry';
export type Box = readonly [number, number, number, number, number, number];
export const CUBE_BOX: Box = [0, 0, 0, 1, 1, 1];
export const BOTTOM_SLAB_BOX: Box = [0, 0, 0, 1, 0.5, 1];
export const TOP_SLAB_BOX: Box = [0, 0.5, 0, 1, 1, 1];
const PLANT_BOX: Box = [0.15, 0, 0.15, 0.85, 1, 0.85];
const TORCH_BOX: Box = [0.35, 0, 0.35, 0.7, 0.875, 0.7];
export const WALL_FACINGS = ['north', 'south', 'east', 'west'] as const;
const WALL_BOXES: readonly Box[] = [
  [0, 0, 15 / 16, 1, 1, 1],
  [0, 0, 0, 1, 1, 1 / 16],
  [0, 0, 0, 1 / 16, 1, 1],
  [15 / 16, 0, 0, 1, 1, 1],
];
const WALL_TORCH_BOXES: readonly Box[] = [
  [0.35, 0.15, 0.45, 0.7, 1, 1],
  [0.35, 0.15, 0, 0.7, 1, 0.55],
  [0, 0.15, 0.35, 0.55, 1, 0.7],
  [0.45, 0.15, 0.35, 1, 1, 0.7],
];
/** Allocated once per world/controller, shared by targeting and placement. */
export class BlockShapes {
  readonly boxes: Array<Box | null>;
  readonly replaceable: Uint8Array;
  constructor(registry = BlockRegistry.getInstance()) {
    this.boxes = new Array(registry.getMaxStateId() + 1).fill(null);
    this.replaceable = new Uint8Array(this.boxes.length);
    for (const id of registry.getAllStateIds()) {
      const s = registry.getResolvedState(id)!;
      const model = s.definition.model;
      const facing = WALL_FACINGS.indexOf(s.properties.facing as (typeof WALL_FACINGS)[number]);
      this.replaceable[id] = Number(
        s.blockId === 'air' || (model === 'cross' && s.blockId !== 'torch'),
      );
      if (s.blockId === 'air' || s.blockId === 'water' || s.blockId === 'lava') continue;
      this.boxes[id] =
        s.blockId === 'wall_torch'
          ? WALL_TORCH_BOXES[facing]!
          : s.blockId === 'torch'
            ? TORCH_BOX
            : model === 'cross'
              ? PLANT_BOX
              : model === 'wall'
                ? WALL_BOXES[facing]!
                : model === 'slab'
                  ? s.properties.half === 'top'
                    ? TOP_SLAB_BOX
                    : BOTTOM_SLAB_BOX
                  : CUBE_BOX;
    }
  }
}

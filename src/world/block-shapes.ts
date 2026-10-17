import { BlockRegistry } from './blocks/registry';
import { boundingBox, stateBoxes, type Box } from './shape-geometry';
export * from './shape-geometry';

/** Allocated once per world/controller, shared by targeting and placement. */
export class BlockShapes {
  /** Bounding box of the targeting boxes; for single-box blocks it is that box. */
  readonly boxes: Array<Box | null>;
  /** Every targeting box of a state; the empty parts of a state are not hit by the ray. */
  readonly parts: Array<readonly Box[] | null>;
  readonly replaceable: Uint8Array;
  constructor(registry = BlockRegistry.getInstance()) {
    this.boxes = new Array(registry.getMaxStateId() + 1).fill(null);
    this.parts = new Array(this.boxes.length).fill(null);
    this.replaceable = new Uint8Array(this.boxes.length);
    for (const id of registry.getAllStateIds()) {
      const s = registry.getResolvedState(id)!;
      const model = s.definition.model;
      this.replaceable[id] = Number(
        s.blockId === 'air' || (model === 'cross' && s.blockId !== 'torch'),
      );
      const boxes = stateBoxes(s);
      if (!boxes) continue;
      this.parts[id] = boxes;
      this.boxes[id] = boxes.length === 1 ? boxes[0]! : boundingBox(boxes);
    }
  }
}

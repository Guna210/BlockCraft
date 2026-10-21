import { hash2, hashString } from '../../engine/rng';
import {
  cubeFaceRects,
  type AnimationClip,
  type EntityModel,
  type FaceName,
  type HeadTracking,
  type ModelCube,
  type ModelPart,
  type Vec3,
  type WalkAnimation,
} from '../ecs/model';

// Shared by the creature files: models written without UVs and laid out automatically, and a
// small pixel painter for their skins (ART.md: hand-picked ramps, clusters, light from the top-left).

export interface BoxSpec {
  from: Vec3;
  /** Whole model pixels, so every face maps to whole texels. */
  size: Vec3;
  inflate?: number;
}

export interface PartSpec {
  name: string;
  parent?: string;
  pivot: Vec3;
  rotation?: Vec3;
  cubes: BoxSpec[];
}

export interface ModelSpec {
  id: string;
  textureSize: [number, number];
  parts: PartSpec[];
  walk?: WalkAnimation;
  head?: HeadTracking;
  clips?: Record<string, AnimationClip>;
  emissive?: boolean;
}

/**
 * Builds a model, giving every cube its own box unwrap in the skin. Unwraps are packed in shelves,
 * tallest first (ties in declaration order), one texel apart; throws when they do not fit.
 */
export function buildModel(spec: ModelSpec): EntityModel {
  const [tw, th] = spec.textureSize;
  const parts: ModelPart[] = spec.parts.map((part) => ({
    name: part.name,
    ...(part.parent !== undefined ? { parent: part.parent } : {}),
    pivot: part.pivot,
    ...(part.rotation ? { rotation: part.rotation } : {}),
    cubes: part.cubes.map((box) => {
      if (!box.size.every((n) => Number.isInteger(n) && n >= 0))
        throw new Error(`Model ${spec.id}: part ${part.name} needs whole-pixel cube sizes`);
      const cube: ModelCube = { from: box.from, size: box.size, uv: [0, 0] };
      if (box.inflate) cube.inflate = box.inflate;
      return cube;
    }),
  }));
  const unwrap = (cube: ModelCube): [number, number] => [
    2 * (cube.size[0] + cube.size[2]),
    cube.size[2] + cube.size[1],
  ];
  const order = parts
    .flatMap((part) => part.cubes)
    .map((cube, n) => ({ cube, n }))
    .sort((a, b) => unwrap(b.cube)[1] - unwrap(a.cube)[1] || a.n - b.n);
  let x = 0,
    y = 0,
    row = 0;
  for (const { cube } of order) {
    const [uw, uh] = unwrap(cube);
    if (x + uw > tw) {
      x = 0;
      y += row + 1;
      row = 0;
    }
    if (y + uh > th || uw > tw) throw new Error(`Model ${spec.id}: unwraps do not fit the skin`);
    cube.uv = [x, y];
    x += uw + 1;
    row = Math.max(row, uh);
  }
  const model: EntityModel = { id: spec.id, textureSize: spec.textureSize, parts };
  if (spec.walk) model.walk = spec.walk;
  if (spec.head) model.head = spec.head;
  if (spec.clips) model.clips = spec.clips;
  if (spec.emissive) model.emissive = true;
  return model;
}

/** The cubes of one part, in order. */
export function cubesOf(model: EntityModel, part: string): ModelCube[] {
  const found = model.parts.find((p) => p.name === part);
  if (!found) throw new Error(`Model ${model.id} has no part ${part}`);
  return found.cubes;
}

/** A ramp of hex colours, dark to light. */
export type Ramp = readonly string[];

/** Pattern offset in ramp steps for a face pixel (x, y) of a w × h face. */
export type Pattern = (x: number, y: number, face: FaceName, w: number, h: number) => number;

export interface PaintOptions {
  /** Ramp index of the face's mid tone; may be fractional. Default: the middle of the ramp. */
  base?: number;
  /** Steps added from the top row of a side face down to its bottom row (lit from above). */
  falloff?: number;
  /** Steps added to the top face and to the bottom face. */
  top?: number;
  bottom?: number;
  pattern?: Pattern;
  /** Faces left untouched. */
  skip?: readonly FaceName[];
}

/** 4×4 ordered dither thresholds in [0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Writes RGBA pixels of a skin; every colour comes from the ramps and details it is given. */
export class SkinPainter {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly seed: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  /** Sets one pixel; null makes it transparent. Pixels outside the skin are ignored. */
  set(x: number, y: number, color: string | null): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    if (color === null) {
      this.data[o] = this.data[o + 1] = this.data[o + 2] = this.data[o + 3] = 0;
      return;
    }
    const [r, g, b] = hexRgb(color);
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
    this.data[o + 3] = 255;
  }

  /** Paints the face rects of a cube with a dithered ramp. */
  cube(cube: ModelCube, ramp: Ramp, options: PaintOptions = {}): void {
    const rects = cubeFaceRects(cube);
    const base = options.base ?? (ramp.length - 1) / 2;
    const falloff = options.falloff ?? 1;
    for (const face of Object.keys(rects) as FaceName[]) {
      if (options.skip?.includes(face)) continue;
      const [u, v, w, h] = rects[face];
      const faceShift =
        face === 'top' ? (options.top ?? 1) : face === 'bottom' ? (options.bottom ?? -1) : 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let level = base + faceShift;
          if (face !== 'top' && face !== 'bottom' && h > 1) level += falloff * (0.5 - y / (h - 1));
          // Light from the top-left: a slight lift toward the left edge of side faces.
          if (face !== 'top' && face !== 'bottom' && w > 2) level += 0.3 * (0.5 - x / (w - 1));
          if (options.pattern) level += options.pattern(x, y, face, w, h);
          const index = Math.max(
            0,
            Math.min(ramp.length - 1, Math.floor(level + BAYER[(y & 3) * 4 + (x & 3)]! - 0.5)),
          );
          this.set(u + x, v + y, ramp[index]!);
        }
    }
  }

  /** Clears a cube's whole unwrap to transparent. */
  clear(cube: ModelCube): void {
    const rects = cubeFaceRects(cube);
    for (const face of Object.keys(rects) as FaceName[]) {
      const [u, v, w, h] = rects[face];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(u + x, v + y, null);
    }
  }

  /**
   * Makes the bottom edge of a cube's side faces ragged: each column loses 0..depth texels to
   * transparency, in runs of 1–2 columns, so hanging hair reads as a shaggy fringe.
   */
  fringe(cube: ModelCube, depth: number, seed: number): void {
    const rects = cubeFaceRects(cube);
    for (const face of ['right', 'front', 'left', 'back'] as const) {
      const [u, v, w, h] = rects[face];
      for (let x = 0; x < w; x++) {
        const cut = Math.floor(
          hash2(seed + face.length * 31, Math.floor(x / 2), x % 2) * (depth + 1),
        );
        for (let y = h - Math.min(cut, h - 1); y < h; y++) this.set(u + x, v + y, null);
      }
    }
  }

  /** Paints a rectangle in face-local texels (x right, y down) of one face. */
  rect(
    cube: ModelCube,
    face: FaceName,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string | null,
  ): void {
    const [u, v] = cubeFaceRects(cube)[face];
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) this.set(u + x + dx, v + y + dy, color);
  }

  /** Width and height of a face in texels. */
  faceSize(cube: ModelCube, face: FaceName): [number, number] {
    const rect = cubeFaceRects(cube)[face];
    return [rect[2], rect[3]];
  }

  /** Every distinct opaque colour used, as lowercase hex. */
  colors(): Set<string> {
    const result = new Set<string>();
    for (let o = 0; o < this.data.length; o += 4) {
      if (this.data[o + 3] === 0) continue;
      const n = (this.data[o]! << 16) | (this.data[o + 1]! << 8) | this.data[o + 2]!;
      result.add('#' + n.toString(16).padStart(6, '0'));
    }
    return result;
  }
}

/** Seed for one painted feature, so features of one skin vary independently. */
export function featureSeed(seed: number, label: string): number {
  return (seed ^ hashString(label)) >>> 0;
}

/**
 * Clumps: blocks of `cell` texels, every other row shifted by half a cell so clumps interlock,
 * each lifted or sunk by up to `amount` steps. Gives 2–6 texel clusters rather than speckle.
 */
export function clumps(seed: number, cell: number, amount: number): Pattern {
  return (x, y, face) => {
    const row = Math.floor(y / cell);
    const shift = row % 2 === 0 ? 0 : Math.floor(cell / 2);
    const col = Math.floor((x + shift) / cell);
    const n = hash2(seed + face.length * 7919, col, row);
    return n < 0.3 ? -amount : n > 0.72 ? amount : 0;
  };
}

/** Vertical strands 1 texel wide and 2–3 long, alternately light and dark: fur, wool fringes, bristles. */
export function strands(seed: number, amount: number): Pattern {
  return (x, y, face) => {
    const n = hash2(seed + face.length * 104729, x, Math.floor((y + (x % 3)) / 3));
    return n < 0.25 ? -amount : n > 0.75 ? amount : 0;
  };
}

/** Round 2×2 spots on a regular, jittered grid: dapples. */
export function spots(seed: number, spacing: number, amount: number): Pattern {
  return (x, y, face) => {
    const cx = Math.floor(x / spacing),
      cy = Math.floor(y / spacing);
    const ox = Math.floor(hash2(seed + face.length, cx, cy) * (spacing - 1));
    const oy = Math.floor(hash2(seed + face.length + 17, cx, cy) * (spacing - 1));
    const dx = x - cx * spacing - ox,
      dy = y - cy * spacing - oy;
    return dx >= 0 && dx < 2 && dy >= 0 && dy < 2 ? amount : 0;
  };
}

/** Sum of patterns. */
export function combine(...patterns: Pattern[]): Pattern {
  return (x, y, face, w, h) => patterns.reduce((sum, p) => sum + p(x, y, face, w, h), 0);
}

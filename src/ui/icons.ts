import { items, type ItemDefinition } from '../gameplay/items';
import { BlockRegistry } from '../world/blocks/registry';
import type { TextureAtlas } from '../render/atlas';
import { inventoryItemGenerators } from '../render/textures/inventory-items';
import { stateBoxes, type Box } from '../world/shape-geometry';

export const ICON_SIZE = 16;
const COLUMNS = 16;

/** A 16×16 RGBA tile. */
export type Tile = ArrayLike<number>;
/** Resolves a texture name to its 16×16 tile, or undefined when no such texture exists. */
export type TileLookup = (name: string) => Tile | undefined;

export interface IconSheet {
  width: number;
  height: number;
  /** RGBA, row-major; transparent where an icon draws nothing. */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** Top-left corner of each icon, keyed by item id and by block id. */
  rects: Map<string, { x: number; y: number }>;
}

type Tint = 'none' | 'grass' | 'foliage' | 'grass_side';
const TINTS: Record<Exclude<Tint, 'none' | 'grass_side'>, readonly number[]> = {
  // The plains biome colors, as in BIOME_DEFINITIONS.
  grass: [124, 189, 71],
  foliage: [119, 177, 58],
};
const FOLIAGE_BLOCKS = new Set(['oak_leaves', 'rainwood_leaves', 'acacia_leaves', 'vine']);
const OUTLINE: readonly number[] = [21, 18, 31, 255];
const CUTOUT_BACKING: readonly number[] = [18, 28, 20];
// Top is lightest; light comes from the top-left, so the left face is lit more than the right.
const SHADE = { top: 1.12, left: 0.88, right: 0.66 } as const;
const TRANSLUCENT_MIN_ALPHA = 115;

interface Face {
  tile: Tile;
  tint: Tint;
}

/** Creates a tile lookup over the world atlas, falling back to the extra item sprites. */
export function createTileLookup(atlas: TextureAtlas): TileLookup {
  const cache = new Map<string, Tile | undefined>();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    const rect = atlas.rects.get(name) ?? atlas.rects.get(`${name}_0`);
    let tile: Tile | undefined;
    if (rect) {
      const out = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
      for (let y = 0; y < ICON_SIZE; y++) {
        const from = ((rect.y + y) * atlas.width + rect.x) * 4;
        out.set(atlas.mips[0]!.subarray(from, from + ICON_SIZE * 4), y * ICON_SIZE * 4);
      }
      tile = out;
    } else tile = inventoryItemGenerators[name]?.(42);
    cache.set(name, tile);
    return tile;
  };
}

function faceFor(
  lookup: TileLookup,
  name: string | undefined,
  tint: Tint,
  missing: (name: string) => Tile,
): Face {
  if (!name) throw new Error('Block face has no texture');
  return { tile: lookup(name) ?? missing(name), tint };
}

function samplePixel(face: Face, u: number, v: number, out: number[]): void {
  const tx = Math.min(ICON_SIZE - 1, Math.max(0, Math.floor(u * ICON_SIZE)));
  const ty = Math.min(ICON_SIZE - 1, Math.max(0, Math.floor(v * ICON_SIZE)));
  const i = (ty * ICON_SIZE + tx) * 4;
  let r = face.tile[i]!;
  let g = face.tile[i + 1]!;
  let b = face.tile[i + 2]!;
  let a = face.tile[i + 3]!;
  if (face.tint === 'grass_side') {
    // The alpha channel of a grass side selects the tinted fringe; the dirt below stays untinted.
    const t = TINTS.grass;
    const m = a / 255;
    r *= 1 + (t[0]! / 255 - 1) * m;
    g *= 1 + (t[1]! / 255 - 1) * m;
    b *= 1 + (t[2]! / 255 - 1) * m;
    a = 255;
  } else if (face.tint !== 'none') {
    const t = TINTS[face.tint];
    r *= t[0]! / 255;
    g *= t[1]! / 255;
    b *= t[2]! / 255;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
}

/** Shadows are cooler: the blue channel loses less than red and green. */
function shade(color: number[], factor: number): void {
  color[0] = color[0]! * factor;
  color[1] = color[1]! * factor;
  color[2] = color[2]! * Math.pow(factor, 0.8);
}

function outlineFlat(icon: Uint8ClampedArray): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < ICON_SIZE && y < ICON_SIZE && icon[(y * ICON_SIZE + x) * 4 + 3]! > 0;
  const edge: number[] = [];
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++)
      if (
        !solid(x, y) &&
        (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
      )
        edge.push(y * ICON_SIZE + x);
  for (const n of edge) icon.set(OUTLINE, n * 4);
}

function renderFlat(face: Face): Uint8ClampedArray {
  const icon = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) {
      samplePixel(face, (x + 0.5) / ICON_SIZE, (y + 0.5) / ICON_SIZE, px);
      if (px[3]! < 128) continue;
      icon.set([px[0]!, px[1]!, px[2]!, 255], (y * ICON_SIZE + x) * 4);
    }
  outlineFlat(icon);
  return icon;
}

/**
 * Isometric box: a 2:1 top diamond and two side faces, `height` pixels tall at the corners (8 is a
 * full cube). Every pixel center is mapped back onto the face it shows, so no resampling blur.
 */
function renderBox(
  top: Face,
  left: Face,
  right: Face,
  height: number,
  layer: 'opaque' | 'cutout' | 'translucent',
): Uint8ClampedArray {
  const icon = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
  const cy = 4 + (8 - height);
  const covered = new Uint8Array(ICON_SIZE * ICON_SIZE);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      let face: Face;
      let factor: number;
      let u: number;
      let v: number;
      if (Math.abs(fx - 8) / 8 + Math.abs(fy - cy) / 4 < 1) {
        face = top;
        factor = SHADE.top;
        u = ((fx - 8) / 8 + (fy - cy) / 4 + 1) / 2;
        v = ((fy - cy) / 4 - (fx - 8) / 8 + 1) / 2;
      } else {
        const isLeft = fx < 8;
        const yTop = isLeft ? cy + fx / 2 : cy + (16 - fx) / 2;
        if (fy < yTop || fy >= yTop + height) continue;
        face = isLeft ? left : right;
        factor = isLeft ? SHADE.left : SHADE.right;
        u = (isLeft ? fx : fx - 8) / 8;
        // A shorter box shows the lower part of the side texture.
        v = 1 - height / 8 + (fy - yTop) / 8;
      }
      samplePixel(face, u, v, px);
      if (layer === 'opaque') px[3] = 255;
      else if (layer === 'cutout') {
        if (px[3]! < 128) {
          px[0] = CUTOUT_BACKING[0]!;
          px[1] = CUTOUT_BACKING[1]!;
          px[2] = CUTOUT_BACKING[2]!;
        }
        px[3] = 255;
      } else px[3] = Math.max(px[3]!, TRANSLUCENT_MIN_ALPHA);
      shade(px, factor);
      covered[y * ICON_SIZE + x] = 1;
      icon.set([px[0]!, px[1]!, px[2]!, px[3]!], (y * ICON_SIZE + x) * 4);
    }
  darkenSilhouette(icon, covered);
  return icon;
}

/** Darkens the silhouette so each icon has a firm edge against any background. */
function darkenSilhouette(icon: Uint8ClampedArray, covered: Uint8Array): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < ICON_SIZE && y < ICON_SIZE && covered[y * ICON_SIZE + x] === 1;
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) {
      if (
        !solid(x, y) ||
        (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))
      )
        continue;
      const i = (y * ICON_SIZE + x) * 4;
      icon[i] = icon[i]! * 0.55;
      icon[i + 1] = icon[i + 1]! * 0.55;
      icon[i + 2] = icon[i + 2]! * 0.6;
      icon[i + 3] = 255;
    }
}

/**
 * Isometric view of several boxes (stairs, fences, trapdoors), drawn with the same projection as
 * `renderBox`: x = 8 + 8 (bx - bz), y = 4 (bx + bz) - 8 by + 8 for a point (bx, by, bz) of the unit
 * block. Each pixel follows the view ray (1, 1, 1) back to the nearest box surface.
 */
function renderBoxes(boxes: readonly Box[], top: Face, left: Face, right: Face): Uint8ClampedArray {
  const icon = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
  const covered = new Uint8Array(ICON_SIZE * ICON_SIZE);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) {
      const a = (x + 0.5 - 8) / 8;
      const b = (y + 0.5 - 8) / 4;
      const ox = (a + b) / 2;
      const oz = (b - a) / 2;
      let best = -Infinity;
      let face: Face | null = null;
      let factor = 1;
      let u = 0;
      let v = 0;
      for (const box of boxes) {
        const tx = box[3] - ox;
        const ty = box[4];
        const tz = box[5] - oz;
        const exit = Math.min(tx, ty, tz);
        const enter = Math.max(box[0] - ox, box[1], box[2] - oz);
        if (enter >= exit || exit <= best) continue;
        best = exit;
        const hx = ox + exit;
        const hy = exit;
        const hz = oz + exit;
        if (exit === ty) {
          face = top;
          factor = SHADE.top;
          u = hx;
          v = hz;
        } else if (exit === tz) {
          face = left;
          factor = SHADE.left;
          u = hx;
          v = 1 - hy;
        } else {
          face = right;
          factor = SHADE.right;
          u = 1 - hz;
          v = 1 - hy;
        }
      }
      if (!face) continue;
      samplePixel(face, u, v, px);
      px[3] = 255;
      shade(px, factor);
      covered[y * ICON_SIZE + x] = 1;
      icon.set([px[0]!, px[1]!, px[2]!, px[3]!], (y * ICON_SIZE + x) * 4);
    }
  darkenSilhouette(icon, covered);
  return icon;
}

function renderBlockIcon(
  item: ItemDefinition,
  lookup: TileLookup,
  missing: (name: string) => Tile,
): Uint8ClampedArray | null {
  const registry = BlockRegistry.getInstance();
  const stateId = registry.getDefaultStateId(item.block!)!;
  const def = registry.getResolvedState(stateId)!.definition;
  // Air is the only block without textures, and it has nothing to show.
  if (!def.textures) return null;
  const foliage = FOLIAGE_BLOCKS.has(def.id);
  const faceName = (face: 'top' | 'south' | 'east') => {
    if (face === 'south' && def.textures?.front) {
      const lit = String(registry.getResolvedState(stateId)?.properties['lit']) === 'true';
      return lit && def.textures.front_lit ? def.textures.front_lit : def.textures.front;
    }
    return registry.getFaceTexture(stateId, face);
  };

  if (def.model === 'cross' || def.model === 'wall' || def.model === 'wall_torch') {
    const tint: Tint = foliage ? 'foliage' : def.id === 'tall_grass' ? 'grass' : 'none';
    return renderFlat(faceFor(lookup, def.textures.side ?? def.textures.top, tint, missing));
  }
  if (def.model === 'door')
    return renderFlat(faceFor(lookup, def.textures.item ?? def.textures.side, 'none', missing));
  if (def.model === 'stairs' || def.model === 'fence' || def.model === 'trapdoor') {
    // A fence shows its arms in the icon.
    const iconState =
      def.model === 'fence'
        ? registry.getStateId(def.id, { east: 'true', west: 'true' })!
        : stateId;
    return renderBoxes(
      stateBoxes(registry.getResolvedState(iconState)!)!,
      faceFor(lookup, faceName('top'), 'none', missing),
      faceFor(lookup, faceName('south'), 'none', missing),
      faceFor(lookup, faceName('east'), 'none', missing),
    );
  }
  const grass = def.id === 'grass_block';
  const topTint: Tint = grass ? 'grass' : foliage ? 'foliage' : 'none';
  const sideTint: Tint = grass ? 'grass_side' : foliage ? 'foliage' : 'none';
  return renderBox(
    faceFor(lookup, faceName('top'), topTint, missing),
    faceFor(lookup, faceName('south'), sideTint, missing),
    faceFor(lookup, faceName('east'), sideTint, missing),
    def.model === 'slab' ? 4 : 8,
    // Water uses depth-based transmission in the world. A thumbnail has no
    // scene depth, so keep its shaded blue faces opaque for legibility.
    def.id === 'water' ? 'opaque' : def.renderLayer,
  );
}

/**
 * Builds the icon sheet for every registered item in one pass. Block items become isometric
 * icons (or flat sprites for plants and wall decorations); other items reuse their 16×16 sprite.
 * Later blocks and items need no code here: they appear through the registries.
 */
export function buildIconSheet(
  lookup: TileLookup,
  sentinel: Tile,
  onMissing: (name: string) => void = () => {},
): IconSheet {
  const count = items.items.size;
  const width = COLUMNS * ICON_SIZE;
  const height = Math.ceil(count / COLUMNS) * ICON_SIZE;
  const data = new Uint8ClampedArray(width * height * 4);
  const rects = new Map<string, { x: number; y: number }>();
  const missing = (name: string): Tile => {
    onMissing(name);
    return sentinel;
  };
  let n = 0;
  for (const item of items.items.values()) {
    const icon = item.block
      ? renderBlockIcon(item, lookup, missing)
      : renderFlat({
          tile: lookup(item.texture ?? '') ?? missing(item.texture ?? item.id),
          tint: 'none',
        });
    const x = (n % COLUMNS) * ICON_SIZE;
    const y = Math.floor(n / COLUMNS) * ICON_SIZE;
    n++;
    rects.set(item.id, { x, y });
    if (item.block) rects.set(item.block, { x, y });
    if (!icon) continue;
    for (let row = 0; row < ICON_SIZE; row++)
      data.set(
        icon.subarray(row * ICON_SIZE * 4, (row + 1) * ICON_SIZE * 4),
        ((y + row) * width + x) * 4,
      );
  }
  return { width, height, data, rects };
}

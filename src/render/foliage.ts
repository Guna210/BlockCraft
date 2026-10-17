import { TextureAtlas, CELL_SIZE } from './atlas';
import type { BlockRegistry } from '../world/blocks/registry';

/** Leaf textures that can have their own fast-mode fill colour (fragment uniform arrays are this long). */
export const MAX_LEAF_FILLS = 16;

/** A colour must cover this share of a leaf's opaque pixels to be its fill colour. */
const FILL_MIN_SHARE = 0.15;

/** Number of 32-bit words in a sway mask: one bit per atlas tile, 4096 tiles. */
export const SWAY_MASK_WORDS = 128;

export interface SwayMasks {
  leaf: Uint32Array;
  plant: Uint32Array;
}

export interface LeafFills {
  /** Atlas tile index of each leaf texture. */
  tiles: Int32Array;
  /** rgb in 0..1, three floats per entry. */
  colors: Float32Array;
  count: number;
}

export function atlasTileIndex(atlas: TextureAtlas, name: string): number {
  const rect = atlas.rects.get(name)!;
  return (
    Math.floor(rect.y / CELL_SIZE) * Math.floor(atlas.width / CELL_SIZE) +
    Math.floor(rect.x / CELL_SIZE)
  );
}

/** Bit masks over atlas tiles of leaves and swaying plants (cross-model cutouts except torch and fire). */
export function buildSwayMasks(registry: BlockRegistry, atlas: TextureAtlas): SwayMasks {
  const leaf = new Uint32Array(SWAY_MASK_WORDS);
  const plant = new Uint32Array(SWAY_MASK_WORDS);
  for (const id of registry.getAllBlockIds()) {
    const def = registry.getBlockDefinition(id);
    if (!def || def.renderLayer !== 'cutout') continue;
    const target = id.endsWith('_leaves')
      ? leaf
      : def.model === 'cross' && id !== 'fire' && id !== 'torch'
        ? plant
        : null;
    const texture = def.textures?.side;
    if (!target || !texture || !atlas.rects.has(texture)) continue;
    const tile = atlasTileIndex(atlas, texture);
    target[tile >> 5] = (target[tile >> 5]! | (1 << (tile & 31))) >>> 0;
  }
  return { leaf, plant };
}

/**
 * The vertex shader reads a mask as `uvec4 mask[32]`: word w sits in vector w >> 2, component w & 3.
 * The upload is the same contiguous words, so this mirrors the shader's lookup exactly.
 */
export function packedMaskHas(mask: Uint32Array, tile: number): boolean {
  const word = tile >> 5;
  const vec = word >> 2;
  const component = word & 3;
  return ((mask[vec * 4 + component]! >>> (tile & 31)) & 1) === 1;
}

/**
 * The colour that replaces see-through pixels of a leaf texture in fast mode: the darkest colour that
 * covers at least FILL_MIN_SHARE of the opaque pixels, the leaf's own shaded mid-tone rather than a
 * rare near-black accent. The shader multiplies it by the biome tint like the rest of the leaf.
 */
export function buildLeafFills(registry: BlockRegistry, atlas: TextureAtlas): LeafFills {
  const tiles = new Int32Array(MAX_LEAF_FILLS).fill(-1);
  const colors = new Float32Array(MAX_LEAF_FILLS * 3);
  let count = 0;
  const seen = new Set<string>();
  for (const id of registry.getAllBlockIds()) {
    if (!id.endsWith('_leaves')) continue;
    const texture = registry.getBlockDefinition(id)?.textures?.side;
    if (!texture || seen.has(texture) || !atlas.rects.has(texture) || count >= MAX_LEAF_FILLS)
      continue;
    seen.add(texture);
    const rect = atlas.rects.get(texture)!;
    const distinct = new Map<number, { lum: number; n: number }>();
    let opaque = 0;
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const i = ((rect.y + y) * atlas.width + rect.x + x) * 4;
        const px = atlas.mips[0]!;
        if (px[i + 3]! < 128) continue;
        const key = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
        const entry = distinct.get(key) ?? {
          lum: 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!,
          n: 0,
        };
        entry.n++;
        distinct.set(key, entry);
        opaque++;
      }
    const ramp = [...distinct.entries()].sort((a, b) => a[1].lum - b[1].lum);
    const body = ramp.find(([, e]) => e.n >= opaque * FILL_MIN_SHARE);
    const pick = body ?? ramp.sort((a, b) => b[1].n - a[1].n)[0];
    if (!pick) continue;
    tiles[count] = atlasTileIndex(atlas, texture);
    colors[count * 3] = ((pick[0] >> 16) & 255) / 255;
    colors[count * 3 + 1] = ((pick[0] >> 8) & 255) / 255;
    colors[count * 3 + 2] = (pick[0] & 255) / 255;
    count++;
  }
  return { tiles, colors, count };
}

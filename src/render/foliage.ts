import { TextureAtlas, CELL_SIZE } from './atlas';
import type { BlockRegistry } from '../world/blocks/registry';

/** Number of 32-bit words in a sway mask: one bit per atlas tile, 4096 tiles. */
export const SWAY_MASK_WORDS = 128;

export interface SwayMasks {
  leaf: Uint32Array;
  plant: Uint32Array;
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

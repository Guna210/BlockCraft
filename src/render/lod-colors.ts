import { BIOME_DEFINITIONS, OVERWORLD_BIOME_IDS } from '../gen/biomes';
import type { BlockRegistry } from '../world/blocks/registry';
import type { TextureAtlas } from './atlas';
import { atlasTileIndex } from './foliage';

export const LOD_SNOW = OVERWORLD_BIOME_IDS.length;
export const LOD_SAND = LOD_SNOW + 1;
export const LOD_GRAVEL = LOD_SNOW + 2;
export const LOD_STONE = LOD_SNOW + 3;
export const LOD_WATER = LOD_SNOW + 4;

/** Top tile, side tile with a grass-fringe flag, and packed biome tint. */
export function buildLodMaterials(atlas: TextureAtlas, registry: BlockRegistry): Int32Array {
  const materials = new Int32Array((LOD_WATER + 1) * 3);
  const write = (index: number, id: string, tint?: readonly number[]) => {
    const textures = registry.getBlockDefinition(id)?.textures;
    const top = id === 'water' ? 'water_0' : textures?.top;
    if (!top) throw new Error(`Missing LOD surface texture for ${id}`);
    materials[index * 3] = atlasTileIndex(atlas, top);
    materials[index * 3 + 1] =
      atlasTileIndex(atlas, textures?.side && id !== 'water' ? textures.side : top) |
      (id === 'grass_block' ? 4096 : 0);
    materials[index * 3 + 2] =
      (tint?.[0] ?? 255) | ((tint?.[1] ?? 255) << 8) | ((tint?.[2] ?? 255) << 16);
  };
  OVERWORLD_BIOME_IDS.forEach((id, index) => {
    const biome = BIOME_DEFINITIONS[id];
    const block = biome.surfaceRules.topBlock;
    write(index, block, block === 'grass_block' ? biome.grassTint : undefined);
  });
  write(LOD_SNOW, 'snow');
  write(LOD_SAND, 'sand');
  write(LOD_GRAVEL, 'gravel');
  write(LOD_STONE, 'stone');
  write(LOD_WATER, 'water');
  return materials;
}

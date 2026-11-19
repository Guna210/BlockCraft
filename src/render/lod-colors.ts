import { BIOME_DEFINITIONS, OVERWORLD_BIOME_IDS } from '../gen/biomes';
import type { TextureData } from '../gen/texture-noise';
import type { BlockRegistry } from '../world/blocks/registry';

export interface LodColors {
  ground: Uint32Array;
  snow: number;
  water: number;
}

export function averageLodColor(pixels: ArrayLike<number>, tint?: readonly number[]): number {
  let r = 0,
    g = 0,
    b = 0,
    weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;
    r += pixels[i]! * alpha;
    g += pixels[i + 1]! * alpha;
    b += pixels[i + 2]! * alpha;
    weight += alpha;
  }
  return (
    Math.round(((r / weight) * (tint?.[0] ?? 255)) / 255) |
    (Math.round(((g / weight) * (tint?.[1] ?? 255)) / 255) << 8) |
    (Math.round(((b / weight) * (tint?.[2] ?? 255)) / 255) << 16)
  );
}

export function buildLodColors(
  tiles: ReadonlyMap<string, TextureData>,
  registry: BlockRegistry,
): LodColors {
  const color = (block: string, tint?: readonly number[]) => {
    const top = registry.getBlockDefinition(block)?.textures?.top;
    const tile = top && (tiles.get(top) ?? tiles.get(`${top}_0`));
    if (!tile) throw new Error(`Missing LOD surface texture for ${block}`);
    return averageLodColor(tile, tint);
  };
  return {
    ground: Uint32Array.from(OVERWORLD_BIOME_IDS, (id) => {
      const biome = BIOME_DEFINITIONS[id];
      const block = biome.surfaceRules.topBlock;
      return color(block, block === 'grass_block' ? biome.grassTint : undefined);
    }),
    snow: color('snow'),
    water: color('water'),
  };
}

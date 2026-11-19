import type { BlockRegistry } from '../../world/blocks/registry';
import type { BlockFaceDirection, ResolvedBlockState } from '../../world/blocks/types';
import { TextureAtlas } from '../atlas';
import { atlasTileIndex } from '../foliage';

/** Width and height of the square atlas-tile emissive lookup table (4,096 tiles total). */
export const EMISSIVE_TABLE_SIZE = 64;
const MAX_TILES = EMISSIVE_TABLE_SIZE * EMISSIVE_TABLE_SIZE;
const FACES: readonly BlockFaceDirection[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];
const FLUID_ANIMATION_FRAMES = 32;

/** Returns a block state's block-light emission level (0..15), matching lighting.ts. */
export function stateLightEmission(resolved: ResolvedBlockState): number {
  const def = resolved.definition;
  let emission = def.lightEmission ?? 0;
  if (def.lightEmissionWhen) {
    const rules = Array.isArray(def.lightEmissionWhen)
      ? def.lightEmissionWhen
      : [def.lightEmissionWhen];
    for (const rule of rules) {
      let match = true;
      for (const [key, val] of Object.entries(rule)) {
        if (key === 'value') continue;
        if (String(resolved.properties[key]) !== String(val)) {
          match = false;
          break;
        }
      }
      if (match && typeof rule.value === 'number') {
        emission = rule.value;
        break;
      }
    }
  } else if (resolved.blockId === 'lava') {
    emission = 15;
  }
  return Math.max(0, Math.min(15, emission));
}

function recordTileEmission(
  tileName: string,
  emission: number,
  atlas: TextureAtlas,
  seenNonEmissive: Uint8Array,
  maxEmission: Uint8Array,
): void {
  if (atlas.rects.has(tileName)) {
    const idx = atlasTileIndex(atlas, tileName);
    if (idx >= 0 && idx < MAX_TILES) {
      if (emission > 0) {
        if (emission > maxEmission[idx]!) maxEmission[idx] = emission;
      } else {
        seenNonEmissive[idx] = 1;
      }
    }
  }
  // Animated fluid/fire sequences place frame tiles at `<name>_0` .. `<name>_31`.
  if (atlas.rects.has(`${tileName}_0`)) {
    for (let frame = 0; frame < FLUID_ANIMATION_FRAMES; frame++) {
      const frameName = `${tileName}_${frame}`;
      if (!atlas.rects.has(frameName)) break;
      const idx = atlasTileIndex(atlas, frameName);
      if (idx >= 0 && idx < MAX_TILES) {
        if (emission > 0) {
          if (emission > maxEmission[idx]!) maxEmission[idx] = emission;
        } else {
          seenNonEmissive[idx] = 1;
        }
      }
    }
  }
}

/**
 * Builds a 64x64 R8 lookup table keyed by `atlasTileIndex` so the bloom pass identifies emissive
 * block faces without modifying terrain vertex layouts or section meshes.
 *
 * Tiles shared with unlit states (such as kiln top/side/bottom housing faces) remain 0 so only
 * genuinely glowing faces bloom.
 */
export function buildEmissiveTileTable(registry: BlockRegistry, atlas: TextureAtlas): Uint8Array {
  const seenNonEmissive = new Uint8Array(MAX_TILES);
  const maxEmission = new Uint8Array(MAX_TILES);
  const table = new Uint8Array(MAX_TILES);

  for (const stateId of registry.getAllStateIds()) {
    const resolved = registry.getResolvedState(stateId);
    if (!resolved) continue;
    const emission = stateLightEmission(resolved);
    for (const face of FACES) {
      const textureName = registry.getFaceTexture(stateId, face);
      if (!textureName) continue;
      recordTileEmission(textureName, emission, atlas, seenNonEmissive, maxEmission);
    }
  }

  for (let i = 0; i < MAX_TILES; i++) {
    if (maxEmission[i]! > 0 && !seenNonEmissive[i]) {
      table[i] = Math.round((maxEmission[i]! / 15) * 255);
    }
  }

  return table;
}

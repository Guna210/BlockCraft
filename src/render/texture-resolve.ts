import { AtlasRect, TextureAtlas } from './atlas';
import { renderStats } from '../debug/api/core';

export const SENTINEL_KEY = '__sentinel';

/**
 * Creates a 16x16 RGBA texture data array representing
 * a magenta (#FF00FF) and black (#000000) checkerboard with 2x2 pixel checks.
 */
export function createSentinelTile(): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4;
      const checkX = Math.floor(x / 2);
      const checkY = Math.floor(y / 2);
      const isMagenta = (checkX + checkY) % 2 === 0;

      if (isMagenta) {
        data[idx] = 255; // R
        data[idx + 1] = 0; // G
        data[idx + 2] = 255; // B
        data[idx + 3] = 255; // A
      } else {
        data[idx] = 0; // R
        data[idx + 1] = 0; // G
        data[idx + 2] = 0; // B
        data[idx + 3] = 255; // A
      }
    }
  }
  return data;
}

/**
 * Resolves a texture name against the texture atlas.
 * If the texture is missing, records it in renderStats.missingTextures
 * and returns the sentinel rect.
 */
export function resolveTexture(name: string, atlas: TextureAtlas): AtlasRect {
  const rect = atlas.rects.get(name);
  if (rect) {
    return rect;
  }

  if (!renderStats.missingTextures.includes(name)) {
    renderStats.missingTextures.push(name);
  }

  const sentinelRect = atlas.rects.get(SENTINEL_KEY);
  if (sentinelRect) {
    return sentinelRect;
  }

  // Fallback default rect if sentinel isn't present in the atlas map
  return { x: 0, y: 0, w: 16, h: 16 };
}

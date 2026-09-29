import { describe, it, expect, beforeEach } from 'vitest';
import { TextureAtlas } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures/index';
import { TextureData } from '../../src/render/textures/noise';
import { SCENE_MATERIALS } from '../../src/render/scene-materials';
import { resolveTexture, createSentinelTile, SENTINEL_KEY } from '../../src/render/texture-resolve';
import { renderStats } from '../../src/debug/api/core';

describe('Texture Resolution & Sentinel Unit Tests', () => {
  beforeEach(() => {
    renderStats.missingTextures = [];
  });

  it('resolves every texture in SCENE_MATERIALS to a real atlas rect (not sentinel)', () => {
    const tiles = new Map<string, TextureData>();
    for (const [name, generator] of Object.entries(textureGenerators)) {
      const res = generator(42);
      if (Array.isArray(res)) {
        res.forEach((frame, idx) => {
          tiles.set(`${name}_${idx}`, frame);
        });
      } else {
        tiles.set(name, res);
      }
    }
    tiles.set(SENTINEL_KEY, createSentinelTile());

    const atlas = new TextureAtlas(tiles);
    const sentinelRect = atlas.rects.get(SENTINEL_KEY)!;
    expect(sentinelRect).toBeDefined();

    for (const mat of SCENE_MATERIALS) {
      const topRect = resolveTexture(mat.top, atlas);
      const sideRect = resolveTexture(mat.side, atlas);
      const bottomRect = resolveTexture(mat.bottom, atlas);

      expect(topRect).not.toEqual(sentinelRect);
      expect(sideRect).not.toEqual(sentinelRect);
      expect(bottomRect).not.toEqual(sentinelRect);

      expect(topRect.w).toBe(16);
      expect(sideRect.w).toBe(16);
      expect(bottomRect.w).toBe(16);
    }

    expect(renderStats.missingTextures).toHaveLength(0);
  });

  it('resolves every key in textureGenerators to a real atlas rect (not sentinel)', () => {
    const tiles = new Map<string, TextureData>();
    for (const [name, generator] of Object.entries(textureGenerators)) {
      const res = generator(42);
      if (Array.isArray(res)) {
        res.forEach((frame, idx) => {
          tiles.set(`${name}_${idx}`, frame);
        });
      } else {
        tiles.set(name, res);
      }
    }
    tiles.set(SENTINEL_KEY, createSentinelTile());

    const atlas = new TextureAtlas(tiles);
    const sentinelRect = atlas.rects.get(SENTINEL_KEY)!;

    for (const key of Object.keys(textureGenerators)) {
      const genResult = textureGenerators[key]!(42);
      if (Array.isArray(genResult)) {
        genResult.forEach((_, idx) => {
          const rect = resolveTexture(`${key}_${idx}`, atlas);
          expect(rect).not.toEqual(sentinelRect);
        });
      } else {
        const rect = resolveTexture(key, atlas);
        expect(rect).not.toEqual(sentinelRect);
      }
    }

    expect(renderStats.missingTextures).toHaveLength(0);
  });

  it('resolves unknown texture names to the sentinel rect and records them in missingTextures', () => {
    const tiles = new Map<string, TextureData>();
    tiles.set(SENTINEL_KEY, createSentinelTile());

    const atlas = new TextureAtlas(tiles);
    const sentinelRect = atlas.rects.get(SENTINEL_KEY)!;

    const unknownName = 'non_existent_texture_block';
    const rect = resolveTexture(unknownName, atlas);

    expect(rect).toEqual(sentinelRect);
    expect(renderStats.missingTextures).toContain(unknownName);
  });
});

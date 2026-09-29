import { describe, it, expect, beforeEach } from 'vitest';
import { TextureAtlas } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures/index';
import { TextureData } from '../../src/render/textures/noise';
import { SCENE_MATERIALS } from '../../src/render/scene-materials';
import { resolveTexture, createSentinelTile, SENTINEL_KEY } from '../../src/render/texture-resolve';
import { renderStats } from '../../src/debug/api/core';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { BlockFaceDirection } from '../../src/world/blocks/types';

describe('Texture Resolution & Sentinel Unit Tests', () => {
  beforeEach(() => {
    renderStats.missingTextures = [];
    BlockRegistry.resetInstance();
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

  it('resolves every face of every texture-bearing block in the real registry (including log axis states) to a real atlas rect', () => {
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

    const registry = BlockRegistry.getInstance();
    const faces: BlockFaceDirection[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];

    for (const stateId of registry.getAllStateIds()) {
      const resolved = registry.getResolvedState(stateId)!;
      if (resolved.blockId === 'air') continue;

      for (const face of faces) {
        const texName = registry.getFaceTexture(stateId, face);
        expect(texName).toBeDefined();
        const rect = resolveTexture(texName!, atlas);
        expect(rect).not.toEqual(sentinelRect);
        expect(rect.w).toBe(16);
      }
    }

    expect(renderStats.missingTextures).toHaveLength(0);
  });

  it('resolves animated base names (water, lava) to _0 frames without missingTextures, and returns sentinel for non-existent textures', () => {
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
    const water0Rect = atlas.rects.get('water_0')!;
    const lava0Rect = atlas.rects.get('lava_0')!;

    expect(water0Rect).toBeDefined();
    expect(lava0Rect).toBeDefined();

    const waterRect = resolveTexture('water', atlas);
    const lavaRect = resolveTexture('lava', atlas);

    expect(waterRect).toEqual(water0Rect);
    expect(lavaRect).toEqual(lava0Rect);
    expect(waterRect).not.toEqual(sentinelRect);
    expect(lavaRect).not.toEqual(sentinelRect);
    expect(renderStats.missingTextures).toHaveLength(0);

    const unknownRect = resolveTexture('totally_fake_texture', atlas);
    expect(unknownRect).toEqual(sentinelRect);
    expect(renderStats.missingTextures).toContain('totally_fake_texture');
  });
});

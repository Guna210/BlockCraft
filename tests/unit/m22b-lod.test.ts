import { createFakeIdb } from './helpers/fake-idb';
import { SaveDb } from '../../src/persist/idb';
import { lodFaceUv } from '../../src/render/lod-vertex';
import { TextureAtlas } from '../../src/render/atlas';
import { atlasTileIndex } from '../../src/render/foliage';
import { defaultSettings } from '../../src/engine/settings';
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../../src/engine/settings-persistence';
import { describe, expect, it } from 'vitest';
import { hashString } from '../../src/engine/rng';
import { SEA_LEVEL } from '../../src/gen/terrain';
import { textureGenerators } from '../../src/render/textures';
import { buildLodMaterials } from '../../src/render/lod-colors';
import { buildLodMesh } from '../../src/render/lod-mesh';
import { LodColumnMask, lodStep, lodTileDistance } from '../../src/render/lod-plan';
import { SectionVisibility } from '../../src/render/section-visibility';
import { loadingProgress } from '../../src/ui/loading-screen';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { streamRings } from '../../src/world/streaming-plan';

describe('heightmap LOD', () => {
  it.each([8, 12, 13, 16, 32])(
    'preserves the mesh perimeter and keep rings at RD %i',
    (distance) => {
      const mesh = Math.min(distance, 12);
      expect(streamRings(distance, true)).toEqual({
        mesh,
        gen: mesh + 1,
        keepMesh: mesh + 1,
        keepData: mesh + 2,
      });
      expect(streamRings(distance).mesh).toBe(distance);
    },
  );

  it('resolves grass top, grass side, stone and biome tint from the atlas', () => {
    const atlas = new TextureAtlas(
      new Map(
        Object.entries(textureGenerators).map(([id, make]) => {
          const tile = make(42);
          return Array.isArray(tile) ? [id + '_0', tile[0]!] : [id, tile];
        }),
      ),
    );
    const materials = buildLodMaterials(atlas, BlockRegistry.getInstance());
    expect(materials[0]).toBe(atlasTileIndex(atlas, 'grass_top'));
    expect(materials[1]).toBe(atlasTileIndex(atlas, 'grass_side') | 4096);
    expect(materials[2]).toBe(124 | (189 << 8) | (71 << 16));
    expect(materials[21]).toBe(atlasTileIndex(atlas, 'stone'));
  });

  it('emits flat tops, exposed sides and separate vertical seam skirts', () => {
    const seed = hashString('blockcraft-test-seed-42');
    const job = { seed, variant: { type: 'default' as const }, step: 2 as const, tx: -1, tz: -1 };
    const { quads, opaqueCount } = buildLodMesh(job);
    let sides = 0;
    let skirts = 0;
    for (let i = 0; i < opaqueCount * 4; i += 4) {
      const packed = quads[i + 2]!;
      const shape = quads[i + 3]!;
      const face = (shape >> 10) & 7;
      const lo = packed & 511;
      const hi = packed >> 9;
      expect(quads[i]! % 2 === 0 && quads[i + 1]! % 2 === 0).toBe(true);
      if (face === 2) expect(lo).toBe(hi);
      else if (shape >> 19) {
        expect(lo).toBe(0);
        skirts++;
      } else {
        expect(hi).toBeGreaterThan(lo);
        sides++;
      }
    }
    expect(sides).toBeGreaterThan(0);
    expect(skirts).toBeGreaterThan(0);
    const flat = buildLodMesh({ ...job, variant: { type: 'flat' } }).quads;
    for (let i = 0; i < flat.length; i += 4) {
      const shape = flat[i + 3]!;
      if (shape >> 19 !== 0) continue;
      expect((shape >> 10) & 7).toBe(2);
      expect(flat[i + 2]! >> 9).toBe(SEA_LEVEL + 1);
      expect(shape & 31).toBe(16);
    }
  });

  it('keeps the one-block water grid unmerged for consistent waves', () => {
    const mesh = buildLodMesh({
      seed: hashString('blockcraft-test-seed-42'),
      variant: { type: 'default' },
      step: 1,
      tx: 0,
      tz: 4,
    });
    let edges = 0;
    for (let i = mesh.opaqueCount * 4; i < mesh.quads.length; i += 4) {
      const shape = mesh.quads[i + 3]!;
      expect(shape & 31).toBe(1);
      expect((shape >> 5) & 31).toBe(1);
      edges++;
    }
    expect(edges).toBeGreaterThan(0);
  });

  it('uses the nearest tile edge and keeps a one-column hysteresis band', () => {
    expect(lodTileDistance(-1, 0, 4, -1)).toBe(17);
    expect([12, 16, 17, 24, 25].map((d) => lodStep(d))).toEqual([1, 1, 2, 2, 4]);
    expect([17, 18].map((d) => lodStep(d, 1))).toEqual([1, 2]);
    expect([15, 16, 25, 26].map((d) => lodStep(d, 2))).toEqual([1, 2, 2, 4]);
    expect([23, 24].map((d) => lodStep(d, 4))).toEqual([2, 4]);
  });

  it('hides only drawn full-detail columns until they unload or leave the detail radius', () => {
    const mask = new LodColumnMask(-6, 10);
    expect(mask.hides(6, 10)).toBe(false);
    mask.markDrawn(6, 10);
    mask.markDrawn(7, 10);
    expect(mask.hides(6, 10)).toBe(true);
    expect(mask.hides(7, 10)).toBe(false);
    expect(mask.hides(5, 10)).toBe(false);
    mask.markDrawn(5, 10);
    mask.moveTo(-7, 11);
    expect(mask.hides(6, 10)).toBe(false);
    expect(mask.hides(5, 10)).toBe(true);
    mask.moveTo(-6, 10);
    expect(mask.hides(6, 10)).toBe(false);
    expect(mask.hides(5, 10)).toBe(true);
    mask.forget(5, 10);
    expect(mask.hides(5, 10)).toBe(false);
  });
});

it('keeps load progress monotonic and within the required column count', () => {
  let ready = 0;
  expect(
    [0, 16, 15, 50, 100].map((sample) => (ready = loadingProgress(ready, sample, 81))),
  ).toEqual([0, 16, 16, 50, 81]);
});

it('recomputes cave visibility on FOV and aspect changes in a stationary view', () => {
  const visibility = new SectionVisibility();
  const camera = [8, 88, 8];
  const open = new Float64Array(24);
  const clipped = new Float64Array(24);
  clipped[0] = -1;
  clipped[3] = 10;
  const prepare = (planes: Float64Array, fov: number, aspect: number) =>
    visibility.prepare(camera, planes, 8, true, 5, 5, 0, 0, fov, aspect);
  prepare(open, 1, 1);
  expect(visibility.visible(6, 5, 0)).toBe(true);
  prepare(clipped, 1, 1);
  expect(visibility.visible(6, 5, 0)).toBe(true);
  prepare(clipped, 0.9, 1);
  expect(visibility.visible(6, 5, 0)).toBe(false);
  prepare(open, 0.9, 2);
  expect(visibility.visible(6, 5, 0)).toBe(true);
});

it('defaults LOD off and preserves a saved boolean opt-in', async () => {
  expect(defaultSettings().lod).toBe(false);
  expect(normalizeSettings({ renderDistance: 32 }).lod).toBe(false);
  expect(normalizeSettings({ lod: 'true' }).lod).toBe(false);
  const fake = createFakeIdb();
  expect((await loadSettings(fake.env)).lod).toBe(false);
  await saveSettings({ ...defaultSettings(), lod: true }, fake.env);
  expect((await loadSettings(fake.env)).lod).toBe(true);
  const db = await SaveDb.open(fake.env);
  await db.write([
    { op: 'put', store: 'settings', value: { key: 'global', value: { renderDistance: 32 } } },
  ]);
  db.close();
  expect(await loadSettings(fake.env)).toMatchObject({ lod: false, renderDistance: 32 });
});

it('repeats world-space UVs once per block on coarse tops and sides', () => {
  expect(lodFaceUv(2, -8, 63, 30)).toEqual([-8, -30]);
  expect(lodFaceUv(2, -4, 63, 34)).toEqual([-4, -34]);
  expect(lodFaceUv(0, -4, 63, 30)).toEqual([-30, -63]);
  expect(lodFaceUv(0, -4, 59, 34)).toEqual([-34, -59]);
});

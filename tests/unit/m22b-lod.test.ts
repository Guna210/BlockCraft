import { describe, expect, it } from 'vitest';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { sampleTerrainTopY } from '../../src/gen/terrain-height';
import { SEA_LEVEL } from '../../src/gen/terrain';
import { textureGenerators } from '../../src/render/textures';
import { buildLodColors, averageLodColor } from '../../src/render/lod-colors';
import { buildLodMesh, LOD_TILE_VERTICES, LOD_VERTEX_WORDS } from '../../src/render/lod-mesh';
import { LodColumnMask } from '../../src/render/lod-plan';
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

  it('averages existing atlas pixels and applies grass tint without tinting stone', () => {
    expect(averageLodColor([100, 200, 50, 255, 200, 100, 150, 255], [255, 128, 0])).toBe(
      150 | (75 << 8),
    );
    const tiles = new Map<string, Uint8Array>();
    for (const [key, make] of Object.entries(textureGenerators)) {
      const tile = make(42);
      if (Array.isArray(tile)) tiles.set(`${key}_0`, tile[0]!);
      else tiles.set(key, tile);
    }
    const colors = buildLodColors(tiles, BlockRegistry.getInstance());
    expect(colors.ground[0]).toBe(averageLodColor(tiles.get('grass_top')!, [124, 189, 71]));
    expect(colors.ground[7]).toBe(averageLodColor(tiles.get('stone')!));
    expect(colors.water).toBe(averageLodColor(tiles.get('water_0')!));
  });

  it('samples the seed on a shared four-block lattice and adds skirts at column and tile edges', () => {
    const seed = hashString('blockcraft-test-seed-42');
    const colors = { ground: new Uint32Array(19).fill(7), snow: 17, water: 27 };
    const job = { seed, variant: { type: 'default' as const }, colors, tz: -1 };
    const left = buildLodMesh({ ...job, tx: -1 }).vertices;
    const right = buildLodMesh({ ...job, tx: 0 }).vertices;
    expect(left.length).toBe(LOD_TILE_VERTICES * LOD_VERTEX_WORDS);
    for (const vertices of [left, right]) {
      let topVertices = 0;
      let edgeVertices = 0;
      for (let i = 0; i < vertices.length; i += LOD_VERTEX_WORDS) {
        const x = vertices[i]!,
          packed = vertices[i + 1]!,
          z = vertices[i + 2]!;
        const side = (packed >> 9) & 7;
        if (side === 0) {
          topVertices++;
          expect(x % 4 === 0 && z % 4 === 0).toBe(true);
          if (x === 0) {
            expect(packed).toBe(
              Math.max(SEA_LEVEL, sampleTerrainTopY(deriveSeed(seed, 'terrain_shape'), x, z) + 1),
            );
          }
        } else if (x === 0 && (side === 1 || side === 2)) {
          edgeVertices++;
          expect(packed & 8192).toBe(8192);
          if (packed & 4096) expect(packed & 511).toBe(0);
        }
      }
      expect(topVertices).toBe(16 * 16 * 6);
      expect(edgeVertices).toBe(16 * 6);
    }
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

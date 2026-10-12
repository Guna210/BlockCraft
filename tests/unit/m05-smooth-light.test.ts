import { describe, it, expect } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildLightLookupTables, computeRegionLight, LightEngine } from '../../src/world/lighting';
import { computeBatchLight, type LightColumns } from '../../src/world/batch-light';
import { buildPaddedLight, collectLightPadding } from '../../src/world/light-padding';
import { World } from '../../src/world/world';
import { SKY_15_SECTION } from '../../src/world/lighting';
import { buildPaddedSection } from '../../src/world/padded';
import { columnKey } from '../../src/world/streaming-plan';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import {
  EMITTER_TINTS,
  LIGHT_BRIGHTNESS_RANGE,
  lightBrightness,
  tintOffset,
} from '../../src/render/light-curve';
import {
  ambientOcclusion,
  sampleFaceCorners,
  canMergeCorners,
  shouldFlipQuad,
} from '../../src/mesh/ao';
import { decodeVertex, packVertex, vertexHasBlockLight } from '../../src/mesh/vertex';
import { textureGenerators } from '../../src/render/textures';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';

const registry = BlockRegistry.getInstance();
const tables = buildLightLookupTables(registry);
const pad = (x: number, y: number, z: number) => x + 18 * (y + 18 * z);

describe('M05b exact batched light', () => {
  it('agrees cell for cell with the createWorld region algorithm on interior columns', () => {
    const columns: LightColumns = {};
    const world = new World(false);
    const pipeline = createDefaultPipeline();
    for (let cz = -2; cz <= 2; cz++)
      for (let cx = -2; cx <= 2; cx++) {
        const column = world.getColumn(cx, cz)!;
        pipeline.generateColumn(hashString('blockcraft-test-seed-42'), cx, cz, column);
        columns[`${cx},${cz}`] = Array.from({ length: 20 }, (_, sy) => {
          const section = column.getSection(sy);
          if (!section) return 0;
          if (section.getBitsPerEntry() === 0) return section.uniformStateId;
          const raw = new Uint16Array(4096);
          section.copyBlockStatesTo(raw);
          return raw;
        });
      }
    const reference = computeRegionLight(2, columns, tables);
    const batch = computeBatchLight(
      { minCX: -2, maxCX: 2, minCZ: -2, maxCZ: 2 },
      { minCX: -1, maxCX: 1, minCZ: -1, maxCZ: 1 },
      columns,
      tables,
    );
    for (const column of batch)
      for (const section of column.sections) {
        const raw =
          typeof section.lightData === 'number'
            ? new Uint8Array(4096).fill(section.lightData)
            : section.lightData;
        expect(raw).toEqual(reference.get(section.key) ?? new Uint8Array(4096));
      }
  });

  it('a single column and its skirt agree with a larger region independent of load order', () => {
    const columns: LightColumns = {};
    const stone = registry.getStateId('stone')!;
    for (let z = -2; z <= 2; z++)
      for (let x = -2; x <= 2; x++) columns[`${x},${z}`] = [stone, 0, stone];
    const emitter = new Uint16Array(4096);
    emitter[15] = registry.getStateId('torch')!;
    columns['-1,0']![1] = emitter;
    const smallColumns = Object.fromEntries(
      Object.entries(columns).filter(([key]) =>
        key.split(',').every((c) => Math.abs(Number(c)) <= 1),
      ),
    );
    const small = computeBatchLight(
      { minCX: -1, maxCX: 1, minCZ: -1, maxCZ: 1 },
      { minCX: 0, maxCX: 0, minCZ: 0, maxCZ: 0 },
      smallColumns,
      tables,
    )[0]!;
    const large = computeBatchLight(
      { minCX: -2, maxCX: 2, minCZ: -2, maxCZ: 2 },
      { minCX: 0, maxCX: 0, minCZ: 0, maxCZ: 0 },
      columns,
      tables,
    )[0]!;
    expect(small).toEqual(large);
  });

  it('uses the skirt for an unlit neighbour, stored light for a lit neighbour, and zero below the floor', () => {
    const world = new World();
    const engine = world.lightEngine;
    engine.markLit(0, 0);
    const skirt = new Uint16Array(68 * 32).fill(0x9abc);
    engine.skirts.set(32768 * 65536 + 32768, { height: 32, data: skirt });
    const unlit = buildPaddedLight(collectLightPadding(world, 0, 0, 0));
    expect(unlit[pad(0, 2, 3)]).toBe(0x9abc);
    expect(unlit[pad(0, 0, 3)]).toBe(0);
    engine.markLit(-1, 0);
    engine.storage.setRawData(-1, 0, 0, new Uint8Array(4096).fill(0xf0));
    const lit = buildPaddedLight(collectLightPadding(world, 0, 0, 0));
    expect(lit[pad(0, 2, 3)]).toBe(0xf000);
  });

  it('incremental BFS never writes into an unlit column', () => {
    const world = new World();
    world.getColumn(0, 0);
    world.getColumn(1, 0);
    world.lightEngine.onlyLitColumns = true;
    world.lightEngine.markLit(0, 0);
    world.setBlock(15, 20, 4, 'torch');
    expect(world.getLight(15, 20, 4).block).toBe(
      registry.getBlockDefinition('torch')!.lightEmission,
    );
    expect(world.getLight(16, 20, 4).block).toBe(0);
    expect(world.lightEngine.storage.getRawData(1, 1, 0)).toBeUndefined();
  });
});

describe('M05b RGB and vertex format', () => {
  for (const [id, tint] of Object.entries(EMITTER_TINTS))
    it(`${id} tint offsets approximate brightness after the curve`, () => {
      const level = registry.getBlockDefinition(id)!.lightEmission;
      const emission = tables.rgbEmission!;
      const state = registry.getStateId(id)!;
      for (let c = 0; c < 3; c++) {
        const expected = Math.max(0, level - tintOffset(level, tint[c]!));
        expect(emission[c]![state]).toBe(expected);
        expect(
          Math.abs(lightBrightness(expected) - tint[c]! * lightBrightness(level)),
        ).toBeLessThanOrEqual(LIGHT_BRIGHTNESS_RANGE / 15 / 2);
      }
      expect(Math.max(...emission.map((channel) => channel[state]!))).toBe(level);
    });

  it('mixes colours by max per channel and removes them independently', () => {
    const world = new World();
    world.lightEngine = new LightEngine(tables);
    world.getColumn(0, 0);
    world.setBlock(5, 20, 5, 'torch');
    world.setBlock(9, 20, 5, 'lumite_ore');
    const mixed = world.lightEngine.getBlockLightRGB(7, 20, 5);
    const torch = tables.rgbEmission!.map((c) =>
      Math.max(0, c[registry.getStateId('torch')!]! - 2),
    );
    const lumite = tables.rgbEmission!.map((c) =>
      Math.max(0, c[registry.getStateId('lumite_ore')!]! - 2),
    );
    expect(Object.values(mixed)).toEqual(torch.map((level, c) => Math.max(level, lumite[c]!)));
    expect(world.getLight(7, 20, 5).block).toBe(Math.max(...Object.values(mixed)));
    world.setBlock(5, 20, 5, 'air');
    expect(Object.values(world.lightEngine.getBlockLightRGB(7, 20, 5))).toEqual(lumite);
    world.setBlock(9, 20, 5, 'air');
    expect(Object.values(world.lightEngine.getBlockLightRGB(7, 20, 5))).toEqual([0, 0, 0]);
  });

  it('round-trips every packed field at its bounds without overlap', () => {
    const packed = new Uint32Array(2);
    packVertex(16, 15, 14, 5, 3, 15, 14, 13, 4095, 16, 15, packed, 0, 12, 11);
    expect(decodeVertex(packed[0]!, packed[1]!)).toEqual({
      x: 16,
      y: 15,
      z: 14,
      normalIndex: 5,
      ao: 3,
      skyLight: 15,
      blockR: 14,
      tintIndex: 13,
      tileIndex: 4095,
      u: 16,
      v: 15,
      blockG: 12,
      blockB: 11,
    });
    expect(packed[1]! >>> 30).toBe(0);
  });

  it('fails before the atlas reaches the packed tile limit', () => {
    const count = Object.values(textureGenerators).reduce((total, generator) => {
      const tiles = generator(42);
      return total + (Array.isArray(tiles) ? tiles.length : 1);
    }, 1);
    expect(count).toBeLessThan(4096);
  });

  it('uses the smaller shader only when every RGB component is zero', () => {
    const packed = new Uint32Array(2);
    for (const rgb of [
      [0, 0, 0],
      [14, 0, 0],
      [0, 13, 0],
      [0, 0, 12],
    ]) {
      packVertex(16, 16, 16, 5, 3, 15, rgb[0]!, 3, 4095, 16, 16, packed, 0, rgb[1]!, rgb[2]!);
      expect(vertexHasBlockLight(packed[0]!, packed[1]!)).toBe(rgb.some((level) => level > 0));
    }
  });
});

describe('M05b smooth samples, AO, merges and diagonal symmetry', () => {
  it('merges a flat sunlit plane at section and column edges with an unlit border', () => {
    const world = new World();
    const stone = registry.getStateId('stone')!;
    const columns: LightColumns = {};
    for (let z = -1; z <= 1; z++)
      for (let x = -1; x <= 1; x++) {
        const col = world.getColumn(x, z)!;
        col.getOrCreateSection(0, stone);
        col.getOrCreateSection(1, stone);
        columns[`${x},${z}`] = [stone, stone];
      }
    const result = computeBatchLight(
      { minCX: -1, maxCX: 1, minCZ: -1, maxCZ: 1 },
      { minCX: 0, maxCX: 0, minCZ: 0, maxCZ: 0 },
      columns,
      tables,
    )[0]!;
    for (const section of result.sections) {
      if (section.lightData === 0xf0)
        world.lightEngine.storage.setRawDataByKey(section.key, SKY_15_SECTION);
      else if (section.lightData instanceof Uint8Array)
        world.lightEngine.storage.setRawDataByKey(section.key, section.lightData);
    }
    world.lightEngine.markLit(0, 0);
    world.lightEngine.skirts.set(columnKey(0, 0), { height: result.height, data: result.skirt });
    const blocks = buildPaddedSection(world, 0, 1, 0);
    const light = buildPaddedLight(collectLightPadding(world, 0, 1, 0));
    const mesh = greedyMesh(
      blocks,
      buildMeshLookupTables(registry, () => 1),
      light,
    );
    expect(mesh.opaque.quadCount).toBe(1);
    for (let i = 0; i < mesh.opaque.vertices.length; i += 2) {
      const v = decodeVertex(mesh.opaque.vertices[i]!, mesh.opaque.vertices[i + 1]!);
      expect([v.skyLight, v.blockR, v.blockG, v.blockB, v.ao]).toEqual([15, 0, 0, 0, 0]);
    }
  });

  it('drops the corner behind two opaque sides from the four-sample average', () => {
    const blocks = new Uint16Array(18 ** 3);
    const light = new Uint16Array(18 ** 3);
    const lookup = buildMeshLookupTables(registry, () => 0);
    const own = pad(8, 8, 8),
      out = own + 18;
    blocks[out - 1] = registry.getStateId('stone')!;
    blocks[out + 324] = registry.getStateId('stone')!;
    light[out] = 0x8642;
    light[out - 1 + 324] = 0xffff;
    const corners = new Uint32Array(4);
    sampleFaceCorners(blocks, light, lookup.isOpaqueCube, own, 2, false, corners, 0);
    expect(corners[0]).toBe(8 | (6 << 4) | (4 << 8) | (2 << 12) | (3 << 16));
    expect(ambientOcclusion(true, true, false)).toBe(3);
    expect(ambientOcclusion(true, false, true)).toBe(2);
  });

  it('averages all non-opaque samples and disables only AO for water', () => {
    const blocks = new Uint16Array(18 ** 3);
    const light = new Uint16Array(18 ** 3);
    const lookup = buildMeshLookupTables(registry, () => 0);
    const own = pad(8, 8, 8),
      out = own + 18;
    light[out] = 0xf000;
    light[out - 1] = 0xb400;
    light[out + 324] = 0x7800;
    light[out - 1 + 324] = 0x3c00;
    const corners = new Uint32Array(4);
    sampleFaceCorners(blocks, light, lookup.isOpaqueCube, own, 2, true, corners, 0);
    expect(corners[0]).toBe(9 | (6 << 4));
  });

  it('allows merging only uniform identical sky/R/G/B/AO tuples', () => {
    const corners = new Uint32Array(8).fill(0xf);
    expect(canMergeCorners(corners, 0, 4)).toBe(true);
    for (const shift of [0, 4, 8, 12, 16]) {
      corners[7] = 0xf + (1 << shift);
      expect(canMergeCorners(corners, 0, 4)).toBe(false);
    }
    expect(canMergeCorners(new Uint32Array([1, 2, 1, 2, 1, 2, 1, 2]), 0, 4)).toBe(false);
  });

  it('flips the complementary diagonal under a symmetric quarter-turn', () => {
    expect(shouldFlipQuad([15, 5, 15, 5])).toBe(false);
    expect(shouldFlipQuad([5, 15, 5, 15])).toBe(true);
    expect(shouldFlipQuad([15, 15, 15, 15])).toBe(false);
  });

  it('plants use their own cell RGB and no AO', () => {
    const blocks = new Uint16Array(18 ** 3);
    const light = new Uint16Array(18 ** 3);
    blocks[pad(8, 8, 8)] = registry.getStateId('torch')!;
    light[pad(8, 8, 8)] = 0x5abc;
    const mesh = greedyMesh(
      blocks,
      buildMeshLookupTables(registry, () => 0),
      light,
    );
    for (let i = 0; i < mesh.models.vertices.length; i += 2) {
      const vertex = decodeVertex(mesh.models.vertices[i]!, mesh.models.vertices[i + 1]!);
      expect([vertex.skyLight, vertex.blockR, vertex.blockG, vertex.blockB, vertex.ao]).toEqual([
        5, 10, 11, 12, 0,
      ]);
    }
  });
});

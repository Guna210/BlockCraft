import { describe, it, expect, beforeEach } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { PADDED_SECTION_VOLUME } from '../../src/world/padded';
import {
  buildMeshLookupTables,
  greedyMesh,
  MeshBucketData,
  MeshLookupTables,
} from '../../src/mesh/greedy';
import {
  CROSS_INDICES_PER_BLOCK,
  CROSS_VERTICES_PER_BLOCK,
  MODEL_CROSS,
  MODEL_CUBE,
  mergeMeshBuckets,
} from '../../src/mesh/models';

// M03f: cross-shaped plant models in the mesher (src/mesh/models.ts)

const CROSS_BLOCKS = [
  'tall_grass',
  'bluebell',
  'buttercup',
  'marigold',
  'violet',
  'daisy',
  'wild_rose',
  'lupine',
  'heather',
  'sugar_reeds',
  'brown_mushroom',
  'red_mushroom',
];
const CUBE_BLOCKS = [
  'cactus',
  'pumpkin',
  'rainwood_log',
  'acacia_log',
  'rainwood_leaves',
  'acacia_leaves',
  'mossy_cobblestone',
  'packed_ice',
];

function pad(x: number, y: number, z: number): number {
  return x + 18 * (y + 18 * z);
}

interface DecodedVertex {
  x: number;
  y: number;
  z: number;
  normal: number;
  ao: number;
  sky: number;
  blk: number;
  tint: number;
  tile: number;
  u: number;
  v: number;
}

function decode(bucket: MeshBucketData, i: number): DecodedVertex {
  const w0 = bucket.vertices[i * 2]!;
  const w1 = bucket.vertices[i * 2 + 1]!;
  return {
    x: w0 & 31,
    y: (w0 >> 5) & 31,
    z: (w0 >> 10) & 31,
    normal: (w0 >> 15) & 7,
    ao: (w0 >> 18) & 3,
    sky: (w0 >> 20) & 15,
    blk: (w0 >> 24) & 15,
    tint: (w0 >> 28) & 15,
    tile: w1 & 65535,
    u: (w1 >> 16) & 255,
    v: (w1 >> 24) & 255,
  };
}

describe('M03f — cross models in the greedy mesher', () => {
  let registry: BlockRegistry;
  let tables: MeshLookupTables;
  const tileMap = new Map<string, number>();

  beforeEach(() => {
    BlockRegistry.resetInstance();
    registry = BlockRegistry.getInstance();
    tileMap.clear();
    let next = 1;
    tables = buildMeshLookupTables(registry, (name) => {
      let id = tileMap.get(name);
      if (id === undefined) {
        id = next++;
        tileMap.set(name, id);
      }
      return id;
    });
  });

  it('classifies plants as cross models and every other new block as a full cube', () => {
    for (const id of CROSS_BLOCKS) {
      const state = registry.getStateId(id)!;
      expect(tables.modelKind[state], id).toBe(MODEL_CROSS);
      expect(registry.getBlockDefinition(id)!.renderLayer, id).toBe('cutout');
      expect(registry.getBlockDefinition(id)!.fullOpaqueCube, id).toBe(false);
    }
    for (const id of CUBE_BLOCKS) {
      expect(tables.modelKind[registry.getStateId(id)!], id).toBe(MODEL_CUBE);
    }
    // existing blocks are untouched
    for (const id of ['stone', 'oak_leaves', 'grass_block', 'water', 'glass']) {
      expect(tables.modelKind[registry.getStateId(id)!], id).toBe(MODEL_CUBE);
    }
  });

  it('tints tall grass with the grass tint and rainwood / acacia leaves with the foliage tint', () => {
    const tg = registry.getStateId('tall_grass')!;
    const rl = registry.getStateId('rainwood_leaves')!;
    const al = registry.getStateId('acacia_leaves')!;
    for (let f = 0; f < 6; f++) {
      expect(tables.tintIndices[tg * 6 + f]).toBe(1);
      expect(tables.tintIndices[rl * 6 + f]).toBe(2);
      expect(tables.tintIndices[al * 6 + f]).toBe(2);
    }
    for (const id of ['bluebell', 'cactus', 'pumpkin', 'rainwood_log', 'birch_leaves']) {
      const st = registry.getStateId(id)!;
      expect(tables.tintIndices[st * 6 + 2], id).toBe(0);
    }
  });

  it('a lone plant adds two diagonal quads, 8 vertices and 24 indices to the model bucket only', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[pad(4, 6, 9)] = registry.getStateId('tall_grass')!;
    const mesh = greedyMesh(padded, tables);

    expect(mesh.models.quadCount).toBe(2);
    expect(mesh.models.vertexCount).toBe(CROSS_VERTICES_PER_BLOCK);
    expect(mesh.models.indices.length).toBe(CROSS_INDICES_PER_BLOCK);
    expect(mesh.opaque.quadCount).toBe(0);
    expect(mesh.cutout.quadCount).toBe(0);
    expect(mesh.translucent.quadCount).toBe(0);
  });

  it('uses integer block-corner positions running corner to corner, +Y normal and the plant tile', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const px = 4;
    const py = 6;
    const pz = 9;
    padded[pad(px, py, pz)] = registry.getStateId('daisy')!;
    const mesh = greedyMesh(padded, tables);
    const bx = px - 1;
    const by = py - 1;
    const bz = pz - 1;

    const verts: DecodedVertex[] = [];
    for (let i = 0; i < mesh.models.vertexCount; i++) verts.push(decode(mesh.models, i));
    for (const v of verts) {
      expect([bx, bx + 1]).toContain(v.x);
      expect([by, by + 1]).toContain(v.y);
      expect([bz, bz + 1]).toContain(v.z);
      expect(v.normal).toBe(2);
      expect(v.tile).toBe(tileMap.get('daisy'));
      expect(v.tint).toBe(0);
      expect(v.sky).toBe(15);
      expect(v.blk).toBe(0);
      expect(v.ao).toBe(0);
      expect(v.u).toBeLessThanOrEqual(1);
      expect(v.v).toBeLessThanOrEqual(1);
    }
    // Each quad runs along one diagonal of the block: its x and z offsets from the block corner
    // are equal at every vertex of quad 0 and opposite at every vertex of quad 1.
    for (let i = 0; i < 4; i++) expect(verts[i]!.x - bx).toBe(verts[i]!.z - bz);
    for (let i = 4; i < 8; i++) expect(verts[i]!.x - bx).toBe(1 - (verts[i]!.z - bz));
    // Each quad spans the full block height and a full diagonal
    for (let q = 0; q < 2; q++) {
      const quad = verts.slice(q * 4, q * 4 + 4);
      expect(new Set(quad.map((v) => v.y))).toEqual(new Set([by, by + 1]));
      expect(new Set(quad.map((v) => `${v.x},${v.z}`)).size).toBe(2);
    }
    // The sprite stands upright: v = 0 on the top vertices, v = 1 at the bottom
    for (const v of verts) expect(v.v).toBe(v.y === by + 1 ? 0 : 1);
  });

  it('emits both windings of every quad, so the plant is visible from both sides', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[pad(8, 8, 8)] = registry.getStateId('lupine')!;
    const mesh = greedyMesh(padded, tables);
    const pos = (i: number): [number, number, number] => {
      const v = decode(mesh.models, i);
      return [v.x, v.y, v.z];
    };
    for (let q = 0; q < 2; q++) {
      const normals: number[][] = [];
      for (let t = 0; t < 4; t++) {
        const o = q * 12 + t * 3;
        const [a, b, c] = [
          pos(mesh.models.indices[o]!),
          pos(mesh.models.indices[o + 1]!),
          pos(mesh.models.indices[o + 2]!),
        ];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        normals.push([
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ]);
      }
      // two triangles face one way, two the opposite way
      const dot = (m: number[], n: number[]) => m[0]! * n[0]! + m[1]! * n[1]! + m[2]! * n[2]!;
      expect(normals.filter((n) => dot(n, normals[0]!) > 0)).toHaveLength(2);
      expect(normals.filter((n) => dot(n, normals[0]!) < 0)).toHaveLength(2);
      expect(normals[0]!.map((c) => 0 - c + 0)).toEqual(normals[2]!.map((c) => c + 0));
    }
    for (let i = 0; i < mesh.models.indices.length; i++) {
      expect(mesh.models.indices[i]!).toBeLessThan(mesh.models.vertexCount);
    }
  });

  it('tall grass carries tint index 1 on every vertex, a flower tint index 0', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[pad(3, 3, 3)] = registry.getStateId('tall_grass')!;
    padded[pad(10, 3, 3)] = registry.getStateId('bluebell')!;
    const mesh = greedyMesh(padded, tables);
    expect(mesh.models.vertexCount).toBe(16);
    const tints = new Map<number, Set<number>>();
    for (let i = 0; i < 16; i++) {
      const v = decode(mesh.models, i);
      const set = tints.get(v.tile) ?? new Set<number>();
      set.add(v.tint);
      tints.set(v.tile, set);
    }
    expect(tints.get(tileMap.get('tall_grass')!)).toEqual(new Set([1]));
    expect(tints.get(tileMap.get('bluebell')!)).toEqual(new Set([0]));
  });

  it('does not hide the faces of neighbouring cubes, and a plant is not hidden by opaque neighbours', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const stone = registry.getStateId('stone')!;
    // a stone block with a plant on top of it and another beside it
    padded[pad(5, 5, 5)] = stone;
    padded[pad(5, 6, 5)] = registry.getStateId('tall_grass')!;
    padded[pad(6, 5, 5)] = registry.getStateId('red_mushroom')!;
    const mesh = greedyMesh(padded, tables);
    expect(mesh.opaque.quadCount).toBe(6); // all six faces of the stone block
    expect(mesh.models.quadCount).toBe(4); // two plants x two quads
  });

  it('a section filled with plants fits the bucket, and cubes plus plants together do too', () => {
    const grass = registry.getStateId('tall_grass')!;
    const leaves = registry.getStateId('oak_leaves')!;
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    for (let z = 1; z <= 16; z++)
      for (let y = 1; y <= 16; y++) for (let x = 1; x <= 16; x++) padded[pad(x, y, z)] = grass;
    const full = greedyMesh(padded, tables);
    expect(full.models.vertexCount).toBe(4096 * CROSS_VERTICES_PER_BLOCK);
    expect(full.models.indices.length).toBe(4096 * CROSS_INDICES_PER_BLOCK);
    expect(full.cutout.quadCount).toBe(0);

    for (let z = 1; z <= 16; z++)
      for (let y = 1; y <= 16; y++)
        for (let x = 1; x <= 16; x++) padded[pad(x, y, z)] = (x + y + z) % 2 === 0 ? leaves : grass;
    const mixed = greedyMesh(padded, tables);
    expect(mixed.cutout.quadCount).toBe(2048 * 6);
    expect(mixed.models.vertexCount).toBe(2048 * CROSS_VERTICES_PER_BLOCK);
  });

  it('mergeMeshBuckets appends the model bucket to the cutout bucket with offset indices', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[pad(2, 2, 2)] = registry.getStateId('oak_leaves')!;
    padded[pad(8, 8, 8)] = registry.getStateId('tall_grass')!;
    const mesh = greedyMesh(padded, tables);
    expect(mesh.cutout.quadCount).toBe(6);
    const merged = mergeMeshBuckets(mesh.cutout, mesh.models);
    expect(merged.quadCount).toBe(8);
    expect(merged.vertexCount).toBe(24 + 8);
    expect(merged.vertices.length).toBe(merged.vertexCount * 2);
    expect(merged.indices.length).toBe(36 + 24);
    for (let i = 0; i < 36; i++) expect(merged.indices[i]).toBe(mesh.cutout.indices[i]);
    for (let i = 0; i < 24; i++) expect(merged.indices[36 + i]).toBe(mesh.models.indices[i]! + 24);
    // merging with an empty bucket returns the other one unchanged
    expect(mergeMeshBuckets(mesh.cutout, { ...mesh.models, quadCount: 0 })).toBe(mesh.cutout);
  });
});

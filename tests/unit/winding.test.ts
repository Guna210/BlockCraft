import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { buildPaddedSection, PADDED_SECTION_VOLUME } from '../../src/world/padded';
import {
  buildMeshLookupTables,
  greedyMesh,
  MeshBucketData,
  MeshLookupTables,
} from '../../src/mesh/greedy';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString, PRNG } from '../../src/engine/rng';

// M03g item A: every triangle of every cube face must be counter-clockwise seen from outside
// (the cross product of its edges points along the face normal), for all six directions, in the
// opaque, cutout and translucent buckets. Cross models (the `models` bucket) are double sided and
// keep both windings, so they are not checked here.

const NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

function makeTables(): MeshLookupTables {
  BlockRegistry.resetInstance();
  const registry = BlockRegistry.getInstance();
  const tiles = new Map<string, number>();
  return buildMeshLookupTables(registry, (name) => {
    let id = tiles.get(name);
    if (id === undefined) {
      id = tiles.size;
      tiles.set(name, id);
    }
    return id;
  });
}

interface Tally {
  triangles: number;
  bad: string[];
  perNormal: number[];
}

function checkBucket(bucket: MeshBucketData, label: string, tally: Tally): void {
  const v = bucket.vertices;
  const pos = (i: number): [number, number, number, number] => {
    const w0 = v[i * 2]!;
    return [w0 & 31, (w0 >> 5) & 31, (w0 >> 10) & 31, (w0 >> 15) & 7];
  };
  for (let t = 0; t < bucket.indices.length; t += 3) {
    const a = pos(bucket.indices[t]!);
    const b = pos(bucket.indices[t + 1]!);
    const c = pos(bucket.indices[t + 2]!);
    const n = a[3];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const nn = NORMALS[n]!;
    const dot = cross[0]! * nn[0] + cross[1]! * nn[1] + cross[2]! * nn[2];
    tally.triangles++;
    tally.perNormal[n] = (tally.perNormal[n] ?? 0) + 1;
    if (!(dot > 0) && tally.bad.length < 5) {
      tally.bad.push(`${label} ${NAMES[n]} triangle ${t / 3}: cross·normal = ${dot}`);
    } else if (!(dot > 0)) {
      tally.bad.push('');
    }
  }
}

describe('Cube-face winding (M03g item A)', () => {
  it('every triangle in generated sections is counter-clockwise seen from outside, all six directions', () => {
    const tables = makeTables();
    const seed = hashString('blockcraft-test-seed-42');
    const pipeline = createDefaultPipeline();
    const world = new World(false);
    // a 5 x 5 area of columns: terrain, water, caves and trees on the standard seed
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        pipeline.generateColumn(seed, cx, cz, world.getColumn(cx, cz, true)!);
      }
    }
    const tally: Tally = { triangles: 0, bad: [], perNormal: [] };
    const buckets = { opaque: 0, cutout: 0, translucent: 0 };
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        for (let sy = 2; sy <= 12; sy++) {
          const mesh = greedyMesh(buildPaddedSection(world, cx, sy, cz), tables);
          for (const name of ['opaque', 'cutout', 'translucent'] as const) {
            checkBucket(mesh[name], `section (${cx},${sy},${cz}) ${name}`, tally);
            buckets[name] += mesh[name].quadCount;
          }
        }
      }
    }
    expect(buckets.opaque).toBeGreaterThan(1000);
    for (let n = 0; n < 6; n++) expect(tally.perNormal[n] ?? 0, NAMES[n]).toBeGreaterThan(100);
    expect(tally.bad.filter(Boolean)).toEqual([]);
    expect(tally.bad.length).toBe(0);
  });

  it('every triangle of a section of mixed opaque, cutout and translucent blocks is counter-clockwise', () => {
    BlockRegistry.resetInstance();
    const registry = BlockRegistry.getInstance();
    const tables = makeTables();
    const ids = [
      registry.getStateId('stone')!,
      registry.getStateId('oak_leaves')!,
      registry.getStateId('water')!,
      registry.getStateId('glass')!,
      registry.getStateId('oak_log', { axis: 'x' })!,
      registry.getStateId('oak_log', { axis: 'z' })!,
      registry.getStateId('oak_log', { axis: 'y' })!,
      0,
      0,
    ];
    const rng = new PRNG(12345);
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    for (let i = 0; i < padded.length; i++) padded[i] = ids[Math.floor(rng.next() * ids.length)]!;
    const mesh = greedyMesh(padded, tables);
    const tally: Tally = { triangles: 0, bad: [], perNormal: [] };
    for (const name of ['opaque', 'cutout', 'translucent'] as const) {
      expect(mesh[name].quadCount, name).toBeGreaterThan(100);
      const before = tally.perNormal.slice();
      checkBucket(mesh[name], name, tally);
      for (let n = 0; n < 6; n++) {
        expect((tally.perNormal[n] ?? 0) - (before[n] ?? 0), `${name} ${NAMES[n]}`).toBeGreaterThan(
          0,
        );
      }
    }
    expect(tally.bad.filter(Boolean)).toEqual([]);
    expect(tally.bad.length).toBe(0);
  });
});

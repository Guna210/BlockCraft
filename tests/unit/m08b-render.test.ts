import { expect, it } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex } from '../../src/mesh/vertex';
import { genWaterFrames, PAL_WATER } from '../../src/render/textures/fluids';
import { FluidAnimationClock } from '../../src/render/fluid-animation';
import { sortedQuadIndices } from '../../src/render/translucent-sort';

const registry = BlockRegistry.getInstance();
const tables = buildMeshLookupTables(registry, () => 0);
const at = (x: number, y: number, z: number) => x + 1 + (y + 1) * 18 + (z + 1) * 324;

it('fluid levels produce sloped shared corners without same-fluid faces, including lava', () => {
  for (const kind of ['water', 'lava']) {
    const blocks = new Uint16Array(18 ** 3);
    blocks[at(3, 3, 3)] = registry.getStateId(kind, { level: '0', falling: 'false' })!;
    blocks[at(4, 3, 3)] = registry.getStateId(kind, { level: '7', falling: 'false' })!;
    const mesh = greedyMesh(blocks, tables);
    const bucket = kind === 'water' ? mesh.translucent : mesh.opaque;
    expect(bucket.quadCount).toBe(10);
    const tops = [];
    for (let q = 0; q < bucket.quadCount; q++) {
      const vertices = Array.from({ length: 4 }, (_, v) =>
        decodeVertex(bucket.vertices[q * 8 + v * 2]!, bucket.vertices[q * 8 + v * 2 + 1]!),
      );
      if (vertices[0]!.normalIndex === 2) tops.push(vertices);
    }
    expect(tops).toHaveLength(2);
    const leftEdge = tops[0]!
      .filter((p) => p.x === 4)
      .map((p) => [p.z, p.y])
      .sort();
    const rightEdge = tops[1]!
      .filter((p) => p.x === 4)
      .map((p) => [p.z, p.y])
      .sort();
    expect(leftEdge).toEqual(rightEdge);
    expect(
      Math.max(...tops.flat().map((p) => p.y)) - Math.min(...tops.flat().map((p) => p.y)),
    ).toBeGreaterThan(0.2);
    expect(tops.flat().every((p) => p.y > 3 && p.y < 4)).toBe(true);
  }
});

it('fluid corners match across a section boundary and join vertical falling water', () => {
  const world = (x: number, y: number, z: number) => {
    if (y === 5 && z === 4 && x >= 14 && x <= 17)
      return registry.getStateId('water', { level: String(x - 14), falling: 'false' })!;
    return 0;
  };
  const meshes = [0, 16].map((origin) => {
    const padded = new Uint16Array(18 ** 3);
    for (let z = -1; z <= 16; z++)
      for (let y = -1; y <= 16; y++)
        for (let x = -1; x <= 16; x++) padded[at(x, y, z)] = world(x + origin, y, z);
    return greedyMesh(padded, tables).translucent;
  });
  const edge = (side: number) => {
    const bucket = meshes[side]!;
    const points = [];
    for (let i = 0; i < bucket.vertices.length; i += 2) {
      const p = decodeVertex(bucket.vertices[i]!, bucket.vertices[i + 1]!);
      if (p.normalIndex === 2 && p.x === (side === 0 ? 16 : 0)) points.push([p.z, p.y]);
    }
    return points.sort();
  };
  expect(edge(0)).toHaveLength(2);
  expect(edge(0)).toEqual(edge(1));
  const padded = new Uint16Array(18 ** 3);
  padded[at(4, 4, 4)] = padded[at(4, 5, 4)] = registry.getStateId('water', {
    level: '0',
    falling: 'true',
  })!;
  const bucket = greedyMesh(padded, tables).translucent;
  expect(bucket.quadCount).toBe(10);
  const bottomSide = [];
  for (let i = 0; i < bucket.vertices.length; i += 2) {
    const p = decodeVertex(bucket.vertices[i]!, bucket.vertices[i + 1]!);
    if (p.normalIndex === 0 && p.y === 5) bottomSide.push(p);
  }
  expect(bottomSide.length).toBeGreaterThanOrEqual(2);
});

it('water has at most ten percent sparse highlights and mostly mid/dark tones in every frame', () => {
  const frames = genWaterFrames();
  expect(frames).toHaveLength(32);
  for (const frame of frames) {
    let highlights = 0,
      dark = 0;
    for (let i = 0; i < frame.length; i += 4) {
      if (frame[i]! >= PAL_WATER[3]![0]) highlights++;
      if (frame[i]! <= PAL_WATER[2]![0]) dark++;
      expect(frame[i + 3]).toBeLessThan(128);
    }
    expect(highlights / 256).toBeLessThanOrEqual(0.1);
    expect(dark / 256).toBeGreaterThanOrEqual(0.9);
  }
  expect(new Set(frames.map((f) => Array.from(f).join(','))).size).toBe(32);
});

it('animation pauses and resumes continuously, with all 32 frames reachable', () => {
  const cycling = new FluidAnimationClock();
  const reached = new Set<number>();
  for (let frame = 0; frame < 32; frame++) {
    cycling.sample(frame * 125);
    reached.add(cycling.snapshot().frame);
  }
  expect(reached.size).toBe(32);
  const clock = new FluidAnimationClock();
  clock.sample(0);
  expect(clock.sample(1000)).toBe(1);
  clock.setPaused(true, 1500);
  expect(clock.sample(10000)).toBe(1.5);
  expect(clock.snapshot().frame).toBe(12);
  clock.setPaused(false, 11000);
  expect(clock.sample(11500)).toBe(2);
  expect(clock.sample(11000)).toBe(2);
});

it('translucent quads sort far to near and reverse when the camera crosses them', () => {
  const centers = new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]);
  expect(Array.from(sortedQuadIndices(centers, [-1, 0, 0])).filter((_, i) => i % 6 === 0)).toEqual([
    8, 4, 0,
  ]);
  expect(Array.from(sortedQuadIndices(centers, [21, 0, 0])).filter((_, i) => i % 6 === 0)).toEqual([
    0, 4, 8,
  ]);
});

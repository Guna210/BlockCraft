import { normalizeSharedQuads } from '../../src/render/shared-quads';
import { it, expect } from 'vitest';
import { genCracks, CRACK_PALETTE } from '../../src/render/textures/cracks';
import { emitWallTorch, wallTorchOffset } from '../../src/mesh/wall-torch';
import { packVertex, decodeVertex } from '../../src/mesh/vertex';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildLightLookupTables } from '../../src/world/lighting';
import { BlockShapes } from '../../src/world/block-shapes';
it('M07a ten original crack stages are deterministic, progressive and use declared limited palette', () => {
  const tiles = genCracks(42);
  expect(tiles).toHaveLength(10);
  expect(genCracks(42)).toEqual(tiles);
  expect(genCracks(13)).not.toEqual(tiles);
  let previous = 0;
  for (const tile of tiles) {
    let count = 0;
    for (let i = 0; i < tile.length; i += 4) {
      const pixel = Array.from(tile.slice(i, i + 4));
      expect(CRACK_PALETTE).toContainEqual(pixel);
      if (pixel[3]! > 0) count++;
    }
    expect(count).toBeGreaterThan(previous);
    previous = count;
  }
  expect(CRACK_PALETTE.length).toBeLessThanOrEqual(12);
});
it('M07a all wall-torch facings decode tilted sprites inside their cached hitbox and share floor light', () => {
  const r = BlockRegistry.getInstance(),
    shapes = new BlockShapes(r),
    light = buildLightLookupTables(r);
  for (const [f, facing] of ['north', 'south', 'east', 'west'].entries()) {
    const v = new Uint32Array(16),
      indices = new Uint32Array(24);
    emitWallTorch(packVertex, v, 0, indices, 0, 3, 4, 5, f, 1, 0xf000);
    for (let q = 0; q < 2; q++)
      for (let c = 0; c < 4; c++) {
        const result = decodeVertex(v[q * 8 + c * 2]!, v[q * 8 + c * 2 + 1]!);
        const offset = wallTorchOffset(c < 2 ? 0 : 1, c === 0 || c === 3 ? 1 : 0, q, f);
        expect([result.x, result.y, result.z]).toEqual([
          3 + offset[0],
          4 + offset[1],
          5 + offset[2],
        ]);
      }
    const state = r.getStateId('wall_torch', { facing })!,
      torch = r.getDefaultStateId('torch')!;
    expect(light.emissionTable[state]).toBe(14);
    for (const channel of light.rgbEmission!) expect(channel[state]).toBe(channel[torch]);
    expect(shapes.boxes[state]).not.toBeNull();
  }
});

it('M07a worker normalization retains every wall-torch triangle on both sprite planes and windings', () => {
  const vertices = new Uint32Array(16),
    indices = new Uint32Array(24);
  emitWallTorch(packVertex, vertices, 0, indices, 0, 0, 0, 0, 0, 1, 0xf000);
  const bucket = { vertices, indices, vertexCount: 8, quadCount: 2 };
  const triangles = (v: Uint32Array, i: Uint32Array) => {
    const result: string[] = [];
    for (let t = 0; t < i.length; t += 3) {
      const words = Array.from(i.subarray(t, t + 3), (n) => `${v[n * 2]},${v[n * 2 + 1]}`);
      result.push(
        [0, 1, 2].map((r) => [...words.slice(r), ...words.slice(0, r)].join(';')).sort()[0]!,
      );
    }
    return result.sort();
  };
  const expected = triangles(vertices, indices);
  normalizeSharedQuads(bucket);
  expect(bucket.quadCount).toBe(4);
  expect(bucket.indices.length).toBe(24);
  expect(triangles(bucket.vertices, bucket.indices)).toEqual(expected);
});

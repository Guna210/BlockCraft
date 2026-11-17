import { describe, expect, it } from 'vitest';
import { CaveCuller } from '../../src/render/cave-culling';
import { ALL_FACE_CONNECTIONS, faceConnectionBit } from '../../src/mesh/visibility';

describe('cave traversal', () => {
  it('treats missing data as open but stops at solid sections', () => {
    const culler = new CaveCuller(4, 1, 1);
    const masks = new Int32Array([-1, -1, 0, -1]);
    culler.traverse(masks, new Uint8Array([1, 1, 1, 1]), 0);
    expect([...culler.visible]).toEqual([1, 1, 1, 0]);
  });
  it('rejects a section outside the frustum', () => {
    const culler = new CaveCuller(3, 1, 1);
    culler.traverse(new Int32Array(3).fill(-1), new Uint8Array([1, 0, 1]), 0);
    expect([...culler.visible]).toEqual([1, 0, 0]);
  });
  it('follows only connected faces', () => {
    const culler = new CaveCuller(3, 2, 1);
    const masks = new Int32Array(6).fill(0);
    masks[1] = faceConnectionBit(1, 2);
    masks[4] = ALL_FACE_CONNECTIONS;
    culler.traverse(masks, new Uint8Array(6).fill(1), 0);
    expect([...culler.visible]).toEqual([1, 1, 0, 1, 1, 1]);
  });
  it('combines equal-length paths arriving through distinct faces', () => {
    const culler = new CaveCuller(3, 3, 1);
    const masks = new Int32Array(9).fill(0);
    masks[1] = faceConnectionBit(1, 2);
    masks[3] = faceConnectionBit(3, 0);
    masks[4] = faceConnectionBit(3, 2) | faceConnectionBit(1, 0);
    culler.traverse(masks, new Uint8Array(9).fill(1), 0);
    expect(culler.visible[5]).toBe(1);
    expect(culler.visible[7]).toBe(1);
  });
  it('never reverses a direction on a path', () => {
    const culler = new CaveCuller(4, 2, 1);
    const masks = new Int32Array(8).fill(0);
    masks[2] = faceConnectionBit(1, 0);
    masks[3] = faceConnectionBit(1, 2);
    masks[7] = faceConnectionBit(3, 1);
    masks[6] = faceConnectionBit(0, 1);
    culler.traverse(masks, new Uint8Array(8).fill(1), 1);
    expect(culler.visible[7]).toBe(1);
    expect(culler.visible[6]).toBe(0);
    expect(culler.visible[4]).toBe(0);
  });
  it('matches path-state traversal on varied small grids', () => {
    const width = 3,
      height = 3,
      depth = 2;
    const count = width * height * depth;
    const delta = [1, -1, width, -width, width * height, -width * height];
    let random = 8128;
    const nextRandom = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random;
    };
    for (let run = 0; run < 30; run++) {
      const masks = new Int32Array(count);
      const frustum = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        masks[i] = nextRandom() % 4 === 0 ? -1 : nextRandom() & ALL_FACE_CONNECTIONS;
        frustum[i] = nextRandom() % 5 === 0 ? 0 : 1;
      }
      const start = nextRandom() % count;
      const expected = new Uint8Array(count);
      const seen = new Set<string>();
      const queue: Array<[number, number, number]> = [];
      expected[start] = 1;
      const neighbour = (cell: number, d: number) => {
        const x = cell % width,
          y = Math.floor(cell / width) % height,
          z = Math.floor(cell / (width * height));
        if (
          (d === 0 && x === width - 1) ||
          (d === 1 && x === 0) ||
          (d === 2 && y === height - 1) ||
          (d === 3 && y === 0) ||
          (d === 4 && z === depth - 1) ||
          (d === 5 && z === 0)
        )
          return -1;
        return cell + delta[d]!;
      };
      for (let d = 0; d < 6; d++) {
        const n = neighbour(start, d);
        if (n >= 0 && frustum[n]) queue.push([n, d ^ 1, 1 << d]);
      }
      for (let at = 0; at < queue.length; at++) {
        const [cell, entry, used] = queue[at]!;
        const key = `${cell},${entry},${used}`;
        if (seen.has(key)) continue;
        seen.add(key);
        expected[cell] = 1;
        const mask = masks[cell]! < 0 ? ALL_FACE_CONNECTIONS : masks[cell]!;
        for (let d = 0; d < 6; d++) {
          if (used & (1 << (d ^ 1)) || !(mask & faceConnectionBit(entry, d))) continue;
          const n = neighbour(cell, d);
          if (n >= 0 && frustum[n]) queue.push([n, d ^ 1, used | (1 << d)]);
        }
      }
      const culler = new CaveCuller(width, height, depth);
      culler.traverse(masks, frustum, start);
      expect(culler.visible).toEqual(expected);
    }
  });
});

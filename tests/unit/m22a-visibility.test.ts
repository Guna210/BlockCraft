import { describe, expect, it } from 'vitest';
import {
  ALL_FACE_CONNECTIONS,
  faceConnectionBit,
  sectionVisibility,
  trivialVisibilityMasks,
} from '../../src/mesh/visibility';

const opaque = new Uint8Array([0, 1]);
const index = (x: number, y: number, z: number) => x + 1 + (y + 1) * 18 + (z + 1) * 324;
const solid = () => new Uint16Array(18 ** 3).fill(1);
const carve = (blocks: Uint16Array, x: number, y: number, z: number) => {
  blocks[index(x, y, z)] = 0;
};

describe('section visibility', () => {
  it('produces worker masks for skipped air and opaque sections', () => {
    expect([...trivialVisibilityMasks(new Int8Array([0, 1, -1]))]).toEqual([
      ALL_FACE_CONNECTIONS,
      0,
      -1,
    ]);
  });
  it('connects every pair in air and none in solid', () => {
    expect(sectionVisibility(new Uint16Array(18 ** 3), opaque)).toBe(ALL_FACE_CONNECTIONS);
    expect(sectionVisibility(solid(), opaque)).toBe(0);
  });
  it('does not connect faces through a single boundary hole', () => {
    const blocks = solid();
    carve(blocks, 0, 8, 8);
    expect(sectionVisibility(blocks, opaque)).toBe(0);
  });
  it('connects opposite faces through a tunnel', () => {
    const blocks = solid();
    for (let x = 0; x < 16; x++) carve(blocks, x, 8, 8);
    expect(sectionVisibility(blocks, opaque)).toBe(faceConnectionBit(0, 1));
  });
  it('unions connections from separate components without joining them', () => {
    const blocks = solid();
    for (let x = 0; x < 16; x++) carve(blocks, x, 4, 4);
    for (let z = 0; z < 16; z++) carve(blocks, 8, 12, z);
    expect(sectionVisibility(blocks, opaque)).toBe(
      faceConnectionBit(0, 1) | faceConnectionBit(4, 5),
    );
  });
  it('connects a bent tunnel and does not connect isolated holes', () => {
    const blocks = solid();
    for (let x = 0; x <= 8; x++) carve(blocks, x, 8, 8);
    for (let y = 8; y < 16; y++) carve(blocks, 8, y, 8);
    carve(blocks, 15, 1, 1);
    expect(sectionVisibility(blocks, opaque)).toBe(faceConnectionBit(1, 2));
  });
  it('does not connect different faces when a U bend returns to the same face', () => {
    const blocks = solid();
    for (let x = 0; x <= 4; x++) {
      carve(blocks, x, 4, 4);
      carve(blocks, x, 4, 8);
    }
    for (let z = 4; z <= 8; z++) carve(blocks, 4, 4, z);
    expect(sectionVisibility(blocks, opaque)).toBe(0);
  });
  it('uses only the core, including at world top and bottom', () => {
    const blocks = solid();
    for (let y = 0; y < 16; y++) carve(blocks, 8, y, 8);
    for (let z = 0; z < 18; z++)
      for (let x = 0; x < 18; x++) {
        blocks[x + z * 324] = 0;
        blocks[x + 17 * 18 + z * 324] = 0;
      }
    expect(sectionVisibility(blocks, opaque)).toBe(faceConnectionBit(2, 3));
  });
});

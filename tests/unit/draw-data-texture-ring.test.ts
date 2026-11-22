import { describe, expect, it } from 'vitest';
import { TerrainDrawBatcher } from '../../src/render/terrain-batcher';
import { DrawDataTextureRing } from '../../src/render/draw-data-texture-ring';

describe('DrawDataTextureRing', () => {
  it('writes changed data to a texture unused by either of the prior two frames', () => {
    const ring = new DrawDataTextureRing();
    const used: number[] = [];

    for (let frame = 0; frame < 7; frame++) {
      ring.beginFrame();
      const texture = ring.acquire(true);
      if (frame >= 2) {
        expect(texture).not.toBe(used[frame - 1]);
        expect(texture).not.toBe(used[frame - 2]);
      }
      used.push(texture);
      ring.endFrame();
    }
  });

  it('reuses the active texture when draw data is unchanged', () => {
    const ring = new DrawDataTextureRing();
    ring.beginFrame();
    const first = ring.acquire(true);
    ring.endFrame();

    ring.beginFrame();
    expect(ring.acquire(false)).toBe(first);
    ring.endFrame();

    ring.beginFrame();
    expect(ring.acquire(false)).toBe(first);
    ring.endFrame();
  });

  it('refuses a second changed texture write after all three textures were read recently', () => {
    const ring = new DrawDataTextureRing();
    ring.beginFrame();
    ring.acquire(true);
    ring.endFrame();
    ring.beginFrame();
    ring.acquire(true);
    ring.endFrame();
    ring.beginFrame();
    ring.acquire(true);
    expect(() => ring.acquire(true)).toThrow('outside the two-frame read window');
  });

  it('appends auxiliary draw data without adding a terrain submission', () => {
    const batcher = new TerrainDrawBatcher();
    batcher.beginFrame();
    batcher.appendTranslucentDraw(0, 1, 6, 0, 0, 0, 0, 1, 0);
    batcher.appendAuxiliaryDraw(16, 32, 48, 0.5, 7);

    expect(batcher.getTotalDraws()).toBe(2);
    expect(batcher.getCommandCount(2)).toBe(1);
    expect(Array.from(batcher.drawData.slice(8, 16))).toEqual([16, 32, 48, 0.5, 7, 0, 0, 0]);
  });
});

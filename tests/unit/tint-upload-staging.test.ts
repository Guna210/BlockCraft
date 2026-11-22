import { describe, expect, it, vi } from 'vitest';
import { ColumnTintCache } from '../../src/render/tint-cache';
import { DrawFenceTimeline } from '../../src/render/terrain-arena';
import { GLWrapper } from '../../src/render/gl';

describe('tint atlas upload staging', () => {
  it('waits for the last atlas-reading fence and three unused frames before reusing a slot', () => {
    let fenceId = 1;
    let fencesSignaled = false;
    const uploads: Array<{ x: number; y: number; firstByte: number }> = [];
    const gl = {
      TEXTURE_2D: 0x0de1,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      NEAREST: 0x2600,
      CLAMP_TO_EDGE: 0x812f,
      RGB8: 0x8051,
      RGB: 0x1907,
      UNSIGNED_BYTE: 0x1401,
      UNPACK_ALIGNMENT: 0x0cf5,
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
      ALREADY_SIGNALED: 0x911a,
      CONDITION_SATISFIED: 0x911c,
      TIMEOUT_EXPIRED: 0x911b,
      WAIT_FAILED: 0x911d,
      createTexture: () => ({}),
      deleteTexture: vi.fn(),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      pixelStorei: vi.fn(),
      texStorage2D: vi.fn(),
      texSubImage2D: (
        _target: number,
        _level: number,
        x: number,
        y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        data: Uint8Array,
      ) => uploads.push({ x, y, firstByte: data[0]! }),
      fenceSync: () => ({ id: fenceId++ }) as unknown as WebGLSync,
      clientWaitSync: () => (fencesSignaled ? 0x911c : 0x911b),
      deleteSync: vi.fn(),
    } as unknown as WebGL2RenderingContext;
    const wrapper = new GLWrapper(gl, false);
    const timeline = new DrawFenceTimeline(wrapper);
    const cache = new ColumnTintCache(wrapper, 32, timeline);
    const tintData = (grass: number, foliage: number) => ({
      grassTints: new Uint8Array(256 * 3).fill(grass),
      foliageTints: new Uint8Array(256 * 3).fill(foliage),
    });
    let column = tintData(10, 20);
    const world = {
      worldType: 'default',
      getColumn: () => column,
    };

    cache.onSectionAdded(0, 0, 0);
    expect(cache.getColumnTintSlot(0, 0, world)).toBe(0);
    expect(cache.flushPendingUploads()).toBe(1);
    const firstSlot = cache.getColumnTintSlot(0, 0, world);
    expect(firstSlot).toBe(1);

    timeline.begin();
    cache.markSlotUsed(firstSlot);
    timeline.markUsed();
    timeline.end();

    column = tintData(30, 40);
    expect(cache.getColumnTintSlot(0, 0, world)).toBe(firstSlot);
    const beforeBlockedFlush = uploads.length;
    timeline.begin();
    expect(cache.flushPendingUploads()).toBe(0);
    expect(uploads).toHaveLength(beforeBlockedFlush);
    timeline.end();

    fencesSignaled = true;
    timeline.begin();
    expect(cache.flushPendingUploads()).toBe(1);
    const updatedSlot = cache.getColumnTintSlot(0, 0, world);
    expect(updatedSlot).toBe(2);
    expect(uploads.some((upload) => upload.x === 64 && upload.firstByte === 30)).toBe(true);
    cache.markSlotUsed(updatedSlot);
    timeline.markUsed();
    timeline.end();

    cache.onSectionRemoved(0, 0, 0);
    const nextColumn = tintData(50, 60);
    const nextWorld = { worldType: 'default', getColumn: () => nextColumn };
    cache.onSectionAdded(1, 0, 0);
    cache.getColumnTintSlot(1, 0, nextWorld);
    timeline.begin();
    expect(cache.flushPendingUploads()).toBe(1);
    expect(cache.getColumnTintSlot(1, 0, nextWorld)).toBe(3);
    cache.markSlotUsed(3);
    timeline.markUsed();
    timeline.end();

    timeline.begin();
    timeline.end();
    cache.onSectionRemoved(1, 0, 0);
    const finalColumn = tintData(70, 80);
    const finalWorld = { worldType: 'default', getColumn: () => finalColumn };
    cache.onSectionAdded(2, 0, 0);
    cache.getColumnTintSlot(2, 0, finalWorld);
    expect(cache.flushPendingUploads()).toBe(1);
    expect(cache.getColumnTintSlot(2, 0, finalWorld)).toBe(1);
  });
});

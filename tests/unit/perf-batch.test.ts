import { describe, expect, it, vi } from 'vitest';
import {
  TerrainDrawBatcher,
  drawDataTexelCoords,
  DRAW_DATA_TEX_WIDTH,
  DRAW_DATA_INITIAL_HEIGHT,
  FLOATS_PER_TEXEL,
  FLOATS_PER_DRAW,
  type BatchSectionEntry,
} from '../../src/render/terrain-batcher';
import { ColumnTintCache, TINT_DEFAULT_SLOT } from '../../src/render/tint-cache';
import { TerrainArena } from '../../src/render/terrain-arena';
import { GLWrapper } from '../../src/render/gl';
import { quadIndices } from '../../src/render/shared-quads';

function makeEntry(
  partial: Partial<BatchSectionEntry> & { pageId: number; variant: number },
): BatchSectionEntry {
  return {
    indexCount: partial.indexCount ?? 36,
    indexByteOffset: partial.indexByteOffset ?? 0,
    originX: partial.originX ?? 0,
    originY: partial.originY ?? 64,
    originZ: partial.originZ ?? 0,
    fade: partial.fade ?? 1,
    tintSlot: partial.tintSlot ?? 1,
    pageId: partial.pageId,
    variant: partial.variant,
  };
}

describe('PERF-batch terrain draw batching', () => {
  describe('batch-key bucketing and translucent run splitting', () => {
    it('groups cross-column opaque and cutout sections by (pass, variant, pageId) and chunks at maxBatchSize', () => {
      const batcher = new TerrainDrawBatcher();
      batcher.beginFrame();

      // Interleave columns across two variants and two pages
      batcher.addUnordered(0, 1, 10, 60, 0, 0, 64, 0, 1.0, 2);
      batcher.addUnordered(0, 0, 20, 120, 240, 16, 64, 0, 0.5, 3);
      batcher.addUnordered(0, 1, 10, 90, 720, 32, 80, 16, 0.75, 4);
      batcher.addUnordered(0, 1, 11, 30, 1080, -16, 48, -16, 1.0, 5);
      batcher.addUnordered(1, 2, 30, 48, 0, 0, 64, 16, 1.0, 2);
      batcher.addUnordered(1, 2, 30, 54, 192, 16, 64, 16, 1.0, 3);

      batcher.finalizeUnorderedPass(0);
      batcher.finalizeUnorderedPass(1);

      const opaqueCmds = batcher.getCommands(0);
      expect(opaqueCmds).toHaveLength(3);
      // Variant 0 comes first, then variant 1 (page 10 grouped together, then page 11)
      expect(opaqueCmds[0]).toMatchObject({
        variant: 0,
        pageId: 20,
        drawBase: 0,
        drawCount: 1,
      });
      expect(opaqueCmds[1]).toMatchObject({
        variant: 1,
        pageId: 10,
        drawBase: 1,
        drawCount: 2,
      });
      expect(opaqueCmds[2]).toMatchObject({
        variant: 1,
        pageId: 11,
        drawBase: 3,
        drawCount: 1,
      });

      const cutoutCmds = batcher.getCommands(1);
      expect(cutoutCmds).toHaveLength(1);
      expect(cutoutCmds[0]).toMatchObject({
        variant: 2,
        pageId: 30,
        drawBase: 4,
        drawCount: 2,
      });

      // Verify chunking when a single key exceeds maxBatchSize
      batcher.beginFrame();
      for (let i = 0; i < 5; i++) {
        batcher.addUnordered(0, 0, 1, 36, i * 144, i * 16, 64, 0, 1, 1);
      }
      batcher.finalizeUnorderedPass(0, 2);
      const chunked = batcher.getCommands(0);
      expect(chunked.map((c) => [c.drawBase, c.drawCount])).toEqual([
        [0, 2],
        [2, 2],
        [4, 1],
      ]);
    });

    it('preserves back-to-front translucent order and batches only consecutive sections sharing (variant, pageId)', () => {
      const batcher = new TerrainDrawBatcher();
      batcher.beginFrame();

      const sorted: BatchSectionEntry[] = [
        makeEntry({ variant: 1, pageId: 5, originX: 160, indexCount: 24, indexByteOffset: 0 }),
        makeEntry({ variant: 1, pageId: 5, originX: 144, indexCount: 30, indexByteOffset: 96 }),
        // Page switch breaks the run
        makeEntry({ variant: 1, pageId: 6, originX: 128, indexCount: 18, indexByteOffset: 0 }),
        // Returning to page 5 must start a new run, never merge with run 0
        makeEntry({ variant: 1, pageId: 5, originX: 112, indexCount: 42, indexByteOffset: 216 }),
        // Variant switch breaks the run
        makeEntry({ variant: 0, pageId: 5, originX: 96, indexCount: 12, indexByteOffset: 384 }),
        makeEntry({ variant: 0, pageId: 5, originX: 80, indexCount: 12, indexByteOffset: 432 }),
      ];

      batcher.finalizeTranslucentRuns(sorted);
      const cmds = batcher.getCommands(2);
      expect(
        cmds.map((c) => ({ v: c.variant, p: c.pageId, base: c.drawBase, n: c.drawCount })),
      ).toEqual([
        { v: 1, p: 5, base: 0, n: 2 },
        { v: 1, p: 6, base: 2, n: 1 },
        { v: 1, p: 5, base: 3, n: 1 },
        { v: 0, p: 5, base: 4, n: 2 },
      ]);

      // Verify exact back-to-front originX sequence in packed drawData
      const originsX = Array.from(
        { length: sorted.length },
        (_, i) => batcher.drawData[i * FLOATS_PER_DRAW],
      );
      expect(originsX).toEqual([160, 144, 128, 112, 96, 80]);
    });
  });

  describe('per-draw data layout and base offsets', () => {
    it('packs two RGBA32F texels per draw and computes matching texelFetch coordinates from u_drawBase + gl_DrawID', () => {
      const batcher = new TerrainDrawBatcher();
      batcher.beginFrame();

      batcher.addUnordered(0, 0, 1, 60, 120, -32, 48, 160, 0.25, 7);
      batcher.addUnordered(0, 0, 1, 96, 360, 64, 112, -48, 1.0, 19);
      batcher.finalizeUnorderedPass(0);

      expect(batcher.getTotalDraws()).toBe(2);
      expect(batcher.getDirtyRows()).toBe(1);

      // Draw 0: texel 0 at (0,0), texel 1 at (1,0)
      expect(drawDataTexelCoords(0, 0, 0)).toEqual([0, 0]);
      expect(drawDataTexelCoords(0, 0, 1)).toEqual([1, 0]);
      // Draw 1: texel 0 at (2,0), texel 1 at (3,0)
      expect(drawDataTexelCoords(0, 1, 0)).toEqual([2, 0]);
      expect(drawDataTexelCoords(0, 1, 1)).toEqual([3, 0]);

      // Wrap across row boundary (512 draws per 1024-wide row since 2 texels/draw)
      expect(drawDataTexelCoords(511, 1, 0)).toEqual([0, 1]);
      expect(drawDataTexelCoords(511, 1, 1)).toEqual([1, 1]);

      expect(Array.from(batcher.drawData.subarray(0, 16))).toEqual([
        -32, 48, 160, 0.25, 7, 0, 0, 0, 64, 112, -48, 1.0, 19, 0, 0, 0,
      ]);
      expect(batcher.counts[0]).toBe(60);
      expect(batcher.offsets[0]).toBe(120);
      expect(batcher.counts[1]).toBe(96);
      expect(batcher.offsets[1]).toBe(360);
      expect(DRAW_DATA_TEX_WIDTH).toBe(1024);
    });
  });

  describe('tint slot allocation and free', () => {
    it('reserves slot 0 for plains default, allocates unique column slots in the 2D tint atlas, and reuses freed slots', () => {
      const subUploads: Array<{ x: number; y: number; firstByte: number }> = [];
      let storageSize: [number, number] = [0, 0];
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
        createTexture: () => ({}),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        pixelStorei: vi.fn(),
        texStorage2D: (_target: number, _levels: number, _fmt: number, w: number, h: number) => {
          storageSize = [w, h];
        },
        texSubImage2D: (
          _target: number,
          _level: number,
          x: number,
          y: number,
          _w: number,
          _h: number,
          _fmt: number,
          _type: number,
          data: Uint8Array,
        ) => {
          subUploads.push({ x, y, firstByte: data[0]! });
        },
      } as unknown as WebGL2RenderingContext;

      const wrapper = new GLWrapper(gl, false);
      const cache = new ColumnTintCache(wrapper, 32);
      expect(wrapper.getCounts().textures).toBe(1);
      expect(storageSize).toEqual([1024, 16]); // 32 slots = 64 cells = 1 row of 64x16

      // Flat world or missing column uses plains default at slot 0
      expect(cache.getColumnTintSlot(0, 0, { worldType: 'flat' })).toBe(TINT_DEFAULT_SLOT);

      const cols = new Map<string, { grassTints: Uint8Array; foliageTints: Uint8Array }>();
      const makeCol = (g: number, f: number) => ({
        grassTints: new Uint8Array(256 * 3).fill(g),
        foliageTints: new Uint8Array(256 * 3).fill(f),
      });
      cols.set('0,0', makeCol(10, 20));
      cols.set('1,0', makeCol(30, 40));
      cols.set('2,0', makeCol(50, 60));

      const world = {
        worldType: 'default',
        getColumn: (cx: number, cz: number) => cols.get(`${cx},${cz}`) ?? null,
      };

      cache.onSectionAdded(0, 0, 0);
      cache.onSectionAdded(0, 1, 0);
      cache.onSectionAdded(1, 0, 0);

      const slot0 = cache.getColumnTintSlot(0, 0, world);
      const slot1 = cache.getColumnTintSlot(1, 0, world);
      expect(slot0).toBe(1);
      expect(slot1).toBe(2);
      expect(cache.activeSlotCount).toBe(2);

      // Removing only one of column (0,0)'s two sections keeps its slot alive
      cache.onSectionRemoved(0, 0, 0);
      expect(cache.activeSlotCount).toBe(2);

      // Removing the last section of column (0,0) frees slot 1 for reuse
      cache.onSectionRemoved(0, 1, 0);
      expect(cache.activeSlotCount).toBe(1);
      expect(cache.freeSlotCount).toBe(1);

      cache.onSectionAdded(2, 0, 0);
      const slot2 = cache.getColumnTintSlot(2, 0, world);
      expect(slot2).toBe(1); // Reused slot 1 (cells 2 and 3 -> x = 32 and x = 48, y = 0)
      expect(subUploads.some((u) => u.x === 32 && u.y === 0 && u.firstByte === 50)).toBe(true);
      expect(subUploads.some((u) => u.x === 48 && u.y === 0 && u.firstByte === 60)).toBe(true);
    });
  });

  describe('arena range reuse with frame-count quarantine and page growth policy', () => {
    function makeArena(initialPageQuads = 16, maxPageQuads = 128) {
      const syncCalls = {
        fenceSync: vi.fn(),
        clientWaitSync: vi.fn(),
        getSyncParameter: vi.fn(),
        deleteSync: vi.fn(),
      };
      const gl = {
        ARRAY_BUFFER: 1,
        ELEMENT_ARRAY_BUFFER: 2,
        UNSIGNED_INT: 3,
        DYNAMIC_DRAW: 4,
        COPY_READ_BUFFER: 5,
        COPY_WRITE_BUFFER: 6,
        STREAM_DRAW: 7,
        STATIC_DRAW: 8,
        createVertexArray: () => ({}),
        createBuffer: () => ({}),
        deleteVertexArray: vi.fn(),
        deleteBuffer: vi.fn(),
        bindVertexArray: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        bufferSubData: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribIPointer: vi.fn(),
        copyBufferSubData: vi.fn(),
        ...syncCalls,
      } as unknown as WebGL2RenderingContext;
      const wrapper = new GLWrapper(gl, false);
      const arena = new TerrainArena(wrapper, { initialPageQuads, maxPageQuads });
      return { arena, wrapper, syncCalls };
    }

    function makeBucket(quads: number) {
      return {
        canonicalQuads: true,
        vertices: new Uint32Array(quads * 8),
        indices: quadIndices(quads),
        vertexCount: quads * 4,
        quadCount: quads,
      };
    }

    it('merges adjacent streamed vertex chunks into one bufferSubData per upload batch', () => {
      const { arena, wrapper } = makeArena(64, 64);
      const gl = wrapper.gl as unknown as { bufferSubData: ReturnType<typeof vi.fn> };
      gl.bufferSubData.mockClear();
      const a = arena.upload(makeBucket(8));
      const b = arena.upload(makeBucket(8));
      const calls = () =>
        gl.bufferSubData.mock.calls.filter((c: unknown[]) => c[0] === 1 /* ARRAY_BUFFER */);
      arena.beginUploadBatch();
      expect(arena.uploadPending(a, 5, true)).toBe(true);
      expect(arena.uploadPending(b, 5, true)).toBe(true);
      expect(calls()).toHaveLength(0);
      arena.endUploadBatch();
      // Two 256-byte allocations are adjacent in the page: one write of 512 bytes (128 words).
      expect(calls()).toHaveLength(1);
      expect(calls()[0]![1]).toBe(0);
      expect(calls()[0]![4]).toBe(128);
    });

    it('ages each range from its own last draw and makes no WebGL sync calls', () => {
      const { arena, wrapper, syncCalls } = makeArena(16, 64);

      const a = arena.upload(makeBucket(8));
      const b = arena.upload(makeBucket(8));
      expect(a.page).toBe(b.page);
      expect(a.quads.offset).toBe(0);
      expect(b.quads.offset).toBe(8);

      // Both ranges are drawn in frame 1; only b is drawn in frame 2.
      arena.beginDrawFrame();
      arena.markUsed(a);
      arena.markUsed(b);
      arena.endDrawFrame();
      arena.beginDrawFrame();
      arena.markUsed(b);
      arena.endDrawFrame();
      arena.free(a);
      expect(a.page.quarantined).toHaveLength(1);

      // Two later completed draws of b age a's range by three frames, not four.
      for (let i = 0; i < 2; i++) {
        arena.beginDrawFrame();
        arena.markUsed(b);
        arena.endDrawFrame();
      }
      expect(a.page.quarantined).toHaveLength(1);
      const blocked = arena.upload(makeBucket(8));
      expect(blocked.page).not.toBe(a.page);

      // The fourth completed frame after a's last draw releases its range even as b stays in use.
      arena.beginDrawFrame();
      arena.markUsed(b);
      arena.endDrawFrame();
      expect(a.page.quarantined).toHaveLength(0);
      const c = arena.upload(makeBucket(8));
      expect(c.page).toBe(a.page);
      expect(c.quads.offset).toBe(a.quads.offset);

      expect(syncCalls.fenceSync).not.toHaveBeenCalled();
      expect(syncCalls.clientWaitSync).not.toHaveBeenCalled();
      expect(syncCalls.getSyncParameter).not.toHaveBeenCalled();
      expect(syncCalls.deleteSync).not.toHaveBeenCalled();

      arena.free(b);
      arena.free(c);
      arena.free(blocked);
      expect(wrapper.getCounts().vaos).toBe(1); // page remains quarantined after b's latest draw
      arena.releaseAll();
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
    });

    it('grows page capacities exponentially up to maxPageQuads only when existing pages have no room', () => {
      const { arena, wrapper } = makeArena(16, 64);

      const p1 = arena.upload(makeBucket(16));
      expect(p1.page.quadCapacity).toBe(16);

      const p2 = arena.upload(makeBucket(16));
      expect(p2.page).not.toBe(p1.page);
      expect(p2.page.quadCapacity).toBe(32);

      // Page 2 still has 16 quads left, so another 16-quad upload reuses page 2 without creating a new page
      const p2b = arena.upload(makeBucket(16));
      expect(p2b.page).toBe(p2.page);
      expect(arena.pages).toHaveLength(2);

      // Now page 1 and page 2 are full; next allocation creates page 3 with capacity 64 (clamped at maxPageQuads)
      const p3 = arena.upload(makeBucket(16));
      expect(p3.page.quadCapacity).toBe(64);

      const p4 = arena.upload(makeBucket(64));
      expect(p4.page.quadCapacity).toBe(64);

      arena.free(p1);
      arena.free(p2);
      arena.free(p2b);
      arena.free(p3);
      arena.free(p4);
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
    });

    it('deletes an emptied page after four completed draw frames', () => {
      const { arena, wrapper } = makeArena(16, 64);
      const a = arena.upload(makeBucket(8));
      arena.beginDrawFrame();
      arena.markUsed(a);
      arena.endDrawFrame();

      // Emptying the drawn page quarantines its range and keeps the page alive.
      arena.free(a);
      expect(a.page.allocations).toBe(0);
      expect(a.page.quarantined).toHaveLength(1);
      expect(arena.pages).toHaveLength(1);
      expect(wrapper.getCounts()).toMatchObject({ buffers: 3, vaos: 1 });

      for (let i = 0; i < 3; i++) {
        arena.beginDrawFrame();
        arena.endDrawFrame();
        expect(arena.pages).toHaveLength(1);
        expect(a.page.quarantined).toHaveLength(1);
      }

      // Idle render frames count because none referenced this range.
      arena.beginDrawFrame();
      arena.endDrawFrame();
      expect(arena.pages).toHaveLength(0);
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
    });

    it('counts idle draw frames only when no draw referenced the quarantined range', () => {
      const { arena, wrapper } = makeArena(16, 64);
      const a = arena.upload(makeBucket(8));
      arena.beginDrawFrame();
      arena.markUsed(a);
      arena.endDrawFrame();
      arena.free(a);
      expect(a.page.quarantined).toHaveLength(1);

      // Three idle completed frames are not enough to release a range last drawn in frame 1.
      for (let i = 0; i < 3; i++) {
        arena.beginDrawFrame();
        arena.endDrawFrame();
        expect(a.page.quarantined).toHaveLength(1);
      }

      // The fourth idle frame completes the quarantine and deletes the empty page.
      arena.beginDrawFrame();
      arena.endDrawFrame();
      expect(a.page.quarantined).toHaveLength(0);
      expect(arena.pages).toHaveLength(0);
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
    });

    it('fills the index buffer of a large page lazily in bounded chunks', () => {
      const { arena, wrapper } = makeArena(131_072, 131_072);
      const gl = wrapper.gl as unknown as {
        bufferData: ReturnType<typeof vi.fn>;
        bufferSubData: ReturnType<typeof vi.fn>;
        ELEMENT_ARRAY_BUFFER: number;
      };
      const a = arena.upload(makeBucket(8));
      // Allocated without uploading the whole 131,072-quad pattern (3 MB).
      const elementData = gl.bufferData.mock.calls.filter(
        (call) => call[0] === gl.ELEMENT_ARRAY_BUFFER,
      );
      expect(elementData).toHaveLength(1);
      expect(typeof elementData[0]![1]).toBe('number');
      expect(elementData[0]![1]).toBe(131_072 * 24);
      // Only the first chunk is written, and it holds the canonical pattern.
      const fills = gl.bufferSubData.mock.calls.filter((call) => call[2] instanceof Uint32Array);
      expect(fills).toHaveLength(1);
      const [, byteOffset, data] = fills[0]! as [number, number, Uint32Array];
      expect(byteOffset).toBe(0);
      expect(data.length).toBeLessThanOrEqual(32_768 * 6);
      expect(Array.from(data.subarray(0, 12))).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
      expect(a.page.indexFilledQuads).toBe(32_768);
      arena.free(a);
    });

    it('defers resetting a sorted translucent range until four frames after its last draw', () => {
      const { arena, wrapper } = makeArena(16, 64);
      const gl = wrapper.gl as unknown as { bufferSubData: ReturnType<typeof vi.fn> };
      const a = arena.upload(makeBucket(8));
      const b = arena.upload(makeBucket(8));
      arena.beginDrawFrame();
      arena.markUsed(a);
      arena.markUsed(b);
      arena.endDrawFrame();
      arena.updateSortedIndices(a, new Uint32Array(48));
      const writes = () => gl.bufferSubData.mock.calls.length;
      const before = writes();
      arena.free(a);
      expect(writes()).toBe(before); // no write to a range the GPU may still read
      expect(a.page.quarantined).toHaveLength(1);
      expect(a.page.quarantined[0]!.restoreIndices).toBe(true);

      for (let i = 0; i < 3; i++) {
        arena.beginDrawFrame();
        arena.endDrawFrame();
      }
      expect(writes()).toBe(before);
      arena.beginDrawFrame();
      arena.endDrawFrame();
      expect(writes()).toBe(before + 1);
      const last = gl.bufferSubData.mock.calls[gl.bufferSubData.mock.calls.length - 1]!;
      expect(last[1]).toBe(0);
      expect(Array.from((last[2] as Uint32Array).subarray(0, 6))).toEqual([0, 1, 2, 0, 2, 3]);
      arena.free(b);
    });

    it('releaseAll deletes every page and quarantined range', () => {
      const { arena, wrapper, syncCalls } = makeArena(16, 64);
      const a = arena.upload(makeBucket(16));
      const b = arena.upload(makeBucket(16));
      const c = arena.upload(makeBucket(4));
      arena.beginDrawFrame();
      arena.markUsed(a);
      arena.markUsed(b);
      arena.endDrawFrame();
      arena.free(a); // quarantined for four completed draw frames
      expect(arena.pages.length).toBeGreaterThanOrEqual(2);
      expect(a.page.quarantined).toHaveLength(1);

      arena.releaseAll();
      expect(arena.pages).toHaveLength(0);
      expect(syncCalls.fenceSync).not.toHaveBeenCalled();
      expect(syncCalls.clientWaitSync).not.toHaveBeenCalled();
      expect(syncCalls.getSyncParameter).not.toHaveBeenCalled();
      expect(syncCalls.deleteSync).not.toHaveBeenCalled();
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
      expect(c.pendingUpload).toBe(false);

      // Pages are recreated lazily for the next world.
      const d = arena.upload(makeBucket(8));
      expect(arena.pages).toHaveLength(1);
      arena.free(d);
      expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
    });
  });

  describe('draw-data capacity teardown', () => {
    it('resetCapacity shrinks a grown draw-data buffer back to its initial height', () => {
      const batcher = new TerrainDrawBatcher();
      batcher.beginFrame();
      const draws = (DRAW_DATA_TEX_WIDTH / 2) * DRAW_DATA_INITIAL_HEIGHT + 1;
      for (let i = 0; i < draws; i++) batcher.appendTranslucentDraw(0, 1, 6, 0, 0, 0, 0, 1, 0);
      expect(batcher.getTextureHeight()).toBe(DRAW_DATA_INITIAL_HEIGHT * 2);
      batcher.resetCapacity();
      expect(batcher.getTextureHeight()).toBe(DRAW_DATA_INITIAL_HEIGHT);
      expect(batcher.drawData.length).toBe(
        DRAW_DATA_TEX_WIDTH * DRAW_DATA_INITIAL_HEIGHT * FLOATS_PER_TEXEL,
      );
    });
  });

  describe('tint atlas size guard', () => {
    it('never grows the atlas past MAX_TEXTURE_SIZE and falls back to the plains slot', () => {
      const sizes: Array<[number, number]> = [];
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
        MAX_TEXTURE_SIZE: 0x0d33,
        getParameter: (pname: number) => (pname === 0x0d33 ? 1024 : null),
        createTexture: () => ({}),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        pixelStorei: vi.fn(),
        texStorage2D: (_t: number, _l: number, _f: number, w: number, h: number) => {
          sizes.push([w, h]);
        },
        texSubImage2D: vi.fn(),
      } as unknown as WebGL2RenderingContext;
      const cache = new ColumnTintCache(new GLWrapper(gl, false), 32);
      const world = {
        worldType: 'default',
        getColumn: () => ({ grassTints: new Uint8Array(768), foliageTints: new Uint8Array(768) }),
      };
      // 1024 px max -> 64 rows of 32 slots = 2048 slots (slot 0 is the plains default).
      const slots = new Set<number>();
      const slot0Grass = (cache as unknown as { slotDataGrass: Uint8Array[] }).slotDataGrass[
        TINT_DEFAULT_SLOT
      ] as Uint8Array;
      const slot0Before = slot0Grass.slice();
      for (let c = 0; c < 2100; c++) slots.add(cache.getColumnTints(c, 0, world).slot);
      // Overflow columns must not overwrite the plains slot (data or atlas cells).
      expect(
        (cache as unknown as { slotDataGrass: Uint8Array[] }).slotDataGrass[TINT_DEFAULT_SLOT],
      ).toBe(slot0Grass);
      expect(Array.from(slot0Grass)).toEqual(Array.from(slot0Before));
      expect(Math.max(...sizes.map(([, h]) => h))).toBeLessThanOrEqual(1024);
      expect(Math.max(...slots)).toBe(2047);
      expect(cache.getColumnTints(2099, 0, world).slot).toBe(TINT_DEFAULT_SLOT);
      expect(cache.capacitySlots).toBe(2048);
    });
  });
});

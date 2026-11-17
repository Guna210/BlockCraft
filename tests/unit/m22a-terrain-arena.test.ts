import { expect, it, vi } from 'vitest';
import { GLWrapper } from '../../src/render/gl';
import { TerrainArena } from '../../src/render/terrain-arena';
import { quadIndices } from '../../src/render/shared-quads';

it('suballocates indexed geometry, reuses holes and releases the final page', () => {
  const uploads: Array<{ target: number; head: number[] }> = [];
  const copies = vi.fn();
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
    bufferData: (target: number, data: number | Uint32Array) => {
      if (data instanceof Uint32Array)
        uploads.push({ target, head: Array.from(data.subarray(0, 12)) });
    },
    enableVertexAttribArray: vi.fn(),
    vertexAttribIPointer: vi.fn(),
    copyBufferSubData: copies,
  } as unknown as WebGL2RenderingContext;
  const wrapper = new GLWrapper(gl, false);
  const arena = new TerrainArena(wrapper);
  const bucket = () => ({
    canonicalQuads: true,
    vertices: new Uint32Array(8),
    indices: quadIndices(1),
    vertexCount: 4,
    quadCount: 1,
  });
  const a = arena.upload(bucket());
  expect(a.pendingUpload).toBe(true);
  arena.uploadPending(a, Infinity);
  const b = arena.upload(bucket());
  arena.uploadPending(b, Infinity);
  expect(b.vertexBase).toBe(4);
  expect(b.indices.offset).toBe(24);
  expect(uploads.find((upload) => upload.target === gl.ELEMENT_ARRAY_BUFFER)?.head).toEqual([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
  ]);
  expect(copies).toHaveBeenNthCalledWith(1, 5, 6, 0, 0, 32);
  expect(copies).toHaveBeenNthCalledWith(2, 5, 6, 0, 32, 32);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 3, vaos: 1 });
  arena.free(a);
  const c = arena.upload(bucket());
  arena.uploadPending(c, Infinity);
  expect(c.vertexBase).toBe(0);
  arena.free(b);
  arena.free(c);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
});

import { expect, it, vi } from 'vitest';
import { GLWrapper } from '../../src/render/gl';
import { TerrainArena } from '../../src/render/terrain-arena';
import { quadIndices } from '../../src/render/shared-quads';

type Upload = { source: Uint32Array; sourceOffset: number; length: number };

function makeArena() {
  const uploads: Upload[] = [];
  const copies: unknown[][] = [];
  let nextId = 0;
  const gl = {
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    UNSIGNED_INT: 3,
    DYNAMIC_DRAW: 4,
    COPY_READ_BUFFER: 5,
    COPY_WRITE_BUFFER: 6,
    STREAM_DRAW: 7,
    STATIC_DRAW: 8,
    createVertexArray: () => ({ id: ++nextId }),
    createBuffer: () => ({ id: ++nextId }),
    deleteVertexArray: vi.fn(),
    deleteBuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: (
      _target: number,
      source: number | Uint32Array,
      _usage: number,
      sourceOffset?: number,
      length?: number,
    ) => {
      if (source instanceof Uint32Array && sourceOffset !== undefined && length !== undefined)
        uploads.push({ source, sourceOffset, length });
    },
    enableVertexAttribArray: vi.fn(),
    vertexAttribIPointer: vi.fn(),
    copyBufferSubData: (...args: unknown[]) => copies.push(args),
    getParameter: () => null,
  } as unknown as WebGL2RenderingContext;
  const wrapper = new GLWrapper(gl, false);
  return { arena: new TerrainArena(wrapper), gl, uploads, copies, wrapper };
}

function bucket(firstWord: number, quads = 1) {
  const vertices = new Uint32Array(quads * 8);
  for (let i = 0; i < vertices.length; i += 2) vertices[i] = firstWord + i / 2;
  return {
    canonicalQuads: true,
    vertices,
    indices: quadIndices(quads),
    vertexCount: quads * 4,
    quadCount: quads,
  };
}

it('uploads same-page section ranges into one shared arena and reuses freed holes', () => {
  const { arena, gl, uploads, copies, wrapper } = makeArena();
  arena.beginUploadBatch();
  const first = arena.upload(bucket(10));
  const second = arena.upload(bucket(20));
  expect(first.pendingUpload).toBe(true);
  expect(second.vertexBase).toBe(4);
  expect(second.indices.offset).toBe(24);
  arena.uploadPending(first, Infinity);
  arena.uploadPending(second, Infinity);
  arena.endUploadBatch();

  expect(uploads.map(({ sourceOffset, length }) => [sourceOffset, length])).toEqual([
    [0, 8],
    [0, 8],
  ]);
  expect(copies).toEqual([
    [gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, 32],
    [gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 32, 32],
  ]);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 3, vaos: 1 });

  arena.free(first);
  const third = arena.upload(bucket(30));
  expect(third.vertexBase).toBe(0);
  arena.uploadPending(third, Infinity);
  arena.free(second);
  arena.free(third);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
});

it('releases pending allocations without corrupting later arena ranges', () => {
  const { arena, copies, wrapper } = makeArena();
  const first = arena.upload(bucket(10));
  const freed = arena.upload(bucket(20));
  const third = arena.upload(bucket(30));
  arena.free(freed);
  arena.uploadPending(first, Infinity);
  arena.uploadPending(third, Infinity);

  expect(copies.map((copy) => copy[3])).toEqual([0, 64]);
  arena.free(first);
  arena.free(third);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
});

it('packs cutout and model vertices into adjacent ranges', () => {
  const { arena, gl, uploads, copies, wrapper } = makeArena();
  const allocation = arena.upload(bucket(10), bucket(20));

  expect(allocation.indexCount).toBe(12);
  expect(allocation.indices.length).toBe(48);
  arena.uploadPending(allocation, Infinity);
  expect(
    uploads.map(({ source, sourceOffset, length }) => [source[0], sourceOffset, length]),
  ).toEqual([
    [10, 0, 8],
    [20, 0, 8],
  ]);
  expect(copies.map((copy) => [copy[3], copy[4]])).toEqual([
    [0, 32],
    [32, 32],
  ]);
  expect(gl.COPY_READ_BUFFER).toBe(5);
  arena.free(allocation);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
});

it('limits each upload slice and resumes the remaining arena range later', () => {
  const { arena, uploads, copies, wrapper } = makeArena();
  const allocation = arena.upload(bucket(1, 9_000));

  expect(arena.uploadPending(allocation, 0)).toBe(false);
  expect(uploads).toHaveLength(0);
  expect(arena.uploadPending(allocation, Infinity)).toBe(true);
  expect(uploads).toHaveLength(18);
  expect(uploads.at(-1)!.length).toBe(2_368);
  expect(copies).toHaveLength(18);
  arena.free(allocation);
  expect(wrapper.getCounts()).toMatchObject({ buffers: 0, vaos: 0 });
});

it('keeps sorted indices isolated when allocations span separate pages', () => {
  const elementBindings: WebGLBuffer[] = [];
  const sortedUploads: Array<{ bound: WebGLBuffer | null; offset: number }> = [];
  let boundElement: WebGLBuffer | null = null;
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
    bindBuffer: (target: number, buffer: WebGLBuffer) => {
      if (target === 2) {
        boundElement = buffer;
        elementBindings.push(buffer);
      }
    },
    bufferData: vi.fn(),
    bufferSubData: (target: number, offset: number) => {
      if (target === 2) sortedUploads.push({ bound: boundElement, offset });
    },
    enableVertexAttribArray: vi.fn(),
    vertexAttribIPointer: vi.fn(),
    copyBufferSubData: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  const arena = new TerrainArena(new GLWrapper(gl, false));
  const fullPage = arena.upload(bucket(1, 4_096));
  const nextPage = arena.upload(bucket(2));

  expect(nextPage.page).not.toBe(fullPage.page);
  arena.updateSortedIndices(fullPage, new Uint32Array(fullPage.indexCount));
  arena.updateSortedIndices(nextPage, new Uint32Array(nextPage.indexCount));

  expect(sortedUploads).toHaveLength(2);
  expect(sortedUploads[0]!.bound).toBe(fullPage.page.indices);
  expect(sortedUploads[1]!.bound).toBe(nextPage.page.indices);
  expect(sortedUploads.map(({ offset }) => offset)).toEqual([0, 0]);
  expect(elementBindings).toContain(fullPage.page.indices);
  expect(elementBindings).toContain(nextPage.page.indices);
  arena.free(fullPage);
  arena.free(nextPage);
});

import { describe, expect, it } from 'vitest';
import { GLWrapper } from '../../src/render/gl';
import { TerrainArena } from '../../src/render/terrain-arena';

describe('terrain arena pre-draw staging', () => {
  it('copies lazy index fills, vertices, and sorted indices before the next draw frame', () => {
    const bindings = new Map<number, WebGLBuffer>();
    const copies: Array<{
      source: WebGLBuffer | undefined;
      destination: WebGLBuffer | undefined;
      args: unknown[];
    }> = [];
    const stageWrites: Array<{ buffer: WebGLBuffer | undefined; offset: number }> = [];
    let nextBuffer = 0;
    const gl = {
      ARRAY_BUFFER: 1,
      ELEMENT_ARRAY_BUFFER: 2,
      COPY_READ_BUFFER: 5,
      COPY_WRITE_BUFFER: 6,
      STREAM_DRAW: 7,
      STATIC_DRAW: 8,
      DYNAMIC_DRAW: 9,
      UNSIGNED_INT: 10,
      createBuffer: () => ({ id: ++nextBuffer }),
      createVertexArray: () => ({ id: ++nextBuffer }),
      deleteBuffer: () => {},
      deleteVertexArray: () => {},
      bindBuffer: (target: number, buffer: WebGLBuffer) => bindings.set(target, buffer),
      bindVertexArray: () => {},
      bufferData: () => {},
      bufferSubData: (target: number, offset: number) => {
        if (target === 1) stageWrites.push({ buffer: bindings.get(target), offset });
      },
      copyBufferSubData: (...args: unknown[]) => {
        copies.push({
          source: bindings.get(5),
          destination: bindings.get(6),
          args,
        });
      },
      enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {},
      vertexAttribIPointer: () => {},
      getParameter: () => null,
    } as unknown as WebGL2RenderingContext;
    const arena = new TerrainArena(new GLWrapper(gl, false), {
      initialPageQuads: 131_072,
      maxPageQuads: 131_072,
    });
    const bucket = {
      canonicalQuads: true,
      vertices: new Uint32Array(8 * 8),
      indices: new Uint32Array(8 * 6),
      vertexCount: 32,
      quadCount: 8,
    };

    arena.beginUploadBatch();
    const allocation = arena.upload(bucket);
    expect(arena.uploadPending(allocation, 5, true)).toBe(true);
    arena.endUploadBatch();
    arena.queueSortedIndices(allocation, new Uint32Array(allocation.indexCount));

    expect(stageWrites).toHaveLength(2);
    expect(copies).toHaveLength(0);
    arena.beginDrawFrame();

    expect(copies).toHaveLength(3);
    expect(copies[0]!.source).toBe(allocation.page.vertexStaging);
    expect(copies[0]!.destination).toBe(allocation.page.indices);
    expect(copies[1]!.source).toBe(allocation.page.vertexStaging);
    expect(copies[1]!.destination).toBe(allocation.page.vertices);
    expect(copies[2]!.source).toBe(allocation.page.vertexStaging);
    expect(copies[2]!.destination).toBe(allocation.page.indices);
    expect(copies.map((copy) => copy.args[4])).toEqual([
      32_768 * 6 * Uint32Array.BYTES_PER_ELEMENT,
      bucket.vertices.byteLength,
      bucket.indices.byteLength,
    ]);

    arena.endDrawFrame();
    arena.free(allocation);
  });
});

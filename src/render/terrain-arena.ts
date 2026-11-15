import type { MeshBucketData } from '../mesh/greedy';
import { BufferArenaAllocator, type ArenaRange } from './buffer-arena-allocator';
import { canonicalQuadVertices, quadIndices } from './shared-quads';
import { GLWrapper } from './gl';

interface ArenaPage {
  vao: WebGLVertexArrayObject;
  vertices: WebGLBuffer;
  indices: WebGLBuffer;
  vertexStaging: WebGLBuffer;
  indexStaging: WebGLBuffer;
  vertexSpace: BufferArenaAllocator;
  indexSpace: BufferArenaAllocator;
  allocations: number;
}

export interface TerrainAllocation {
  page: ArenaPage;
  vertices: ArenaRange;
  indices: ArenaRange;
  vertexBase: number;
  indexCount: number;
}

/** Pages own both buffers and a VAO. Empty pages are deleted when their final range is freed. */
export class TerrainArena {
  private readonly pages: ArenaPage[] = [];
  constructor(private readonly wrapper: GLWrapper) {}

  upload(bucket: MeshBucketData): TerrainAllocation {
    const vertices = canonicalQuadVertices(bucket);
    const indexBytes = bucket.quadCount * 6 * 4;
    let page: ArenaPage | undefined;
    let vertexRange: ArenaRange | null = null;
    let indexRange: ArenaRange | null = null;
    for (const candidate of this.pages) {
      vertexRange = candidate.vertexSpace.allocate(vertices.byteLength, 8);
      if (!vertexRange) continue;
      indexRange = candidate.indexSpace.allocate(indexBytes, 4);
      if (indexRange) {
        page = candidate;
        break;
      }
      candidate.vertexSpace.free(vertexRange);
    }
    if (!page) {
      page = this.createPage(vertices.byteLength, indexBytes);
      vertexRange = page.vertexSpace.allocate(vertices.byteLength, 8)!;
      indexRange = page.indexSpace.allocate(indexBytes, 4)!;
    }
    const base = vertexRange!.offset / 8;
    const indices = bucket.canonicalQuads ? bucket.indices : quadIndices(bucket.quadCount);
    for (let i = 0; i < indices.length; i++) indices[i] = indices[i]! + base;
    const gl = this.wrapper.gl;
    gl.bindVertexArray(page.vao);
    gl.bindBuffer(gl.COPY_READ_BUFFER, page.vertexStaging);
    gl.bufferData(gl.COPY_READ_BUFFER, vertices, gl.STREAM_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, page.vertices);
    gl.copyBufferSubData(
      gl.COPY_READ_BUFFER,
      gl.COPY_WRITE_BUFFER,
      0,
      vertexRange!.offset,
      vertices.byteLength,
    );
    gl.bindBuffer(gl.COPY_READ_BUFFER, page.indexStaging);
    gl.bufferData(gl.COPY_READ_BUFFER, indices, gl.STREAM_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, page.indices);
    gl.copyBufferSubData(
      gl.COPY_READ_BUFFER,
      gl.COPY_WRITE_BUFFER,
      0,
      indexRange!.offset,
      indices.byteLength,
    );
    if (bucket.canonicalQuads && base !== 0)
      for (let i = 0; i < indices.length; i++) indices[i] = indices[i]! - base;
    gl.bindVertexArray(null);
    page.allocations++;
    return {
      page,
      vertices: vertexRange!,
      indices: indexRange!,
      vertexBase: base,
      indexCount: indices.length,
    };
  }

  free(allocation: TerrainAllocation): void {
    const page = allocation.page;
    page.vertexSpace.free(allocation.vertices);
    page.indexSpace.free(allocation.indices);
    if (--page.allocations !== 0) return;
    const index = this.pages.indexOf(page);
    if (index < 0) throw new Error('Unknown arena page');
    this.pages.splice(index, 1);
    this.wrapper.deleteVertexArray(page.vao);
    this.wrapper.deleteBuffer(page.vertices);
    this.wrapper.deleteBuffer(page.indices);
    this.wrapper.deleteBuffer(page.vertexStaging);
    this.wrapper.deleteBuffer(page.indexStaging);
  }

  private createPage(vertexBytes: number, indexBytes: number): ArenaPage {
    const vertexCapacity = Math.max(4 * 1024 * 1024, 2 ** Math.ceil(Math.log2(vertexBytes)));
    const indexCapacity = Math.max(3 * 1024 * 1024, 2 ** Math.ceil(Math.log2(indexBytes)));
    const gl = this.wrapper.gl;
    const vao = this.wrapper.createVertexArray();
    const vertices = this.wrapper.createBuffer();
    const indices = this.wrapper.createBuffer();
    const vertexStaging = this.wrapper.createBuffer();
    const indexStaging = this.wrapper.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, vertexCapacity, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 8, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 8, 4);
    // WebGL distinguishes element buffers from other buffers, including when copying.
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexStaging);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexCapacity, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    const page = {
      vao,
      vertices,
      indices,
      vertexStaging,
      indexStaging,
      vertexSpace: new BufferArenaAllocator(vertexCapacity),
      indexSpace: new BufferArenaAllocator(indexCapacity),
      allocations: 0,
    };
    this.pages.push(page);
    return page;
  }
}

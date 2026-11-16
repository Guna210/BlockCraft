import type { MeshBucketData } from '../mesh/greedy';
import { BufferArenaAllocator, type ArenaRange } from './buffer-arena-allocator';
import { canonicalQuadVertices } from './shared-quads';
import { GLWrapper } from './gl';
import { renderPhaseStats } from '../engine/render-phase-stats';

let indexPattern = new Uint32Array(0);
let indexPatternQuads = 0;

function sharedIndexPattern(requiredQuads: number): Uint32Array {
  if (requiredQuads <= indexPatternQuads) return indexPattern;
  indexPatternQuads = Math.max(4_096, 2 ** Math.ceil(Math.log2(requiredQuads)));
  indexPattern = new Uint32Array(indexPatternQuads * 6);
  for (let quad = 0; quad < indexPatternQuads; quad++) {
    const vertex = quad * 4;
    const index = quad * 6;
    indexPattern[index] = vertex;
    indexPattern[index + 1] = vertex + 1;
    indexPattern[index + 2] = vertex + 2;
    indexPattern[index + 3] = vertex;
    indexPattern[index + 4] = vertex + 2;
    indexPattern[index + 5] = vertex + 3;
  }
  return indexPattern;
}

interface ArenaPage {
  vao: WebGLVertexArrayObject;
  vertices: WebGLBuffer;
  vertexStaging: WebGLBuffer;
  indices: WebGLBuffer;
  quadSpace: BufferArenaAllocator;
  allocations: number;
  lastUsedFrame: number;
}

interface VertexUploadSegment {
  vertices: Uint32Array;
  destinationByteOffset: number;
  sourceWordOffset: number;
  wordCount: number;
}

export interface TerrainAllocation {
  page: ArenaPage;
  quads: ArenaRange;
  vertices: ArenaRange;
  indices: ArenaRange;
  vertexBase: number;
  indexCount: number;
  pendingUpload: boolean;
  uploadSegments: VertexUploadSegment[];
  uploadSegmentIndex: number;
  uploadSegmentWordOffset: number;
  indicesSorted: boolean;
  sortedIndices: Uint32Array | null;
  debugIndices: Uint32Array | null;
}

/** Each page owns its vertex and index buffers and is freed with its final range. */
export class TerrainArena {
  private static readonly MAX_UPLOAD_BYTES = 16 * 1024;
  private static readonly FRAME_UPLOAD_BYTES = 4 * 1024;
  private readonly pages: ArenaPage[] = [];
  private readonly allocations = new Set<TerrainAllocation>();
  private frame = 0;
  private debugVertexArray: WebGLVertexArrayObject | null = null;
  private debugVertexBuffer: WebGLBuffer | null = null;
  private debugIndexBuffer: WebGLBuffer | null = null;
  constructor(private readonly wrapper: GLWrapper) {}

  beginUploadBatch(frame = this.frame + 1): void {
    this.frame = frame;
    // Uploads are advanced by the frame-budgeted streamer in small arena ranges.
  }

  endUploadBatch(): void {
    // Kept as a frame boundary hook for ChunkRenderer's upload lifecycle.
  }

  /** Readable aliases for debug inspection; the data is copied from this section's arena range. */
  debugReadbackVertices(allocation: TerrainAllocation): WebGLBuffer {
    if (!this.wrapper.debugInspection) return allocation.page.vertices;
    const gl = this.wrapper.gl;
    this.debugVertexBuffer ??= this.wrapper.createBuffer();
    if (allocation.pendingUpload) this.uploadPending(allocation, Infinity);
    gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.page.vertices);
    const vertices = new Uint32Array(allocation.vertices.length / 4);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, allocation.vertices.offset, vertices);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.debugVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    return this.debugVertexBuffer;
  }

  debugReadbackIndices(allocation: TerrainAllocation, indexCount: number): WebGLBuffer {
    if (!this.wrapper.debugInspection) return allocation.page.indices;
    const gl = this.wrapper.gl;
    this.debugIndexBuffer ??= this.wrapper.createBuffer();
    let indices = allocation.debugIndices;
    if (!indices) {
      // The debug VAO uses section-local indices. Build them only when geometry inspection asks
      // for this section; creating a CPU copy for every streamed bucket made normal debug frames
      // pay for readback data they never inspect.
      indices = this.buildDebugIndices(indexCount);
      allocation.debugIndices = indices;
    }
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    this.debugVertexArray ??= this.wrapper.createVertexArray();
    gl.bindVertexArray(this.debugVertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.debugIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(previousVao);
    return this.debugIndexBuffer;
  }

  upload(
    bucket: MeshBucketData,
    additionalBucket?: MeshBucketData,
    dedicatedPage = false,
  ): TerrainAllocation {
    const phaseStart = renderPhaseStats.start();
    const firstVertices = bucket.quadCount > 0 ? canonicalQuadVertices(bucket) : null;
    const secondVertices =
      additionalBucket && additionalBucket.quadCount > 0
        ? canonicalQuadVertices(additionalBucket)
        : null;
    const quadCount = bucket.quadCount + (secondVertices ? additionalBucket!.quadCount : 0);
    const vertexWords = (firstVertices?.length ?? 0) + (secondVertices?.length ?? 0);
    const indexCount = quadCount * 6;
    let page: ArenaPage | undefined;
    let quadRange: ArenaRange | null = null;
    if (dedicatedPage) {
      const initialVertices = this.combineVertices(firstVertices, secondVertices, vertexWords);
      page = this.createPage(quadCount, initialVertices);
      quadRange = page.quadSpace.allocate(quadCount, 1)!;
    } else {
      for (const candidate of this.pages) {
        if (this.frame - candidate.lastUsedFrame <= 4) continue;
        quadRange = candidate.quadSpace.allocate(quadCount, 1);
        if (!quadRange) continue;
        page = candidate;
        break;
      }
      if (!page) {
        page = this.createPage(quadCount);
        quadRange = page.quadSpace.allocate(quadCount, 1)!;
      }
    }
    const allocatedQuads = quadRange!;
    const vertexRange = { offset: allocatedQuads.offset * 32, length: quadCount * 32 };
    const indexRange = { offset: allocatedQuads.offset * 24, length: quadCount * 24 };
    const base = vertexRange.offset / 8;
    const uploadSegments: VertexUploadSegment[] = [];
    if (firstVertices)
      uploadSegments.push({
        vertices: firstVertices,
        destinationByteOffset: vertexRange.offset,
        sourceWordOffset: 0,
        wordCount: firstVertices.length,
      });
    if (secondVertices)
      uploadSegments.push({
        vertices: secondVertices,
        destinationByteOffset: vertexRange.offset + (firstVertices?.byteLength ?? 0),
        sourceWordOffset: 0,
        wordCount: secondVertices.length,
      });
    page.allocations++;
    const allocation: TerrainAllocation = {
      page,
      quads: allocatedQuads,
      vertices: vertexRange,
      indices: indexRange,
      vertexBase: base,
      indexCount,
      pendingUpload: !dedicatedPage && vertexWords > 0,
      uploadSegments: dedicatedPage ? [] : uploadSegments,
      uploadSegmentIndex: 0,
      uploadSegmentWordOffset: 0,
      indicesSorted: false,
      sortedIndices: null,
      debugIndices: null,
    };
    this.allocations.add(allocation);
    renderPhaseStats.end('arenaPackMs', phaseStart);
    return allocation;
  }

  private combineVertices(
    first: Uint32Array | null,
    second: Uint32Array | null,
    wordCount: number,
  ): Uint32Array {
    if (!second) return first ?? new Uint32Array(0);
    const vertices = new Uint32Array(wordCount);
    let offset = 0;
    if (first) {
      vertices.set(first);
      offset = first.length;
    }
    vertices.set(second, offset);
    return vertices;
  }

  /** Uploads bounded byte ranges directly into the allocation's vertex arena. */
  uploadPending(allocation: TerrainAllocation, budgetMs: number, frameBudgeted = false): boolean {
    if (!allocation.pendingUpload) return true;
    if (budgetMs <= 0) return false;
    const start = renderPhaseStats.start();
    const clockStart = performance.now();
    const gl = this.wrapper.gl;
    if (frameBudgeted) gl.bindBuffer(gl.ARRAY_BUFFER, allocation.page.vertices);
    else {
      gl.bindBuffer(gl.COPY_READ_BUFFER, allocation.page.vertexStaging);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, allocation.page.vertices);
    }
    let chunks = 0;
    while (
      allocation.pendingUpload &&
      (chunks === 0 || performance.now() - clockStart < budgetMs)
    ) {
      const segment = allocation.uploadSegments[allocation.uploadSegmentIndex]!;
      const remaining = segment.wordCount - allocation.uploadSegmentWordOffset;
      const maxBytes = frameBudgeted
        ? TerrainArena.FRAME_UPLOAD_BYTES
        : TerrainArena.MAX_UPLOAD_BYTES;
      const words = Math.min(remaining, maxBytes / 4);
      const destination = segment.destinationByteOffset + allocation.uploadSegmentWordOffset * 4;
      if (frameBudgeted) {
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          destination,
          segment.vertices,
          segment.sourceWordOffset + allocation.uploadSegmentWordOffset,
          words,
        );
      } else {
        gl.bufferData(
          gl.COPY_READ_BUFFER,
          segment.vertices,
          gl.STREAM_DRAW,
          segment.sourceWordOffset + allocation.uploadSegmentWordOffset,
          words,
        );
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, destination, words * 4);
      }
      allocation.uploadSegmentWordOffset += words;
      chunks++;
      if (allocation.uploadSegmentWordOffset === segment.wordCount) {
        allocation.uploadSegmentIndex++;
        allocation.uploadSegmentWordOffset = 0;
        if (allocation.uploadSegmentIndex >= allocation.uploadSegments.length) {
          allocation.pendingUpload = false;
          allocation.uploadSegments.length = 0;
        }
      }
    }
    const elapsed = performance.now() - clockStart;
    renderPhaseStats.end('arenaTransferMs', start);
    renderPhaseStats.add('arenaUploadMs', elapsed);
    return !allocation.pendingUpload;
  }

  private buildDebugIndices(indexCount: number): Uint32Array {
    const indices = new Uint32Array(indexCount);
    for (let q = 0; q < indexCount / 6; q++) {
      const base = q * 4;
      const out = q * 6;
      indices[out] = base;
      indices[out + 1] = base + 1;
      indices[out + 2] = base + 2;
      indices[out + 3] = base;
      indices[out + 4] = base + 2;
      indices[out + 5] = base + 3;
    }
    return indices;
  }

  updateSortedIndices(allocation: TerrainAllocation, indices: Uint32Array): void {
    const gl = this.wrapper.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, allocation.page.indices);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, allocation.indices.offset, indices);
    allocation.indicesSorted = true;
    allocation.sortedIndices = indices;
  }

  bindSharedIndices(allocation: TerrainAllocation): void {
    this.wrapper.gl.bindBuffer(this.wrapper.gl.ELEMENT_ARRAY_BUFFER, allocation.page.indices);
  }

  markUsed(allocation: TerrainAllocation): void {
    allocation.page.lastUsedFrame = this.frame;
  }

  free(allocation: TerrainAllocation): void {
    allocation.pendingUpload = false;
    allocation.uploadSegments.length = 0;
    allocation.debugIndices = null;
    this.allocations.delete(allocation);
    if (allocation.indicesSorted) {
      const gl = this.wrapper.gl;
      gl.bindVertexArray(allocation.page.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, allocation.page.indices);
      gl.bufferSubData(
        gl.ELEMENT_ARRAY_BUFFER,
        allocation.indices.offset,
        sharedIndexPattern(allocation.quads.offset + allocation.quads.length),
        allocation.quads.offset * 6,
        allocation.indexCount,
      );
      allocation.indicesSorted = false;
      allocation.sortedIndices = null;
    }
    const page = allocation.page;
    page.quadSpace.free(allocation.quads);
    if (--page.allocations !== 0) return;
    const index = this.pages.indexOf(page);
    if (index < 0) throw new Error('Unknown arena page');
    this.pages.splice(index, 1);
    this.wrapper.deleteVertexArray(page.vao);
    this.wrapper.deleteBuffer(page.vertices);
    this.wrapper.deleteBuffer(page.vertexStaging);
    this.wrapper.deleteBuffer(page.indices);
    if (this.pages.length === 0) {
      if (this.debugVertexBuffer) this.wrapper.deleteBuffer(this.debugVertexBuffer);
      if (this.debugIndexBuffer) this.wrapper.deleteBuffer(this.debugIndexBuffer);
      if (this.debugVertexArray) this.wrapper.deleteVertexArray(this.debugVertexArray);
      this.debugVertexArray = null;
      this.debugVertexBuffer = null;
      this.debugIndexBuffer = null;
    }
  }

  private createPage(quadCount: number, initialVertices?: Uint32Array): ArenaPage {
    const quadCapacity = initialVertices
      ? Math.max(1, quadCount)
      : Math.max(4_096, 2 ** Math.ceil(Math.log2(quadCount)));
    const vertexCapacity = quadCapacity * 32;
    const gl = this.wrapper.gl;
    const indices = this.wrapper.createBuffer();
    const vao = this.wrapper.createVertexArray();
    const vertices = this.wrapper.createBuffer();
    const vertexStaging = this.wrapper.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sharedIndexPattern(quadCapacity), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    if (initialVertices) gl.bufferData(gl.ARRAY_BUFFER, initialVertices, gl.DYNAMIC_DRAW);
    else gl.bufferData(gl.ARRAY_BUFFER, vertexCapacity, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 8, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 8, 4);
    // WebGL distinguishes element buffers from other buffers, including when copying.
    gl.bindVertexArray(null);
    const page = {
      vao,
      vertices,
      vertexStaging,
      indices,
      quadSpace: new BufferArenaAllocator(quadCapacity),
      allocations: 0,
      lastUsedFrame: -1000,
    };
    this.pages.push(page);
    return page;
  }
}

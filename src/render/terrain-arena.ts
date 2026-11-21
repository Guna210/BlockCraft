import type { MeshBucketData } from '../mesh/greedy';
import { BufferArenaAllocator, type ArenaRange } from './buffer-arena-allocator';
import { canonicalQuadVertices } from './shared-quads';
import { GLWrapper } from './gl';
import { renderPhaseStats } from '../engine/render-phase-stats';

export const DEFAULT_ARENA_PAGE_QUADS = 4_096;
export const MAX_ARENA_PAGE_QUADS = 262_144;

/** Pages up to this many quads get their whole index pattern at creation (<= 1.5 MB). */
const EAGER_INDEX_QUADS = 65_536;
/** Larger pages fill their index buffer lazily in chunks of this many quads (768 KB). */
const INDEX_CHUNK_QUADS = 32_768;

let indexScratch = new Uint32Array(0);

/** Canonical quad indices (0,1,2,0,2,3 + 4q) for quads [startQuad, startQuad + count) in a reused scratch array. */
function canonicalIndices(startQuad: number, count: number): Uint32Array {
  if (indexScratch.length < count * 6) indexScratch = new Uint32Array(count * 6);
  for (let q = 0; q < count; q++) {
    const vertex = (startQuad + q) * 4;
    const index = q * 6;
    indexScratch[index] = vertex;
    indexScratch[index + 1] = vertex + 1;
    indexScratch[index + 2] = vertex + 2;
    indexScratch[index + 3] = vertex;
    indexScratch[index + 4] = vertex + 2;
    indexScratch[index + 5] = vertex + 3;
  }
  return indexScratch.subarray(0, count * 6);
}

let eagerPattern: Uint32Array | null = null;
function eagerIndexPattern(): Uint32Array {
  eagerPattern ??= canonicalIndices(0, EAGER_INDEX_QUADS).slice();
  return eagerPattern;
}

export interface QuarantinedRange {
  quads: ArenaRange;
  lastUsedDrawFrame: number;
  /** The range's sorted index data must be reset to canonical order once it is reclaimed. */
  restoreIndices: boolean;
}

export interface ArenaPage {
  id: number;
  vao: WebGLVertexArrayObject;
  vertices: WebGLBuffer;
  vertexStaging: WebGLBuffer;
  indices: WebGLBuffer;
  quadCapacity: number;
  /** Quads [0, indexFilledQuads) of the index buffer hold the canonical pattern. */
  indexFilledQuads: number;
  quadSpace: BufferArenaAllocator;
  allocations: number;
  lastUsedFrame: number;
  lastUsedDrawFrame: number;
  quarantined: QuarantinedRange[];
}

interface FrameFenceRecord {
  drawFrame: number;
  fence: WebGLSync;
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

export interface TerrainArenaOptions {
  initialPageQuads?: number;
  maxPageQuads?: number;
}

/**
 * Each page owns its vertex and index buffers and is freed when its active and quarantined
 * allocations both reach zero. Freed ranges from drawn pages remain quarantined until the
 * fence inserted after their last draw frame signals (`decisions/PERF-batch-terrain.md`).
 */
export class TerrainArena {
  private static readonly MAX_UPLOAD_BYTES = 16 * 1024;
  private static readonly FRAME_UPLOAD_BYTES = 4 * 1024;
  private static nextPageId = 1;
  public readonly pages: ArenaPage[] = [];
  private readonly pageById = new Map<number, ArenaPage>();
  private readonly allocations = new Set<TerrainAllocation>();
  private readonly frameFences: FrameFenceRecord[] = [];
  private frame = 0;
  private drawFrame = 0;
  private completedDrawFrame = 0;
  private drewInCurrentFrame = false;
  private readonly initialPageQuads: number;
  private readonly maxPageQuads: number;
  private debugVertexArray: WebGLVertexArrayObject | null = null;
  private debugVertexBuffer: WebGLBuffer | null = null;
  private debugIndexBuffer: WebGLBuffer | null = null;

  constructor(
    private readonly wrapper: GLWrapper,
    options?: TerrainArenaOptions,
  ) {
    this.initialPageQuads = options?.initialPageQuads ?? DEFAULT_ARENA_PAGE_QUADS;
    this.maxPageQuads = Math.max(
      this.initialPageQuads,
      options?.maxPageQuads ?? MAX_ARENA_PAGE_QUADS,
    );
  }

  public getPageById(pageId: number): ArenaPage | undefined {
    return this.pageById.get(pageId);
  }

  public get pageCount(): number {
    return this.pages.length;
  }

  beginUploadBatch(frame = this.frame + 1): void {
    this.frame = frame;
    this.pollFences();
  }

  endUploadBatch(): void {
    // Kept as a frame boundary hook for ChunkRenderer's upload lifecycle.
  }

  /** Marks the start of a terrain draw frame and polls any outstanding fences without blocking. */
  public beginDrawFrame(): void {
    this.pollFences();
    this.drawFrame++;
    this.drewInCurrentFrame = false;
  }

  /** Records a non-blocking GPU fence after all terrain draws for this frame have been submitted. */
  public endDrawFrame(): void {
    if (!this.drewInCurrentFrame) {
      // A frame that drew nothing from this arena leaves earlier frames' fences in force: ranges
      // freed after those draws stay quarantined until their own fence signals.
      this.completeIfNoFencePending();
      return;
    }
    const gl = this.wrapper.gl as Partial<WebGL2RenderingContext>;
    if (typeof gl.fenceSync === 'function' && typeof gl.clientWaitSync === 'function') {
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE!, 0);
      if (fence) this.frameFences.push({ drawFrame: this.drawFrame, fence });
      else this.completeIfNoFencePending();
    } else {
      this.completeIfNoFencePending();
    }
    this.drewInCurrentFrame = false;
  }

  /** Advances the completed draw frame only when no earlier frame's fence is still pending. */
  private completeIfNoFencePending(): void {
    if (this.frameFences.length === 0) this.completedDrawFrame = this.drawFrame;
    this.reclaimQuarantined();
  }

  /** Polls pending frame fences with zero timeout and releases quarantined ranges whose draw completed. */
  public pollFences(): void {
    const gl = this.wrapper.gl as Partial<WebGL2RenderingContext>;
    if (typeof gl.clientWaitSync === 'function') {
      while (this.frameFences.length > 0) {
        const record = this.frameFences[0]!;
        const status = gl.clientWaitSync(record.fence, 0, 0);
        const pending = status === gl.TIMEOUT_EXPIRED || status === gl.WAIT_FAILED;
        if (!pending) {
          if (typeof gl.deleteSync === 'function') gl.deleteSync(record.fence);
          this.completedDrawFrame = Math.max(this.completedDrawFrame, record.drawFrame);
          this.frameFences.shift();
        } else {
          break;
        }
      }
    } else if (this.frameFences.length > 0) {
      this.frameFences.length = 0;
      this.completedDrawFrame = this.drawFrame;
    }
    this.reclaimQuarantined();
  }

  private reclaimQuarantined(): void {
    for (let p = this.pages.length - 1; p >= 0; p--) {
      const page = this.pages[p]!;
      const q = page.quarantined;
      if (q.length === 0) continue;
      let writeIdx = 0;
      for (let i = 0; i < q.length; i++) {
        const item = q[i]!;
        if (item.lastUsedDrawFrame <= this.completedDrawFrame) {
          if (item.restoreIndices) this.writeCanonicalIndices(page, item.quads);
          page.quadSpace.free(item.quads);
        } else {
          q[writeIdx++] = item;
        }
      }
      q.length = writeIdx;
      if (page.allocations === 0 && q.length === 0) {
        this.destroyPageAt(p);
      }
    }
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
    const sources: Uint32Array[] = [];
    if (firstVertices) sources.push(firstVertices);
    if (secondVertices) sources.push(secondVertices);
    return this.allocate(quadCount, sources, dedicatedPage, phaseStart);
  }

  /** Reserves a range for a worker-packed pass buffer without combining vertex data on the main thread. */
  uploadPacked(vertices: Uint32Array, quadCount: number, dedicatedPage = false): TerrainAllocation {
    if (vertices.length !== quadCount * 8)
      throw new Error('Packed terrain vertex count does not match quad count');
    return this.allocate(
      quadCount,
      vertices.length > 0 ? [vertices] : [],
      dedicatedPage,
      renderPhaseStats.start(),
    );
  }

  private allocate(
    quadCount: number,
    sources: Uint32Array[],
    dedicatedPage: boolean,
    phaseStart: number,
  ): TerrainAllocation {
    this.pollFences();
    const vertexWords = sources.reduce((total, source) => total + source.length, 0);
    const indexCount = quadCount * 6;
    let page: ArenaPage | undefined;
    let quadRange: ArenaRange | null = null;
    if (dedicatedPage) {
      const initialVertices = this.combineVertices(sources, vertexWords);
      page = this.createPage(quadCount, initialVertices);
      quadRange = page.quadSpace.allocate(quadCount, 1)!;
    } else {
      for (let i = 0; i < this.pages.length; i++) {
        const candidate = this.pages[i]!;
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
    this.ensureIndices(page, allocatedQuads.offset + quadCount);
    const vertexRange = { offset: allocatedQuads.offset * 32, length: quadCount * 32 };
    const indexRange = { offset: allocatedQuads.offset * 24, length: quadCount * 24 };
    const base = vertexRange.offset / 8;
    const uploadSegments: VertexUploadSegment[] = [];
    let destinationByteOffset = vertexRange.offset;
    for (const vertices of sources) {
      uploadSegments.push({
        vertices,
        destinationByteOffset,
        sourceWordOffset: 0,
        wordCount: vertices.length,
      });
      destinationByteOffset += vertices.byteLength;
    }
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

  private combineVertices(sources: Uint32Array[], wordCount: number): Uint32Array {
    if (sources.length <= 1) return sources[0] ?? new Uint32Array(0);
    const vertices = new Uint32Array(wordCount);
    let offset = 0;
    for (const source of sources) {
      vertices.set(source, offset);
      offset += source.length;
    }
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
    allocation.page.lastUsedDrawFrame = this.drawFrame;
    this.drewInCurrentFrame = true;
  }

  free(allocation: TerrainAllocation): void {
    allocation.pendingUpload = false;
    allocation.uploadSegments.length = 0;
    allocation.debugIndices = null;
    this.allocations.delete(allocation);
    const restoreIndices = allocation.indicesSorted;
    allocation.indicesSorted = false;
    allocation.sortedIndices = null;
    const page = allocation.page;
    page.allocations--;
    this.pollFences();
    if (page.lastUsedDrawFrame > this.completedDrawFrame) {
      // Any write to the range (the sorted-index reset included) waits until it is reclaimed.
      page.quarantined.push({
        quads: allocation.quads,
        lastUsedDrawFrame: page.lastUsedDrawFrame,
        restoreIndices,
      });
      return;
    }
    if (restoreIndices) this.writeCanonicalIndices(page, allocation.quads);
    page.quadSpace.free(allocation.quads);
    if (page.allocations !== 0 || page.quarantined.length !== 0) return;
    const index = this.pages.indexOf(page);
    if (index < 0) throw new Error('Unknown arena page');
    this.destroyPageAt(index);
  }

  /**
   * Fills the page's index buffer with the canonical pattern up to `endQuad`, a bounded chunk at
   * a time, so a large page never uploads its whole index buffer in one go.
   */
  private ensureIndices(page: ArenaPage, endQuad: number): void {
    if (page.indexFilledQuads >= endQuad) return;
    const gl = this.wrapper.gl;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, page.indices);
    while (page.indexFilledQuads < endQuad) {
      const start = page.indexFilledQuads;
      const count = Math.min(INDEX_CHUNK_QUADS, page.quadCapacity - start);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, start * 24, canonicalIndices(start, count));
      page.indexFilledQuads = start + count;
    }
  }

  /** Resets a range whose index data was sorted back to the canonical pattern. */
  private writeCanonicalIndices(page: ArenaPage, range: ArenaRange): void {
    const gl = this.wrapper.gl;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, page.indices);
    for (let done = 0; done < range.length; done += INDEX_CHUNK_QUADS) {
      const count = Math.min(INDEX_CHUNK_QUADS, range.length - done);
      gl.bufferSubData(
        gl.COPY_WRITE_BUFFER,
        (range.offset + done) * 24,
        canonicalIndices(range.offset + done, count),
      );
    }
  }

  private destroyPageAt(index: number): void {
    const page = this.pages[index]!;
    this.pages.splice(index, 1);
    this.pageById.delete(page.id);
    this.wrapper.deleteVertexArray(page.vao);
    this.wrapper.deleteBuffer(page.vertices);
    this.wrapper.deleteBuffer(page.vertexStaging);
    this.wrapper.deleteBuffer(page.indices);
    if (this.pages.length === 0) this.releaseIdleResources();
  }

  /** Deletes pending fences and debug readback objects once no page can still be drawn. */
  private releaseIdleResources(): void {
    const gl = this.wrapper.gl as Partial<WebGL2RenderingContext>;
    if (typeof gl.deleteSync === 'function') {
      for (const record of this.frameFences) gl.deleteSync(record.fence);
    }
    this.frameFences.length = 0;
    this.completedDrawFrame = this.drawFrame;
    if (this.debugVertexBuffer) this.wrapper.deleteBuffer(this.debugVertexBuffer);
    if (this.debugIndexBuffer) this.wrapper.deleteBuffer(this.debugIndexBuffer);
    if (this.debugVertexArray) this.wrapper.deleteVertexArray(this.debugVertexArray);
    this.debugVertexArray = null;
    this.debugVertexBuffer = null;
    this.debugIndexBuffer = null;
  }

  /**
   * World teardown: drops quarantined ranges, pending fences and every page (buffers + VAO).
   * Nothing waits on fences that will never be polled again; pages are recreated lazily by the
   * next `allocate`. Any allocation still held by a caller becomes invalid.
   */
  public releaseAll(): void {
    for (const allocation of this.allocations) {
      allocation.pendingUpload = false;
      allocation.uploadSegments.length = 0;
      allocation.debugIndices = null;
      allocation.sortedIndices = null;
      allocation.indicesSorted = false;
    }
    this.allocations.clear();
    while (this.pages.length > 0) {
      this.pages[this.pages.length - 1]!.quarantined.length = 0;
      this.destroyPageAt(this.pages.length - 1);
    }
    this.releaseIdleResources();
    this.drewInCurrentFrame = false;
  }

  private nextGrowCapacity(requiredQuads: number): number {
    const minRequired = 2 ** Math.ceil(Math.log2(Math.max(1, requiredQuads)));
    if (this.pages.length === 0) {
      return Math.max(this.initialPageQuads, minRequired);
    }
    const lastCap = this.pages[this.pages.length - 1]!.quadCapacity;
    const grown = Math.min(this.maxPageQuads, lastCap * 2);
    return Math.max(grown, minRequired);
  }

  private createPage(quadCount: number, initialVertices?: Uint32Array): ArenaPage {
    const quadCapacity = initialVertices
      ? Math.max(1, quadCount)
      : this.nextGrowCapacity(quadCount);
    const vertexCapacity = quadCapacity * 32;
    const gl = this.wrapper.gl;
    const indices = this.wrapper.createBuffer();
    const vao = this.wrapper.createVertexArray();
    const vertices = this.wrapper.createBuffer();
    const vertexStaging = this.wrapper.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    const eager = quadCapacity <= EAGER_INDEX_QUADS;
    if (eager) {
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        eagerIndexPattern().subarray(0, quadCapacity * 6),
        gl.STATIC_DRAW,
      );
    } else {
      // Large pages allocate the index storage now and fill it as sections are allocated.
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadCapacity * 24, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    if (initialVertices) gl.bufferData(gl.ARRAY_BUFFER, initialVertices, gl.DYNAMIC_DRAW);
    else gl.bufferData(gl.ARRAY_BUFFER, vertexCapacity, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 8, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 8, 4);
    gl.bindVertexArray(null);
    const page: ArenaPage = {
      id: TerrainArena.nextPageId++,
      vao,
      vertices,
      vertexStaging,
      indices,
      quadCapacity,
      indexFilledQuads: eager ? quadCapacity : 0,
      quadSpace: new BufferArenaAllocator(quadCapacity),
      allocations: 0,
      lastUsedFrame: -1000,
      lastUsedDrawFrame: 0,
      quarantined: [],
    };
    this.pages.push(page);
    this.pageById.set(page.id, page);
    return page;
  }
}

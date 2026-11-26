/**
 * Pure data structures and batch-packing logic for cross-column terrain multi-draw and
 * per-draw data texture layout (`decisions/PERF-batch-terrain.md`).
 *
 * Kept free of WebGL calls so unit tests can verify key bucketing, translucent run splitting,
 * and per-draw texel layout directly.
 */

export const DRAW_DATA_TEX_WIDTH = 1024;
export const DRAW_DATA_INITIAL_HEIGHT = 64; // 64 * 1024 = 65,536 texels = 32,768 draws
export const TEXELS_PER_DRAW = 2;
export const FLOATS_PER_TEXEL = 4;
export const FLOATS_PER_DRAW = TEXELS_PER_DRAW * FLOATS_PER_TEXEL; // 8 floats (2 RGBA32F texels)
export const MAX_MULTI_DRAW_BATCH = 4096;
export const LIGHTING_VARIANT_COUNT = 4;

export interface BatchSectionEntry {
  indexCount: number;
  indexByteOffset: number;
  originX: number;
  originY: number;
  originZ: number;
  fade: number;
  tintSlot: number;
  pageId: number;
  variant: number; // 0..3
}

export interface MultiDrawCommand {
  variant: number;
  pageId: number;
  drawBase: number;
  drawCount: number;
  countsOffset: number;
  offsetsOffset: number;
}

class PageBucket {
  pageId = -1;
  count = 0;
  entries: BatchSectionEntry[] = [];

  reset(pageId: number): void {
    this.pageId = pageId;
    this.count = 0;
  }

  push(entry: BatchSectionEntry): void {
    if (this.count < this.entries.length) {
      const target = this.entries[this.count]!;
      target.indexCount = entry.indexCount;
      target.indexByteOffset = entry.indexByteOffset;
      target.originX = entry.originX;
      target.originY = entry.originY;
      target.originZ = entry.originZ;
      target.fade = entry.fade;
      target.tintSlot = entry.tintSlot;
      target.pageId = entry.pageId;
      target.variant = entry.variant;
    } else {
      this.entries.push({ ...entry });
    }
    this.count++;
  }
}

/**
 * Preallocated cross-column batcher and per-draw data buffer builder.
 * Zero heap allocations in steady-state frames.
 */
export class TerrainDrawBatcher {
  private texHeight = DRAW_DATA_INITIAL_HEIGHT;
  public drawData = new Float32Array(DRAW_DATA_TEX_WIDTH * this.texHeight * FLOATS_PER_TEXEL);
  public counts = new Int32Array(16_384);
  public offsets = new Int32Array(16_384);

  // Per-(pass, variant) list of active page buckets for pass 0 (opaque) and pass 1 (cutout)
  private readonly bucketPool: PageBucket[] = Array.from({ length: 64 }, () => new PageBucket());
  private bucketPoolUsed = 0;
  // Pass (0..1) -> Variant (0..3) -> PageBucket[]
  private readonly passVariantBuckets: PageBucket[][][] = [
    [[], [], [], []],
    [[], [], [], []],
  ];

  // Preallocated command output lists for opaque (0), cutout (1), translucent (2)
  private readonly commandPools: MultiDrawCommand[][] = [[], [], []];
  private readonly commandCounts: [number, number, number] = [0, 0, 0];

  private totalDraws = 0;

  public beginFrame(): void {
    this.totalDraws = 0;
    this.bucketPoolUsed = 0;
    for (let pass = 0; pass < 2; pass++) {
      const variants = this.passVariantBuckets[pass]!;
      for (let v = 0; v < LIGHTING_VARIANT_COUNT; v++) {
        variants[v]!.length = 0;
      }
    }
    this.commandCounts[0] = 0;
    this.commandCounts[1] = 0;
    this.commandCounts[2] = 0;
  }

  /** Adds a visible opaque (pass 0) or cutout (pass 1) section draw to its (pass, variant, pageId) bucket. */
  public addUnordered(
    pass: 0 | 1,
    variant: number,
    pageId: number,
    indexCount: number,
    indexByteOffset: number,
    originX: number,
    originY: number,
    originZ: number,
    fade: number,
    tintSlot: number,
  ): void {
    const list = this.passVariantBuckets[pass]![variant]!;
    let bucket: PageBucket | undefined;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.pageId === pageId) {
        bucket = list[i]!;
        break;
      }
    }
    if (!bucket) {
      if (this.bucketPoolUsed >= this.bucketPool.length) {
        this.bucketPool.push(new PageBucket());
      }
      bucket = this.bucketPool[this.bucketPoolUsed++]!;
      bucket.reset(pageId);
      list.push(bucket);
    }
    if (bucket.count < bucket.entries.length) {
      const target = bucket.entries[bucket.count]!;
      target.indexCount = indexCount;
      target.indexByteOffset = indexByteOffset;
      target.originX = originX;
      target.originY = originY;
      target.originZ = originZ;
      target.fade = fade;
      target.tintSlot = tintSlot;
      target.pageId = pageId;
      target.variant = variant;
      bucket.count++;
    } else {
      bucket.entries.push({
        indexCount,
        indexByteOffset,
        originX,
        originY,
        originZ,
        fade,
        tintSlot,
        pageId,
        variant,
      });
      bucket.count++;
    }
  }

  /**
   * Packs all added opaque and cutout buckets into `drawData`, `counts`, and `offsets`,
   * producing multi-draw commands chunked by `maxBatchSize`.
   */
  public finalizeUnorderedPass(pass: 0 | 1, maxBatchSize = MAX_MULTI_DRAW_BATCH): void {
    const variants = this.passVariantBuckets[pass]!;
    for (let v = 0; v < LIGHTING_VARIANT_COUNT; v++) {
      const buckets = variants[v]!;
      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b]!;
        let offset = 0;
        while (offset < bucket.count) {
          const chunkCount = Math.min(maxBatchSize, bucket.count - offset);
          const drawBase = this.totalDraws;
          this.ensureCapacity(drawBase + chunkCount);
          for (let i = 0; i < chunkCount; i++) {
            const entry = bucket.entries[offset + i]!;
            this.writeDrawEntry(drawBase + i, entry);
          }
          this.pushCommand(pass, v, bucket.pageId, drawBase, chunkCount);
          this.totalDraws += chunkCount;
          offset += chunkCount;
        }
      }
    }
  }

  /**
   * Packs already back-to-front sorted translucent sections into consecutive runs that share
   * `(variant, pageId)`, chunked only by `maxBatchSize`. Preserves exact sorted order.
   */
  public finalizeTranslucentRuns(
    sortedEntries: ReadonlyArray<BatchSectionEntry>,
    count = sortedEntries.length,
    maxBatchSize = MAX_MULTI_DRAW_BATCH,
  ): void {
    if (count === 0) return;
    this.ensureCapacity(this.totalDraws + count);
    let runStart = 0;
    let runVariant = sortedEntries[0]!.variant;
    let runPageId = sortedEntries[0]!.pageId;
    let runCount = 0;

    for (let i = 0; i < count; i++) {
      const entry = sortedEntries[i]!;
      if (
        runCount > 0 &&
        (entry.variant !== runVariant || entry.pageId !== runPageId || runCount >= maxBatchSize)
      ) {
        const drawBase = this.totalDraws;
        for (let j = 0; j < runCount; j++) {
          this.writeDrawEntry(drawBase + j, sortedEntries[runStart + j]!);
        }
        this.pushCommand(2, runVariant, runPageId, drawBase, runCount);
        this.totalDraws += runCount;
        runStart = i;
        runVariant = entry.variant;
        runPageId = entry.pageId;
        runCount = 0;
      }
      if (runCount === 0) {
        runStart = i;
        runVariant = entry.variant;
        runPageId = entry.pageId;
      }
      runCount++;
    }

    if (runCount > 0) {
      const drawBase = this.totalDraws;
      for (let j = 0; j < runCount; j++) {
        this.writeDrawEntry(drawBase + j, sortedEntries[runStart + j]!);
      }
      this.pushCommand(2, runVariant, runPageId, drawBase, runCount);
      this.totalDraws += runCount;
    }
  }

  /** Appends a single translucent draw onto the current or new run in streaming order (zero temporary array). */
  public beginTranslucentPass(): void {
    this.commandCounts[2] = 0;
  }

  public appendTranslucentDraw(
    variant: number,
    pageId: number,
    indexCount: number,
    indexByteOffset: number,
    originX: number,
    originY: number,
    originZ: number,
    fade: number,
    tintSlot: number,
    maxBatchSize = MAX_MULTI_DRAW_BATCH,
  ): void {
    const drawIndex = this.totalDraws;
    this.ensureCapacity(drawIndex + 1);
    this.writeDrawValues(
      drawIndex,
      indexCount,
      indexByteOffset,
      originX,
      originY,
      originZ,
      fade,
      tintSlot,
    );
    this.totalDraws++;

    const cmdCount = this.commandCounts[2];
    if (cmdCount > 0) {
      const prev = this.commandPools[2]![cmdCount - 1]!;
      if (prev.variant === variant && prev.pageId === pageId && prev.drawCount < maxBatchSize) {
        prev.drawCount++;
        return;
      }
    }
    this.pushCommand(2, variant, pageId, drawIndex, 1);
  }

  /** Adds draw metadata for overlays that do not belong to an opaque/cutout/translucent pass. */
  public appendAuxiliaryDraw(
    originX: number,
    originY: number,
    originZ: number,
    fade: number,
    tintSlot: number,
  ): void {
    const drawIndex = this.totalDraws;
    this.ensureCapacity(drawIndex + 1);
    this.writeDrawValues(drawIndex, 0, 0, originX, originY, originZ, fade, tintSlot);
    this.totalDraws++;
  }

  public getCommandCount(pass: 0 | 1 | 2): number {
    return this.commandCounts[pass];
  }

  public getCommand(pass: 0 | 1 | 2, index: number): MultiDrawCommand {
    return this.commandPools[pass]![index]!;
  }

  public getCommands(pass: 0 | 1 | 2): ReadonlyArray<MultiDrawCommand> {
    return this.commandPools[pass]!.slice(0, this.commandCounts[pass]);
  }

  public getTotalDraws(): number {
    return this.totalDraws;
  }

  /** Shrinks the draw-data buffer back to its initial size (world teardown). */
  public resetCapacity(): void {
    if (this.texHeight === DRAW_DATA_INITIAL_HEIGHT) return;
    this.texHeight = DRAW_DATA_INITIAL_HEIGHT;
    this.drawData = new Float32Array(DRAW_DATA_TEX_WIDTH * this.texHeight * FLOATS_PER_TEXEL);
  }

  public getTextureHeight(): number {
    return this.texHeight;
  }

  /** Number of rows in the `DRAW_DATA_TEX_WIDTH`-wide data texture modified this frame. */
  public getDirtyRows(): number {
    if (this.totalDraws === 0) return 0;
    const totalTexels = this.totalDraws * TEXELS_PER_DRAW;
    return Math.ceil(totalTexels / DRAW_DATA_TEX_WIDTH);
  }

  private ensureCapacity(requiredDraws: number): void {
    if (requiredDraws > this.counts.length) {
      let nextLen = this.counts.length;
      while (nextLen < requiredDraws) nextLen *= 2;
      const nextCounts = new Int32Array(nextLen);
      nextCounts.set(this.counts);
      this.counts = nextCounts;
      const nextOffsets = new Int32Array(nextLen);
      nextOffsets.set(this.offsets);
      this.offsets = nextOffsets;
    }
    const requiredTexels = requiredDraws * TEXELS_PER_DRAW;
    const capacityTexels = DRAW_DATA_TEX_WIDTH * this.texHeight;
    if (requiredTexels > capacityTexels) {
      let nextHeight = this.texHeight;
      while (DRAW_DATA_TEX_WIDTH * nextHeight < requiredTexels) nextHeight *= 2;
      const nextData = new Float32Array(DRAW_DATA_TEX_WIDTH * nextHeight * FLOATS_PER_TEXEL);
      nextData.set(this.drawData);
      this.drawData = nextData;
      this.texHeight = nextHeight;
    }
  }

  private writeDrawEntry(drawIndex: number, entry: BatchSectionEntry): void {
    this.writeDrawValues(
      drawIndex,
      entry.indexCount,
      entry.indexByteOffset,
      entry.originX,
      entry.originY,
      entry.originZ,
      entry.fade,
      entry.tintSlot,
    );
  }

  private writeDrawValues(
    drawIndex: number,
    indexCount: number,
    indexByteOffset: number,
    originX: number,
    originY: number,
    originZ: number,
    fade: number,
    tintSlot: number,
  ): void {
    this.counts[drawIndex] = indexCount;
    this.offsets[drawIndex] = indexByteOffset;
    const base = drawIndex * FLOATS_PER_DRAW;
    // Texel 0: (originX, originY, originZ, fade)
    this.drawData[base] = originX;
    this.drawData[base + 1] = originY;
    this.drawData[base + 2] = originZ;
    this.drawData[base + 3] = fade;
    // Texel 1: (tintSlot, 0, 0, 0)
    this.drawData[base + 4] = tintSlot;
    this.drawData[base + 5] = 0;
    this.drawData[base + 6] = 0;
    this.drawData[base + 7] = 0;
  }

  private pushCommand(
    pass: 0 | 1 | 2,
    variant: number,
    pageId: number,
    drawBase: number,
    drawCount: number,
  ): void {
    const pool = this.commandPools[pass]!;
    const idx = this.commandCounts[pass];
    if (idx < pool.length) {
      const cmd = pool[idx]!;
      cmd.variant = variant;
      cmd.pageId = pageId;
      cmd.drawBase = drawBase;
      cmd.drawCount = drawCount;
      cmd.countsOffset = drawBase;
      cmd.offsetsOffset = drawBase;
    } else {
      pool.push({
        variant,
        pageId,
        drawBase,
        drawCount,
        countsOffset: drawBase,
        offsetsOffset: drawBase,
      });
    }
    this.commandCounts[pass] = idx + 1;
  }
}

/**
 * Computes the (x, y) texel coordinate in the `DRAW_DATA_TEX_WIDTH`-wide data texture
 * for a given `drawBase`, `drawId`, and `texelOffset` (0 or 1).
 */
export function drawDataTexelCoords(
  drawBase: number,
  drawId: number,
  texelOffset: 0 | 1,
): [number, number] {
  const texelIndex = (drawBase + drawId) * TEXELS_PER_DRAW + texelOffset;
  return [texelIndex & (DRAW_DATA_TEX_WIDTH - 1), texelIndex >> 10];
}

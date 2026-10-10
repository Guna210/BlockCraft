/**
 * Dither-dissolve fade-in of terrain columns (decisions/M04b-fade-and-memory.md). A column fades in
 * from the upload of its first section mesh, for FADE_IN_MS of wall-clock time. Re-meshing a column
 * that is already on the GPU does not fade it again; a column whose section meshes were all freed
 * fades again when it comes back.
 */
import { columnKey } from '../world/streaming-plan';

/** Length of a column's fade-in, in wall-clock milliseconds. */
export const FADE_IN_MS = 400;

/** Fraction of a column drawn `elapsedMs` after its fade started: 0 at the start, 1 from FADE_IN_MS on. */
export function fadeAmount(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= FADE_IN_MS) return 1;
  return elapsedMs / FADE_IN_MS;
}

/**
 * When a section uploaded now starts its column's fade. While a createWorld or a region request is
 * pending nothing is shown yet, so its sections appear at full opacity (null).
 */
export function fadeStartFor(loadPending: boolean, nowMs: number): number | null {
  return loadPending ? null : nowMs;
}

/** Remembers the last value written to a uniform, so an unchanged value is not written again. */
export class UniformValueCache {
  private last = Number.NaN;

  constructor(private readonly write: (value: number) => void) {}

  set(value: number): void {
    if (value === this.last) return;
    this.write(value);
    this.last = value;
  }

  /** The next set() writes, whatever the value: the uniform may have been changed elsewhere. */
  forget(): void {
    this.last = Number.NaN;
  }
}

/** Fade state of the columns that have section meshes on the GPU. Keys are the streamer's column keys. */
export class ColumnFades {
  private readonly starts = new Map<number, number>();

  /**
   * A section mesh of column (cx, cz) was uploaded. `hadSections` says whether the column had section
   * meshes on the GPU before this upload; only the first upload of a column can start a fade.
   * `fadeFromMs` is the time the fade starts, or null to show the column at once.
   */
  onUpload(cx: number, cz: number, hadSections: boolean, fadeFromMs: number | null): void {
    if (hadSections) return;
    const key = columnKey(cx, cz);
    if (fadeFromMs === null) this.starts.delete(key);
    else this.starts.set(key, fadeFromMs);
  }

  /** The column has no section meshes on the GPU any more: its fade, if any, is forgotten. */
  onEmptied(cx: number, cz: number): void {
    this.starts.delete(columnKey(cx, cz));
  }

  clear(): void {
    this.starts.clear();
  }

  /** Fraction (0..1) of column (cx, cz) that is drawn at `nowMs`. */
  amount(cx: number, cz: number, nowMs: number): number {
    const start = this.starts.get(columnKey(cx, cz));
    return start === undefined ? 1 : fadeAmount(nowMs - start);
  }

  /** Columns whose fade has not finished at `nowMs`. */
  fadingColumns(nowMs: number): number {
    let n = 0;
    for (const start of this.starts.values()) {
      if (nowMs - start < FADE_IN_MS) n++;
    }
    return n;
  }

  /** Columns with a fade on record, finished or not. */
  get size(): number {
    return this.starts.size;
  }
}

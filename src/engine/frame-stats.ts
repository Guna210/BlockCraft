/**
 * Per-frame timings collected since the last reset, for the debug API (getFrameStats). The frame
 * loop records one sample per frame: the frame callback's main-thread time, the part of it spent
 * uploading meshes, and the time the debug WebGL error check took (outside the callback's timer).
 * Streaming tasks that run between frames are recorded one by one as pump samples.
 */

export interface FrameStatsSnapshot {
  frames: number;
  frameCpuMsP95: number;
  frameCpuMsMax: number;
  uploadMsP95: number;
  uploadMsMax: number;
  glCheckMsP95: number;
  glCheckMsMax: number;
  /** Streaming tasks outside the frame callback (pump slices, worker-result handlers). */
  pumpMsP95: number;
  pumpMsMax: number;
}

/** Oldest samples are dropped beyond this many frames (an hour at 60 fps is 216000). */
const MAX_SAMPLES = 100_000;

export function percentile95(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  const sorted = Array.from(samples).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function max(samples: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i]! > m) m = samples[i]!;
  return m;
}

export class FrameStats {
  private frameCpu: number[] = [];
  private upload: number[] = [];
  private glCheck: number[] = [];
  private pump: number[] = [];
  private readonly recentFrames = new Array<number>(120);
  private recentFrameCount = 0;
  private nextRecentFrame = 0;

  reset(): void {
    this.pump = [];
    this.frameCpu = [];
    this.upload = [];
    this.glCheck = [];
    this.recentFrameCount = 0;
    this.nextRecentFrame = 0;
  }

  record(frameCpuMs: number, uploadMs: number, glCheckMs: number): void {
    if (this.frameCpu.length >= MAX_SAMPLES) {
      const drop = MAX_SAMPLES / 2;
      this.frameCpu.splice(0, drop);
      this.upload.splice(0, drop);
      this.glCheck.splice(0, drop);
    }
    this.frameCpu.push(frameCpuMs);
    this.upload.push(uploadMs);
    this.glCheck.push(glCheckMs);
    this.recentFrames[this.nextRecentFrame] = frameCpuMs;
    this.nextRecentFrame = (this.nextRecentFrame + 1) % this.recentFrames.length;
    this.recentFrameCount = Math.min(this.recentFrames.length, this.recentFrameCount + 1);
  }

  /** A copy of the latest frame CPU samples for small diagnostic graphs. */
  recentFrameTimes(limit = 120): number[] {
    if (!Number.isInteger(limit) || limit < 0)
      throw new Error('Frame history limit must be non-negative');
    const count = Math.min(limit, this.recentFrameCount);
    const first =
      (this.nextRecentFrame - count + this.recentFrames.length) % this.recentFrames.length;
    return Array.from(
      { length: count },
      (_, i) => this.recentFrames[(first + i) % this.recentFrames.length]!,
    );
  }

  /** One streaming task outside the frame callback: its main-thread time. */
  recordPump(ms: number): void {
    if (this.pump.length >= MAX_SAMPLES) this.pump.splice(0, MAX_SAMPLES / 2);
    this.pump.push(ms);
  }

  snapshot(): FrameStatsSnapshot {
    return {
      frames: this.frameCpu.length,
      frameCpuMsP95: percentile95(this.frameCpu),
      frameCpuMsMax: max(this.frameCpu),
      uploadMsP95: percentile95(this.upload),
      uploadMsMax: max(this.upload),
      glCheckMsP95: percentile95(this.glCheck),
      glCheckMsMax: max(this.glCheck),
      pumpMsP95: percentile95(this.pump),
      pumpMsMax: max(this.pump),
    };
  }
}

export const frameStats = new FrameStats();

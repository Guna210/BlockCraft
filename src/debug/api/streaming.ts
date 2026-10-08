import { WorldManager } from '../../world/world-manager';
import { frameStats, type FrameStatsSnapshot } from '../../engine/frame-stats';
import type { StreamingStats } from '../../world/streamer';
import type { ResourceCounts } from '../../render/gl';

/** Sets the render distance in columns (rounded, clamped to 2..32), re-plans at once, returns the value used. */
export function setRenderDistance(n: number): number {
  return WorldManager.getInstance().setRenderDistance(n);
}

export function getStreamingStats(): StreamingStats {
  return WorldManager.getInstance().getStreamingStats();
}

/** Starts a new measurement window for getFrameStats. */
export function resetFrameStats(): void {
  frameStats.reset();
}

/** Frame timings since the last resetFrameStats (or page load). */
export function getFrameStats(): FrameStatsSnapshot {
  return frameStats.snapshot();
}

/** Live WebGL resource counts (buffers, VAOs, textures, shaders). */
export function getGlResourceCounts(): ResourceCounts {
  const gl = WorldManager.getInstance().glWrapper;
  return gl ? gl.getCounts() : { buffers: 0, vaos: 0, textures: 0, shaders: 0 };
}

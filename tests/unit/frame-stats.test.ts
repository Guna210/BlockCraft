import { describe, it, expect } from 'vitest';
import { FrameStats, percentile95 } from '../../src/engine/frame-stats';

describe('FrameStats', () => {
  it('reports percentiles and maxima of frames and pump tasks since the reset', () => {
    const stats = new FrameStats();
    stats.record(99, 99, 99);
    stats.recordPump(99);
    stats.reset();
    for (let i = 1; i <= 100; i++) stats.record(i, i / 10, 0);
    stats.recordPump(4);
    stats.recordPump(12);
    const s = stats.snapshot();
    expect(s.frames).toBe(100);
    expect(s.frameCpuMsMax).toBe(100);
    expect(s.frameCpuMsP95).toBe(96);
    expect(s.uploadMsMax).toBeCloseTo(10);
    expect(s.pumpMsMax).toBe(12);
    expect(s.pumpMsP95).toBe(12);
  });

  it('percentile95 of nothing is zero', () => {
    expect(percentile95([])).toBe(0);
  });
});

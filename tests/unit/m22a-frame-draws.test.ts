import { expect, it } from 'vitest';
import { FrameStats } from '../../src/engine/frame-stats';

it('reports the maximum draw calls in the measurement window', () => {
  const stats = new FrameStats();
  stats.record(1, 0, 0, 9);
  stats.record(1, 0, 0, 17);
  stats.record(1, 0, 0, 12);
  expect(stats.snapshot().drawCallsMax).toBe(17);
  stats.reset();
  expect(stats.snapshot().drawCallsMax).toBe(0);
});

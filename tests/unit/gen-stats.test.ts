import { describe, it, expect, beforeAll } from 'vitest';
import { columnPercentile, sectionPercentile } from '../../src/workers/gen-stats';
import { GenWorkerPool } from '../../src/workers/gen-worker-pool';

describe('M03d-fix — genMsP95 definition', () => {
  it('counts a column once per 16³ section it produced', () => {
    // 10 sections at 1 ms each and 1 section at 5 ms: the slow section is 1 of 11 sections (9 %)
    const samples = [
      { columnMs: 10, sections: 10 },
      { columnMs: 5, sections: 1 },
    ];
    expect(sectionPercentile(samples, 0.9)).toBe(1);
    expect(sectionPercentile(samples, 0.95)).toBe(5);
    // per column, the same data has two columns of 10 ms and 5 ms
    expect(columnPercentile(samples, 0.95)).toBe(10);
  });

  it('is the per-section cost of the slowest columns, not an average that hides them', () => {
    const samples = [];
    for (let i = 0; i < 95; i++) samples.push({ columnMs: 10, sections: 10 }); // 1 ms / section
    for (let i = 0; i < 5; i++) samples.push({ columnMs: 80, sections: 10 }); // 8 ms / section
    expect(sectionPercentile(samples, 0.95)).toBe(1); // exactly 5 % of sections are slow
    samples.push({ columnMs: 80, sections: 10 });
    expect(sectionPercentile(samples, 0.95)).toBe(8); // one more slow column and p95 jumps
  });

  it('returns 0 without samples and never divides by zero sections', () => {
    expect(sectionPercentile([], 0.95)).toBe(0);
    expect(columnPercentile([], 0.95)).toBe(0);
    expect(sectionPercentile([{ columnMs: 3, sections: 0 }], 0.95)).toBe(3);
  });

  describe('GenWorkerPool wiring', () => {
    class MockWorker {
      static queue: { columnMs: number; sectionCount: number }[] = [];
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(data: { id: number; cx: number; cz: number }) {
        const next = MockWorker.queue.shift()!;
        setTimeout(() => {
          this.onmessage?.({
            data: {
              id: data.id,
              cx: data.cx,
              cz: data.cz,
              sections: [],
              biomes: new Uint8Array(256),
              grassTints: new Uint8Array(768),
              foliageTints: new Uint8Array(768),
              columnMs: next.columnMs,
              sectionCount: next.sectionCount,
              perSectionMs: next.columnMs / next.sectionCount,
            },
          } as MessageEvent);
        }, 0);
      }
      terminate() {}
    }

    beforeAll(() => {
      (globalThis as unknown as Record<string, unknown>).Worker = MockWorker;
    });

    it('genMsP95 is the section-weighted p95 of the reported column times', async () => {
      const pool = new GenWorkerPool(1);
      // 19 tall columns at 1 ms / section and 1 short slow column at 9 ms / section
      MockWorker.queue = [];
      for (let i = 0; i < 19; i++) MockWorker.queue.push({ columnMs: 10, sectionCount: 10 });
      MockWorker.queue.push({ columnMs: 9, sectionCount: 1 });
      for (let i = 0; i < 20; i++) await pool.enqueueGenJob(1, i, 0, 'default');

      // 191 sections: the single slow section is 0.5 % of them, so the p95 is the fast cost
      expect(pool.genMsP95).toBe(1);
      // per column the slow one is 1 of 20 columns, and 10 ms is the slowest column time
      expect(pool.genColumnMsP95).toBe(10);
      pool.terminate();
    });
  });
});

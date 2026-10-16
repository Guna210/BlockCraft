import { describe, it, expect } from 'vitest';
import { BlockTicks } from '../../src/world/ticks';
import { World } from '../../src/world/world';
import { TickLoop } from '../../src/engine/loop';

describe('M08a block ticks', () => {
  it('orders due time, priority and insertion deterministically, coalescing notifications', () => {
    const ticks = new BlockTicks(),
      seen: string[] = [];
    const add = (type: string, delay: number, priority: number) =>
      ticks.schedule({ x: 0, y: 5, z: 0, type }, delay, priority);
    add('late', 3, -99);
    add('ordinary', 2, 1);
    add('first', 2, -1);
    add('second', 2, -1);
    add('first', 5, -2);
    ticks.advance((t) => seen.push(t.type));
    expect(seen).toEqual([]);
    ticks.advance((t) => seen.push(t.type));
    expect(seen).toEqual(['first', 'second', 'ordinary']);
    ticks.advance((t) => seen.push(t.type));
    expect(seen).toEqual(['first', 'second', 'ordinary', 'late']);
    expect(ticks.count).toBe(0);
  });
  it('dispatch can reschedule itself; pause and manual ticks use the same 20 TPS path', () => {
    const ticks = new BlockTicks();
    let calls = 0;
    const block = { x: 0, y: 4, z: 0, type: 'test' };
    ticks.schedule(block, 5);
    const loop = new TickLoop(() =>
      ticks.advance((t) => {
        calls++;
        ticks.schedule(t, 5);
      }),
    );
    loop.pause();
    loop.advance(1);
    expect(ticks.time).toBe(0);
    loop.tick(4);
    expect(calls).toBe(0);
    loop.tick(1);
    expect(calls).toBe(1);
    loop.resume();
    loop.advance(0.25);
    expect(calls).toBe(2);
  });
  it('forgets only unloaded-column work, including negative coordinates', () => {
    const ticks = new BlockTicks();
    for (const x of [-17, -1, 0, 16]) ticks.schedule({ x, y: 64, z: 0, type: 'water' }, 1);
    ticks.removeColumn(-1, 0);
    const seen: number[] = [];
    ticks.advance((t) => seen.push(t.x));
    expect(seen).toEqual([-17, 0, 16]);
  });
  it('runs configured random ticks only on simulation steps and only for loaded sections', () => {
    const w = new World(false),
      seen: number[][] = [];
    w.setBlock(-1, 65, 0, 'stone');
    w.setBlock(1, 17, 1, 'stone');
    w.ticks.setRandomTicks(
      () => w.getTickSections(),
      3,
      42,
      (x, y, z) => seen.push([x, y, z]),
    );
    const loop = new TickLoop(() => w.tick());
    loop.pause();
    loop.advance(1);
    expect(seen).toHaveLength(0);
    loop.tick(1);
    expect(seen).toHaveLength(6);
    w.removeColumn(-1, 0);
    loop.tick(1);
    expect(seen).toHaveLength(9);
    expect(
      seen
        .slice(6)
        .every(([x, y, z]) => x! >= 0 && x! < 16 && y! >= 16 && y! < 32 && z! >= 0 && z! < 16),
    ).toBe(true);
  });
  it('samples N blocks per section per tick, seeded and independent of section iteration order', () => {
    const ticks = new BlockTicks(),
      sections = [
        { x: -2, y: 3, z: 1 },
        { x: 0, y: 0, z: 0 },
      ];
    const sample = (seed: number, reverse = false) => {
      const seen: number[][] = [];
      ticks.random(reverse ? [...sections].reverse() : sections, 12, seed, (x, y, z) =>
        seen.push([x, y, z]),
      );
      return seen;
    };
    const a = sample(42);
    expect(a).toHaveLength(24);
    expect(
      a
        .slice(0, 12)
        .every(([x, y, z]) => x! >= -32 && x! < -16 && y! >= 48 && y! < 64 && z! >= 16 && z! < 32),
    ).toBe(true);
    expect(sample(42)).toEqual(a);
    expect(sample(42, true)).toEqual([...a.slice(12), ...a.slice(0, 12)]);
    expect(sample(43)).not.toEqual(a);
    ticks.advance(() => {});
    expect(sample(42)).not.toEqual(a);
  });
});

import { describe, expect, it } from 'vitest';
import { BufferArenaAllocator } from '../../src/render/buffer-arena-allocator';

describe('buffer arena allocator', () => {
  it('honours alignment and reuses coalesced ranges', () => {
    const arena = new BufferArenaAllocator(64);
    const a = arena.allocate(7)!;
    const b = arena.allocate(16, 16)!;
    const c = arena.allocate(32)!;
    expect([a.offset, b.offset, c.offset]).toEqual([0, 16, 32]);
    expect(arena.allocate(12)).toBeNull();
    arena.free(b);
    arena.free(a);
    arena.free(c);
    expect(arena.allocate(64)).toEqual({ offset: 0, length: 64 });
  });
  it('rejects invalid and overlapping frees', () => {
    const arena = new BufferArenaAllocator(32);
    const a = arena.allocate(8)!;
    arena.free(a);
    expect(() => arena.free(a)).toThrow();
    expect(() => arena.free({ offset: 30, length: 4 })).toThrow();
  });
});

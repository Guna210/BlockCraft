import { describe, expect, it, vi } from 'vitest';
import {
  completeCommand,
  FILL_CAP,
  fillBounds,
  numberArgument,
  parseCommand,
  resolveSelector,
  type CompletionCatalog,
} from '../../src/game/commands/parser';
import { executeCommand, type CommandContext } from '../../src/game/commands';

const catalog: CompletionCatalog = {
  items: ['iron_ingot', 'glass'],
  blocks: ['glass', 'stone'],
  entities: ['tuftbuck', 'item:glass'],
  structures: ['wayfarer_hamlet'],
  ores: ['iron_ore'],
};
function context(): CommandContext {
  return {
    position: () => [1, 65, 2],
    teleport: vi.fn(),
    give: vi.fn(() => true),
    setTime: vi.fn(),
    setWeather: vi.fn(),
    setMode: vi.fn(),
    seed: () => 'abc',
    hasItem: (id) => catalog.items.includes(id),
    hasBlock: (id) => catalog.blocks.includes(id),
    fill: vi.fn(async () => {}),
    locate: vi.fn(async () => [10, 20, 30] as [number, number, number]),
    summon: vi.fn(),
  };
}

describe('M18c command parsing and selectors', () => {
  it('parses surrounding whitespace and rejects absent names and noncommands', () => {
    expect(parseCommand('  /give  @s iron_ingot 5  ')).toEqual({
      name: 'give',
      args: ['@s', 'iron_ingot', '5'],
    });
    expect(() => parseCommand('/')).toThrow('name');
    expect(() => parseCommand('hi')).toThrow('start with /');
    for (const value of ['NaN', 'Infinity', '0x10', '1e300', '12x', ''])
      expect(() => numberArgument(value, 'X')).toThrow();
    expect(numberArgument('-12.5', 'X')).toBe(-12.5);
  });
  it('resolves both local selectors and rejects other targets', () => {
    expect(resolveSelector('@s')).toBe('player');
    expect(resolveSelector('@p')).toBe('player');
    for (const target of ['@a', '@e', 'someone', ''])
      expect(() => resolveSelector(target)).toThrow('selector');
  });
  it('completes command names, selectors, items, entities, structures, ores and later arguments', () => {
    expect(completeCommand('/g', catalog)).toEqual(['/gamemode', '/give']);
    expect(completeCommand('/give ', catalog)).toEqual(['/give @p', '/give @s']);
    expect(completeCommand('/give @s ir', catalog)).toEqual(['/give @s iron_ingot']);
    expect(completeCommand('/summon tu', catalog)).toEqual(['/summon tuftbuck']);
    expect(completeCommand('/summon item:g', catalog)).toEqual(['/summon item:glass']);
    expect(completeCommand('/locate structure w', catalog)).toEqual([
      '/locate structure wayfarer_hamlet',
    ]);
    expect(completeCommand('/locate ore ir', catalog)).toEqual(['/locate ore iron_ore']);
    expect(completeCommand('/fill 0 0 0 1 1 1 st', catalog)).toEqual(['/fill 0 0 0 1 1 1 stone']);
    expect(completeCommand('/time set n', catalog)).toEqual(['/time set night', '/time set noon']);
    expect(completeCommand('/weather rain extra', catalog)).toEqual([]);
    expect(completeCommand('hello', catalog)).toEqual([]);
  });
  it('caps the inclusive fill volume before calling the world, including reversed bounds', async () => {
    expect(fillBounds([15, 15, 15], [0, 0, 0])).toEqual({
      min: [0, 0, 0],
      max: [15, 15, 15],
      volume: FILL_CAP,
    });
    expect(() => fillBounds([0, 0, 0], [16, 15, 15])).toThrow('4096 block cap');
    expect(() => fillBounds([0, -1, 0], [1, 1, 1])).toThrow('Y');
    expect(() => fillBounds([0.1, 0, 0], [1, 1, 1])).toThrow('whole');
    const ctx = context();
    expect(await executeCommand('/fill 0 0 0 16 15 15 stone', ctx)).toMatchObject({
      error: true,
      text: expect.stringContaining('cap'),
    });
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(await executeCommand('/fill 1 1 1 0 0 0 stone', ctx)).toMatchObject({ error: false });
    expect(ctx.fill).toHaveBeenCalledWith([0, 0, 0], [1, 1, 1], 'stone');
  });
  it('routes all commands through the context and uses local selectors', async () => {
    const ctx = context();
    for (const line of [
      '/give @s iron_ingot 5',
      '/tp @p 100 120 100',
      '/time set noon',
      '/weather thunder',
      '/gamemode creative @s',
      '/seed',
      '/locate ore iron_ore',
      '/summon tuftbuck',
      '/summon item:glass 1 2 3',
    ])
      expect((await executeCommand(line, ctx)).error).toBe(false);
    expect(ctx.give).toHaveBeenCalledWith('iron_ingot', 5);
    expect(ctx.teleport).toHaveBeenCalledWith([100, 120, 100]);
    expect(ctx.setTime).toHaveBeenCalledWith(6000);
    expect(ctx.setWeather).toHaveBeenCalledWith('thunder');
    expect(ctx.setMode).toHaveBeenCalledWith('creative');
    expect(ctx.summon).toHaveBeenCalledWith('tuftbuck', [1, 65, 2]);
    expect(ctx.summon).toHaveBeenCalledWith('item:glass', [1, 2, 3]);
  });
  it('turns unknown commands, bad arguments and system failures into errors without throwing', async () => {
    const ctx = context();
    for (const line of [
      '/unknown',
      '/give @e iron_ingot 5',
      '/give @s bad 5',
      '/give @s glass -1',
      '/give @s glass 1.5',
      '/tp 1 NaN 3',
      '/tp 1 2',
      '/weather snow',
      '/gamemode bad',
      '/seed extra',
      '/time add 5',
      '/fill 0 0 0 1 1 1 bad',
      '/summon tuftbuck 1',
      '/locate biome plains',
    ])
      expect((await executeCommand(line, ctx)).error).toBe(true);
    ctx.give = () => false;
    expect(await executeCommand('/give @p glass 1', ctx)).toEqual({
      error: true,
      text: 'Inventory is full',
    });
    ctx.summon = () => {
      throw new Error('Unknown entity type: test');
    };
    expect(await executeCommand('/summon test', ctx)).toEqual({
      error: true,
      text: 'Unknown entity type: test',
    });
  });
});

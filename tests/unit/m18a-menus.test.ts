import { describe, expect, test } from 'vitest';
import splashes from '../../data/splashes.json';
import { LOGO_PALETTE, renderLogo } from '../../src/ui/logo';
import { hasGlyph, textWidth } from '../../src/ui/pixel-font';
import { randomSeedString } from '../../src/ui/world-list-screen';
import { placeStartingChest, STARTING_CHEST_ITEMS } from '../../src/gameplay/starting-chest';
import { chestStorageAt } from '../../src/gameplay/chests';
import { items } from '../../src/gameplay/items';
import { World } from '../../src/world/world';

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('M18a logo', () => {
  test('every logo pixel is from its declared palette of at most 12 colours, with real contrast', () => {
    const logo = renderLogo();
    const palette = Object.values(LOGO_PALETTE);
    expect(palette.length).toBeLessThanOrEqual(12);
    const allowed = new Set(palette.map((hex) => hex.slice(1).toLowerCase()));
    const used = new Set<string>();
    let drawn = 0;
    for (let i = 0; i < logo.data.length; i += 4) {
      const alpha = logo.data[i + 3]!;
      expect(alpha === 0 || alpha === 255).toBe(true);
      if (alpha === 0) continue;
      drawn++;
      const hex = [logo.data[i]!, logo.data[i + 1]!, logo.data[i + 2]!]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      expect(allowed.has(hex)).toBe(true);
      used.add(hex);
    }
    // The word fills a good share of its box, and stone, grass and extrusion all appear.
    expect(drawn / (logo.width * logo.height)).toBeGreaterThan(0.35);
    expect(used.size).toBeGreaterThanOrEqual(8);
    const lum = [...used].map((hex) => {
      const n = parseInt(hex, 16);
      return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
    });
    expect(Math.max(...lum) - Math.min(...lum)).toBeGreaterThanOrEqual(60);
  });

  test('the logo is ten letters wide and fits the 320 px UI', () => {
    const logo = renderLogo();
    expect(logo.width).toBeLessThanOrEqual(320);
    expect(logo.width).toBeGreaterThan(200);
    expect(logo.height).toBeGreaterThan(28);
  });
});

describe('M18a splashes', () => {
  test('at least 20 distinct original lines that the pixel font can draw', () => {
    const lines = splashes as string[];
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) {
      for (const char of line) expect(hasGlyph(char), `${line}: '${char}'`).toBe(true);
      // Rotated at −20° beside the logo, a line must stay inside a 426 px wide frame.
      expect(textWidth(line)).toBeLessThanOrEqual(200);
    }
  });
});

describe('M18a Create World', () => {
  test('an empty seed field gets a random twelve-digit seed string', () => {
    const seed = randomSeedString();
    expect(seed).toMatch(/^[1-9]\d{11}$/);
    expect(randomSeedString(() => 0)).toBe('100000000000');
    expect(randomSeedString()).not.toBe(randomSeedString());
  });

  test('the starting chest stands next to the spawn and holds the starting items', () => {
    const world = new World();
    world.getColumn(0, 0, true);
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) world.setBlock(x, 64, z, 'grass_block');
    const at = placeStartingChest(world, {
      x: 1,
      z: 1,
      topY: 64,
      position: [1.5, 66.82, 1.5],
      fallback: false,
    });
    expect(at).toEqual({ x: 2, y: 65, z: 1 });
    expect(world.getBlock(2, 65, 1)).toEqual({
      id: 'chest',
      state: { facing: 'west', pair: 'single' },
    });
    const storage = chestStorageAt(world, 2, 65, 1)!;
    const contents = storage.halves[0]!.slots.filter((slot) => slot !== null);
    expect(contents).toEqual([
      { id: 'oak_log', count: 8 },
      { id: 'bread', count: 4 },
      { id: 'wooden_pickaxe', count: 1 },
      { id: 'wooden_axe', count: 1 },
      { id: 'torch', count: 16 },
    ]);
    for (const stack of STARTING_CHEST_ITEMS) expect(items.get(stack.id)).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import { items } from '../../src/gameplay/items';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { TextureAtlas } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures/index';
import { createSentinelTile, SENTINEL_KEY } from '../../src/render/texture-resolve';
import { buildIconSheet, createTileLookup, ICON_SIZE } from '../../src/ui/icons';
import type { TextureData } from '../../src/render/textures/noise';

// The same tile set the game builds in WorldManager.initGL.
function buildSheet() {
  const tiles = new Map<string, TextureData>();
  for (const [name, generate] of Object.entries(textureGenerators)) {
    const result = generate(42);
    if (Array.isArray(result)) result.forEach((frame, i) => tiles.set(`${name}_${i}`, frame));
    else tiles.set(name, result);
  }
  tiles.set(SENTINEL_KEY, createSentinelTile());
  const missing: string[] = [];
  const sheet = buildIconSheet(
    createTileLookup(new TextureAtlas(tiles)),
    createSentinelTile(),
    (name) => missing.push(name),
  );
  return { sheet, missing };
}

const { sheet, missing } = buildSheet();

function pixel(id: string, x: number, y: number): number[] {
  const rect = sheet.rects.get(id)!;
  const i = ((rect.y + y) * sheet.width + rect.x + x) * 4;
  return [...sheet.data.subarray(i, i + 4)];
}
const luminance = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
function meanLuminance(id: string, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = pixel(id, x, y);
      if (p[3] === 0) continue;
      sum += luminance(p);
      n++;
    }
  return sum / n;
}
function opaqueCount(id: string): number {
  let n = 0;
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) if (pixel(id, x, y)[3]! > 0) n++;
  return n;
}

describe('M09b icon sheet', () => {
  it('has an icon for every registry item and block, with no missing textures', () => {
    expect(missing).toEqual([]);
    for (const item of items.items.values()) {
      expect(sheet.rects.has(item.id), item.id).toBe(true);
      if (item.block) expect(sheet.rects.has(item.block), item.block).toBe(true);
    }
    const registry = BlockRegistry.getInstance();
    for (const stateId of registry.getAllStateIds()) {
      const block = registry.getResolvedState(stateId)!.blockId;
      expect(sheet.rects.has(block), block).toBe(true);
    }
  });

  it('draws something for every item except air', () => {
    for (const item of items.items.values())
      if (item.id !== 'air') expect(opaqueCount(item.id), item.id).toBeGreaterThanOrEqual(24);
    expect(opaqueCount('air')).toBe(0);
  });

  it('includes ice, snow_layer, fire and blackglass', () => {
    for (const id of ['ice', 'snow_layer', 'fire', 'blackglass'])
      expect(opaqueCount(id), id).toBeGreaterThanOrEqual(24);
  });

  it('never uses the magenta missing-texture color', () => {
    for (let i = 0; i < sheet.data.length; i += 4)
      if (sheet.data[i + 3]! > 0)
        expect(sheet.data[i] === 255 && sheet.data[i + 1] === 0 && sheet.data[i + 2] === 255).toBe(
          false,
        );
  });

  it('shades the three visible faces of full cubes, with the top lightest', () => {
    for (const id of ['stone', 'dirt', 'oak_planks', 'sand', 'cobblestone', 'gravel', 'iron_ore']) {
      const top = meanLuminance(id, 6, 3, 9, 4);
      const left = meanLuminance(id, 2, 8, 5, 11);
      const right = meanLuminance(id, 10, 8, 13, 11);
      expect(top, `${id} top`).toBeGreaterThan(left);
      expect(left, `${id} left`).toBeGreaterThan(right);
    }
  });

  it('tints grass and leaves with the plains colors', () => {
    const grassTop = pixel('grass_block', 8, 3);
    expect(grassTop[1]).toBeGreaterThan(grassTop[0]!);
    expect(grassTop[1]).toBeGreaterThan(grassTop[2]!);
    const leaves = pixel('oak_leaves', 8, 3);
    expect(leaves[1]).toBeGreaterThan(leaves[0]!);
  });

  it('draws plants and torches as flat sprites and snow_layer as a short slab', () => {
    // A flat sprite leaves the bottom corners empty; a cube fills them.
    expect(pixel('torch', 0, 15)[3]).toBe(0);
    expect(pixel('stone', 0, 8)[3]).toBe(255);
    expect(opaqueCount('snow_layer')).toBeLessThan(opaqueCount('stone'));
    expect(opaqueCount('snow_layer')).toBeGreaterThan(opaqueCount('stone') / 2.5);
    // The slab's top is lower than a cube's: the top row is empty.
    expect(pixel('snow_layer', 8, 0)[3]).toBe(0);
  });

  it('gives flat items a dark outline and is deterministic', () => {
    // The pickaxe sprite's first opaque pixel in the outline color.
    const dark = [21, 18, 31, 255];
    let outlined = 0;
    for (let y = 0; y < ICON_SIZE; y++)
      for (let x = 0; x < ICON_SIZE; x++)
        if (pixel('iron_pickaxe', x, y).join() === dark.join()) outlined++;
    expect(outlined).toBeGreaterThan(8);
    expect(buildSheet().sheet.data).toEqual(sheet.data);
  });

  it('sheet is a grid that holds every item without overlap', () => {
    const seen = new Set<string>();
    for (const item of items.items.values()) {
      const r = sheet.rects.get(item.id)!;
      expect(r.x % ICON_SIZE).toBe(0);
      expect(r.y % ICON_SIZE).toBe(0);
      expect(r.x + ICON_SIZE).toBeLessThanOrEqual(sheet.width);
      expect(r.y + ICON_SIZE).toBeLessThanOrEqual(sheet.height);
      seen.add(`${r.x},${r.y}`);
    }
    expect(seen.size).toBe(items.items.size);
  });
});

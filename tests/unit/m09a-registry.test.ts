import {
  inventoryItemGenerators,
  inventoryItemPalettes,
} from '../../src/render/textures/inventory-items';
import { expect, it } from 'vitest';
import { items } from '../../src/gameplay/items';
import { blockLoot } from '../../src/gameplay/loot';
import { textureGenerators, texturePalettes } from '../../src/render/textures';
import { BlockRegistry } from '../../src/world/blocks/registry';

it('M09a all block items, five A.2 tool tiers, shears and special tools are registered', () => {
  for (const id of BlockRegistry.getInstance().getAllBlockIds())
    expect(items.get(id).block).toBe(id);
  for (const [tier, level, speed] of [
    ['wooden', 0, 2],
    ['stone', 1, 4],
    ['copper', 2, 5],
    ['iron', 3, 6],
    ['skyshard', 4, 9],
  ] as const)
    for (const type of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'])
      expect(items.get(`${tier}_${type}`)).toMatchObject({
        maxStack: 1,
        tool: { type, tier: level, speed },
      });
  expect(items.get('iron_shears')).toMatchObject({
    maxStack: 1,
    tool: { type: 'shears', tier: 3, speed: 6 },
  });
  for (const id of ['bow', 'shield', 'ember_flint']) expect(items.get(id).maxStack).toBe(1);
});
it('M09a metal armor is data only, unstackable, and has the matching equipment slot', () => {
  for (const tier of ['copper', 'iron'])
    for (const [piece, slot] of [
      ['helmet', 'head'],
      ['chestplate', 'chest'],
      ['leggings', 'legs'],
      ['boots', 'feet'],
    ]) {
      const item = items.get(`${tier}_${piece}`);
      expect(item).toMatchObject({ kind: 'armor', armorSlot: slot, maxStack: 1 });
      expect(item).not.toHaveProperty('defense');
      expect(item).not.toHaveProperty('durability');
    }
});
it('M09a A.4 resources, A.2 ingots and appendix materials are available with bounded stacks', () => {
  for (const id of 'coal raw_copper raw_iron raw_gold lumite_shard skyshard_crystal copper_ingot iron_ingot flint bowl wheat clay_lump stick wool tuber egg feather shell_plate bark_strips thorn silk carapace spore_powder luminous_membrane emberite_scale seed'.split(
    ' ',
  ))
    expect(items.get(id)).toMatchObject({ kind: 'material', maxStack: 64 });
  for (const item of items.items.values()) {
    expect([1, 16, 64]).toContain(item.maxStack);
    if (item.kind === 'tool' || item.kind === 'armor') expect(item.maxStack).toBe(1);
  }
});
it('M09a all A.5 foods exactly match hunger/saturation without eating behavior', () => {
  const foods = [
    ['wild_berries', 2, 0.4],
    ['apple', 4, 2.4],
    ['bread', 5, 6],
    ['raw_tuftbuck_shank', 2, 1.2],
    ['roast_tuftbuck_shank', 6, 9.6],
    ['raw_boar_chop', 3, 1.8],
    ['roast_boar_chop', 8, 12.8],
    ['raw_fowl', 2, 1.2],
    ['roast_fowl', 6, 7.2],
    ['baked_tuber', 5, 6],
    ['mushroom_broth', 6, 7.2],
    ['glowcap_stew', 7, 8],
  ] as const;
  expect([...items.items.values()].filter((i) => i.kind === 'food')).toHaveLength(foods.length);
  for (const [id, hunger, saturation] of foods)
    expect(items.get(id)).toMatchObject({ kind: 'food', hunger, saturation });
});
it('M09a wall torch drops torch, clay four lumps; snow and packed ice self-drop; glass yields nothing', () => {
  expect(blockLoot('wall_torch')).toEqual([{ id: 'torch', count: 1 }]);
  expect(blockLoot('clay')).toEqual([{ id: 'clay_lump', count: 4 }]);
  for (const id of ['snow', 'packed_ice']) expect(blockLoot(id)).toEqual([{ id, count: 1 }]);
  for (const id of BlockRegistry.getInstance()
    .getAllBlockIds()
    .filter((id) => id === 'glass' || id.startsWith('stained_glass')))
    expect(blockLoot(id)).toEqual([]);
});
it('M09a every nonblock resolves to a deterministic world sprite with a limited declared palette', () => {
  for (const item of items.items.values())
    if (!item.block) {
      const generate = textureGenerators[item.texture!] ?? inventoryItemGenerators[item.texture!];
      expect(generate, item.id).toBeDefined();
      const pixels = generate!() as Uint8Array;
      expect(generate!()).toEqual(pixels);
      expect(generate!(42), item.id).not.toEqual(generate!(1337));
      expect(generate!(12345), item.id).not.toEqual(generate!(99999));
      const palette = (texturePalettes[item.texture!] ?? inventoryItemPalettes[item.texture!])!;
      expect(palette.length).toBeLessThanOrEqual(12);
      const colors = new Set(palette.map((c) => c.join(',')));
      let min = 255,
        max = 0,
        count = 0;
      for (let n = 0; n < pixels.length; n += 4) {
        expect(colors.has([...pixels.slice(n, n + 4)].join(',')), item.id).toBe(true);
        if (pixels[n + 3]) {
          const light = 0.2126 * pixels[n]! + 0.7152 * pixels[n + 1]! + 0.0722 * pixels[n + 2]!;
          min = Math.min(min, light);
          max = Math.max(max, light);
          count++;
        }
      }
      expect(max - min, item.id).toBeGreaterThanOrEqual(60);
      expect(count, item.id).toBeGreaterThan(20);
    }
});

it('M09a saves the world-sprite art review sheet in registry order', async () => {
  const { PNG } = await import('pngjs');
  const fs = await import('node:fs');
  const entries = [...items.items.values()].filter((item) => !item.block);
  const cell = 200,
    cols = 8;
  const png = new PNG({ width: cols * cell, height: Math.ceil(entries.length / cols) * cell });
  for (let n = 0; n < png.data.length; n += 4) {
    png.data[n] = png.data[n + 1] = png.data[n + 2] = 50;
    png.data[n + 3] = 255;
  }
  for (let i = 0; i < entries.length; i++) {
    const pixels = (textureGenerators[entries[i]!.texture!] ??
      inventoryItemGenerators[entries[i]!.texture!])!() as Uint8Array;
    for (let y = 0; y < 192; y++)
      for (let x = 0; x < 192; x++) {
        const src = ((Math.floor(y / 4) % 16) * 16 + (Math.floor(x / 4) % 16)) * 4;
        const dst = ((Math.floor(i / cols) * cell + y) * png.width + (i % cols) * cell + x) * 4;
        if (pixels[src + 3]) for (let c = 0; c < 4; c++) png.data[dst + c] = pixels[src + c]!;
      }
  }
  fs.mkdirSync('artifacts/M09a', { recursive: true });
  fs.writeFileSync('artifacts/M09a/m09a-world-sprites.png', PNG.sync.write(png));
  fs.writeFileSync('artifacts/M09a/sprite-order.txt', entries.map((i) => i.id).join('\n') + '\n');
});

it('M09a world-item colors stay distinct from noon sky under their actual untinted and unfogged lighting', async () => {
  const { PNG } = await import('pngjs');
  const { isSkyPixel } = await import('../e2e/helpers/sky-holes');
  const colors = new Set<string>();
  for (const generate of Object.values(inventoryItemGenerators)) {
    const data = generate(42);
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  const png = new PNG({ width: 1, height: 1 });
  png.data[3] = 255;
  const collisions: string[] = [];
  for (const color of colors) {
    const rgb = color.split(',').map(Number);
    for (let light = 0; light <= 255; light++) {
      for (let channel = 0; channel < 3; channel++)
        png.data[channel] = Math.round((rgb[channel]! * light) / 255);
      if (isSkyPixel(png, 0, 0)) collisions.push(`${color} at light ${light}`);
    }
  }
  expect(collisions).toEqual([]);
});

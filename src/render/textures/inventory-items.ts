import { items } from '../../gameplay/items';
import { createEmptyTexture, hexToRgb, setPixel, type RGBA } from './noise';

// World-drop sprites. Inventory icons and UI remain owned by M09b.
const ramps = {
  copper: ['#392b38', '#935037', '#cb8850', '#f0cf8d'],
  iron: ['#343340', '#727f90', '#adb6bd', '#eee1ca'],
  gold: ['#4e3540', '#a16c24', '#e4b535', '#fff0a0'],
  crystal: ['#302047', '#644188', '#9d6ecc', '#edccfa'],
  lumite: ['#173848', '#267b90', '#48bacc', '#c6f5e0'],
  food: ['#402a39', '#914d39', '#ca8b53', '#f0d39c'],
  plant: ['#233e38', '#4f7550', '#91b361', '#e5dc9a'],
  wood: ['#30271e', '#65503b', '#9b7948', '#d8b978'],
  dark: ['#202035', '#4b4c60', '#86879a', '#d1c9b4'],
  raw: ['#432738', '#9c4650', '#d87c79', '#f4c7a4'],
  fruit: ['#422639', '#993d4b', '#d16a63', '#f5bf92'],
  cream: ['#443645', '#8e7c70', '#c4b493', '#f9ebc6'],
  clay: ['#433040', '#956650', '#c69a75', '#f1d5ad'],
};
const special: Record<string, string[]> = {
  apple: ramps.fruit,
  wild_berries: ramps.fruit,
  egg: ramps.cream,
  wool: ramps.cream,
  silk: ramps.cream,
  feather: ramps.cream,
  clay_lump: ramps.clay,
  bread: ramps.cream,
  shell_plate: ramps.iron,
  spore_powder: ramps.plant,
  emberite_scale: ramps.raw,
};
export const inventoryItemGenerators: Record<string, (seed?: number) => Uint8Array> = {};
export const inventoryItemPalettes: Record<string, RGBA[]> = {};
for (const item of items.items.values()) {
  if (item.block || item.tool || !item.texture) continue;
  const id = item.id;
  const colors =
    special[id] ??
    (item.kind === 'food' && id.startsWith('raw_')
      ? ramps.raw
      : id.includes('copper')
        ? ramps.copper
        : id.includes('iron')
          ? ramps.iron
          : id.includes('gold')
            ? ramps.gold
            : id.includes('skyshard')
              ? ramps.crystal
              : id.includes('lum') || id.includes('glowcap')
                ? ramps.lumite
                : item.kind === 'food'
                  ? ramps.food
                  : ['wheat', 'seed', 'thorn', 'tuber'].includes(id)
                    ? ramps.plant
                    : ['bowl', 'bow', 'shield', 'stick', 'bark_strips'].includes(id)
                      ? ramps.wood
                      : ramps.dark);
  const palette = colors.map((c) => hexToRgb(c));
  inventoryItemPalettes[id] = [[0, 0, 0, 0], ...palette];
  inventoryItemGenerators[id] = (seed = 42) => {
    const data = createEmptyTexture();
    const mask = new Uint8Array(256);
    const rect = (x1: number, y1: number, x2: number, y2: number) => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) mask[y * 16 + x] = 1;
    };
    if (item.armorSlot === 'head') {
      rect(3, 4, 12, 7);
      rect(3, 8, 5, 11);
      rect(10, 8, 12, 11);
    } else if (item.armorSlot === 'chest') {
      rect(5, 5, 10, 13);
      rect(2, 4, 5, 7);
      rect(10, 4, 13, 7);
    } else if (item.armorSlot === 'legs') {
      rect(4, 3, 11, 6);
      rect(4, 7, 6, 13);
      rect(9, 7, 11, 13);
    } else if (item.armorSlot === 'feet') {
      rect(4, 5, 6, 12);
      rect(9, 5, 11, 12);
      rect(2, 11, 5, 13);
      rect(10, 11, 13, 13);
    } else if (id === 'bow') {
      rect(5, 2, 6, 3);
      rect(7, 4, 8, 5);
      rect(9, 6, 10, 9);
      rect(7, 10, 8, 11);
      rect(5, 12, 6, 13);
      rect(4, 3, 4, 12);
    } else if (id === 'shield') {
      rect(3, 3, 12, 9);
      rect(4, 10, 11, 11);
      rect(6, 12, 9, 13);
    } else if (id === 'wild_berries') {
      rect(4, 5, 7, 8);
      rect(9, 5, 12, 8);
      rect(6, 10, 10, 13);
      rect(6, 2, 10, 3);
    } else if (id === 'egg') {
      rect(7, 3, 8, 4);
      rect(5, 5, 10, 6);
      rect(4, 7, 11, 10);
      rect(5, 11, 10, 12);
    } else if (id === 'silk') {
      rect(4, 4, 11, 5);
      rect(3, 6, 4, 11);
      rect(11, 6, 12, 11);
      rect(5, 11, 10, 12);
      rect(7, 6, 8, 10);
    } else if (id === 'spore_powder' || id === 'seed') {
      rect(3, 7, 5, 9);
      rect(8, 4, 10, 6);
      rect(9, 10, 12, 12);
      rect(5, 11, 6, 13);
    } else if (id.endsWith('ingot')) {
      rect(4, 6, 10, 7);
      rect(3, 8, 12, 11);
      rect(4, 12, 11, 12);
    } else if (id === 'bowl' || id.endsWith('broth') || id.endsWith('stew')) {
      rect(2, 7, 13, 8);
      rect(3, 9, 12, 10);
      rect(5, 11, 10, 12);
      if (id !== 'bowl') rect(4, 5, 11, 6);
    } else if (['stick', 'arrow', 'wheat', 'feather', 'thorn', 'bark_strips'].includes(id)) {
      for (let i = 3; i < 13; i++) rect(i - 1, 14 - i, i, 15 - i);
      if (id !== 'stick') {
        rect(7, 3, 9, 5);
        rect(3, 8, 5, 10);
      }
    } else if (
      id.includes('crystal') ||
      id.includes('shard') ||
      id === 'flint' ||
      id === 'ember_flint'
    ) {
      rect(7, 2, 8, 4);
      rect(5, 5, 10, 9);
      rect(6, 10, 9, 13);
      rect(3, 8, 4, 10);
    } else if (id.includes('shank') || id.includes('fowl') || id.includes('chop')) {
      rect(4, 3, 9, 4);
      rect(3, 5, 10, 8);
      rect(6, 9, 8, 12);
      rect(5, 12, 10, 13);
    } else {
      // Rounded clustered material/food body with a stepped contour.
      rect(5, 4, 10, 5);
      rect(3, 6, 12, 10);
      rect(5, 11, 10, 12);
      if (id === 'apple' || id === 'wild_berries') rect(7, 2, 8, 3);
    }
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) {
        const n = y * 16 + x;
        if (!mask[n]) continue;
        const shade = !mask[n - 16] || !mask[n - 1] ? 3 : !mask[n + 16] || !mask[n + 1] ? 0 : 2;
        setPixel(data, x, y, palette[shade]!);
      }
    // A small inset cluster supplies deterministic material variation.
    const y = 7 + ((seed >>> 0) % 2);
    for (const x of [7, 8]) if (mask[y * 16 + x]) setPixel(data, x, y, palette[1]!);
    return data;
  };
}

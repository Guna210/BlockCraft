import { createEmptyTexture, setPixel, hexToRgb, type RGBA } from './noise';

const WOOD = ['#30271e', '#65503b', '#9b7948', '#d8b978'].map((c) => hexToRgb(c));
const STONE = ['#303342', '#646779', '#989ea9', '#d9d3bd'].map((c) => hexToRgb(c));
const COPPER = ['#392b38', '#935037', '#cb8850', '#f0cf8d'].map((c) => hexToRgb(c));
const IRON = ['#343340', '#727f90', '#adb6bd', '#eee1ca'].map((c) => hexToRgb(c));
const SKYSHARD = ['#302047', '#644188', '#9d6ecc', '#edccfa'].map((c) => hexToRgb(c));
const TRANSPARENT: RGBA = [0, 0, 0, 0];
const TOOL_DATA: Record<string, readonly [string, RGBA[]]> = {
  wooden_pickaxe: ['pickaxe', WOOD],
  stone_pickaxe: ['pickaxe', STONE],
  copper_pickaxe: ['pickaxe', COPPER],
  iron_pickaxe: ['pickaxe', IRON],
  wooden_axe: ['axe', WOOD],
  wooden_shovel: ['shovel', WOOD],
  wooden_hoe: ['hoe', WOOD],
  iron_shears: ['shears', IRON],
};
export const TERRAIN_TOOL_IDS: readonly string[] = Object.keys(TOOL_DATA);
for (const [tier, palette] of Object.entries({
  wooden: WOOD,
  stone: STONE,
  copper: COPPER,
  iron: IRON,
  skyshard: SKYSHARD,
}))
  for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'])
    TOOL_DATA[`${tier}_${kind}`] = [kind, palette];
export const toolGenerators: Record<string, (seed?: number) => Uint8Array> = {};
export const toolPalettes: Record<string, RGBA[]> = {};
for (const [id, [kind, palette]] of Object.entries(TOOL_DATA)) {
  toolPalettes[id] = [TRANSPARENT, ...WOOD, ...(palette === WOOD ? [] : palette)];
  toolGenerators[id] = (seed = 42) => {
    const data = createEmptyTexture(),
      shape = new Uint8Array(256),
      handle = new Uint8Array(256);
    const rect = (x1: number, y1: number, x2: number, y2: number, wood = false) => {
      for (let y = y1; y <= y2; y++)
        for (let x = x1; x <= x2; x++) {
          shape[y * 16 + x] = 1;
          if (wood) handle[y * 16 + x] = 1;
        }
    };
    if (kind === 'shears') {
      rect(4, 9, 6, 13);
      rect(9, 9, 11, 13);
      rect(6, 5, 9, 10);
      rect(4, 2, 5, 6);
      rect(10, 2, 11, 6);
      shape[11 * 16 + 5] = shape[11 * 16 + 10] = 0;
    } else {
      rect(7, 5, 8, 13, true);
      if (kind === 'pickaxe') {
        rect(3, 3, 12, 4);
        rect(2, 4, 4, 6);
        rect(11, 4, 13, 6);
      }
      if (kind === 'axe') {
        rect(4, 2, 8, 5);
        rect(3, 3, 5, 6);
      }
      if (kind === 'shovel') {
        rect(5, 2, 10, 5);
        rect(6, 6, 9, 6);
      }
      if (kind === 'sword') {
        rect(7, 2, 8, 8);
        rect(5, 9, 10, 10);
      }
      if (kind === 'hoe') {
        rect(3, 3, 9, 4);
        rect(3, 4, 4, 6);
      }
    }
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) {
        const n = y * 16 + x;
        if (!shape[n]) continue;
        const ramp = handle[n] ? WOOD : palette;
        const shade = !shape[n - 16] || !shape[n - 1] ? 3 : !shape[n + 16] || !shape[n + 1] ? 0 : 2;
        setPixel(data, x, y, ramp[shade]!);
      }
    // A two-pixel grain/joint inset varies structurally with the supplied seed.
    const jointY = (kind === 'shears' ? 6 : 8) + ((seed >>> 0) % 4);
    const jointRamp = kind === 'shears' ? palette : WOOD;
    setPixel(data, 7, jointY, jointRamp[1]!);
    setPixel(data, 8, jointY, jointRamp[1]!);
    return data;
  };
}

export const terrainToolGenerators = Object.fromEntries(
  TERRAIN_TOOL_IDS.map((id) => [id, toolGenerators[id]!]),
);
export const terrainToolPalettes = Object.fromEntries(
  TERRAIN_TOOL_IDS.map((id) => [id, toolPalettes[id]!]),
);

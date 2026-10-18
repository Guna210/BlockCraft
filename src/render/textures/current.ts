import { LCG, createEmptyTexture, setPixel, type RGBA, type TextureData } from './noise';

const CLEAR: RGBA = [0, 0, 0, 0];
const COPPER: RGBA[] = [
  [39, 30, 27, 255],
  [83, 49, 34, 255],
  [153, 85, 48, 255],
  [186, 108, 55, 255],
  [226, 153, 82, 255],
  [250, 201, 129, 255],
];
const STONE: RGBA[] = [
  [32, 35, 42, 255],
  [66, 71, 78, 255],
  [104, 111, 119, 255],
  [148, 153, 156, 255],
  [191, 191, 180, 255],
];
const WOOD: RGBA[] = [
  [43, 29, 21, 255],
  [79, 51, 30, 255],
  [122, 81, 44, 255],
  [167, 118, 65, 255],
  [209, 165, 99, 255],
];
const LAMP: RGBA[] = [
  [38, 37, 46, 255],
  [78, 82, 91, 255],
  [156, 99, 40, 255],
  [222, 156, 58, 255],
  [255, 215, 111, 255],
  [255, 244, 188, 255],
];

function rect(tile: TextureData, x0: number, y0: number, x1: number, y1: number, color: RGBA) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(tile, x, y, color);
}

function seededIndex(seed: number, span: number): number {
  return (seed >>> 0) % span;
}

/** A wrap-aware copper filament; power variants use progressively warmer, brighter ramp shades. */
export function genCopperTrace(power = 0, seed = 15001): TextureData {
  const tile = createEmptyTexture();
  const seedValue = seed >>> 0;
  const rng = new LCG(seedValue + Math.max(0, Math.min(15, power)) * 97);
  const shade = Math.min(5, Math.floor(Math.max(0, power) / 3));
  rect(tile, 0, 7, 15, 8, COPPER[0]!);
  rect(tile, 1, 7, 14, 7, COPPER[Math.max(1, shade)]!);
  rect(tile, 7, 0, 8, 15, COPPER[0]!);
  rect(tile, 7, 1, 7, 14, COPPER[Math.max(1, shade)]!);
  rect(tile, 6, 6, 9, 9, COPPER[Math.min(5, Math.max(2, shade + 1))]!);
  setPixel(tile, 7, 6, COPPER[Math.min(5, shade + 1)]!);
  setPixel(tile, 8, 8, COPPER[Math.min(5, shade + 2)]!);
  if (power > 0) {
    for (let i = 0; i < Math.min(4, Math.ceil(power / 4)); i++) {
      const x = 2 + rng.nextInt(0, 11);
      setPixel(tile, x, 7, COPPER[Math.min(5, shade + 1)]!);
    }
  }
  // Seeded filament flecks keep each atlas variant reproducible while still varying by world seed.
  const fleckShade = shade >= 5 ? 4 : Math.max(2, shade + 1);
  setPixel(tile, 1 + seededIndex(seedValue, 13), 7, COPPER[fleckShade]!);
  return tile;
}

function postTexture(seed: number, lit: boolean, wood = false): TextureData {
  const tile = createEmptyTexture();
  const ramp = wood ? WOOD : COPPER;
  const base = lit ? Math.min(5, ramp.length - 1) : 2;
  rect(tile, 6, 8, 9, 13, ramp[Math.max(0, base - 2)]!);
  rect(tile, 7, 5, 8, 10, ramp[Math.max(0, base - 1)]!);
  rect(tile, 6, 4, 9, 7, ramp[base]!);
  rect(tile, 7, 2, 8, 5, ramp[Math.min(ramp.length - 1, base + 1)]!);
  const highlightX = 7 + (seededIndex(seed, 5) < 2 ? -1 : 0);
  setPixel(tile, highlightX, 3, ramp[Math.min(ramp.length - 1, base + 2)]!);
  return tile;
}

export const genInverterTorch = (seed = 15002) => postTexture(seed, true);
export const genLever = (seed = 15003) => postTexture(seed, false, true);

export function genStoneButton(seed = 15004): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 3, 3, 12, 12, STONE[0]!);
  rect(tile, 4, 4, 11, 11, STONE[2]!);
  rect(tile, 4, 4, 10, 5, STONE[3]!);
  rect(tile, 5, 8, 10, 10, STONE[1]!);
  setPixel(tile, 4 + (seededIndex(seed, 5) % 3), 6, STONE[4]!);
  return tile;
}

export function genWoodenButton(seed = 15005): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 3, 3, 12, 12, WOOD[0]!);
  rect(tile, 4, 4, 11, 11, WOOD[2]!);
  rect(tile, 4, 4, 10, 5, WOOD[4]!);
  rect(tile, 5, 9, 11, 10, WOOD[1]!);
  setPixel(tile, seededIndex(seed, 5) < 2 ? 6 : 9, 7, WOOD[3]!);
  return tile;
}

export function genPressurePlate(seed = 15006): TextureData {
  const tile = createEmptyTexture();
  for (let y = 2; y < 14; y += 3) {
    rect(tile, 2, y, 13, y + 1, y === 2 ? WOOD[3]! : WOOD[1]!);
    setPixel(tile, 3 + seededIndex(seed + y * 7, 9), y, WOOD[4]!);
  }
  return tile;
}

export function genTripwire(seed = 15007): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 0, 7, 15, 7, STONE[1]!);
  for (let x = 1; x < 15; x += 4) {
    setPixel(tile, x, 8, STONE[2]!);
    setPixel(tile, x + 1, 8, STONE[3]!);
  }
  setPixel(tile, 1 + seededIndex(seed, 13), 6, STONE[4]!);
  return tile;
}

export function genTripwireHook(seed = 15008): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 2, 3, 13, 12, STONE[1]!);
  rect(tile, 3, 4, 12, 11, STONE[2]!);
  rect(tile, 5, 5, 10, 7, COPPER[3]!);
  rect(tile, 8, 7, 9, 13, COPPER[2]!);
  setPixel(tile, 2 + seededIndex(seed, 9), 4, STONE[4]!);
  return tile;
}

export function genRelayFace(lit = false, seed = 15009): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 0, 0, 15, 15, STONE[0]!);
  rect(tile, 2, 2, 13, 13, STONE[2]!);
  rect(tile, 4, 4, 11, 11, STONE[1]!);
  rect(tile, 6, 4, 9, 7, lit ? LAMP[5]! : COPPER[2]!);
  rect(tile, 6, 8, 9, 11, lit ? LAMP[4]! : COPPER[1]!);
  setPixel(tile, 5 + seededIndex(seed, 5), 3, STONE[4]!);
  return tile;
}

export function genGaugeFace(lit = false, seed = 15010): TextureData {
  const tile = createEmptyTexture();
  rect(tile, 0, 0, 15, 15, STONE[0]!);
  rect(tile, 2, 2, 13, 13, STONE[2]!);
  rect(tile, 4, 4, 11, 11, STONE[1]!);
  rect(tile, 5, 5, 10, 10, lit ? LAMP[5]! : COPPER[2]!);
  rect(tile, 7, 6, 8, 10, lit ? LAMP[4]! : COPPER[3]!);
  setPixel(tile, 4 + seededIndex(seed, 5), 4, STONE[4]!);
  return tile;
}

export function genLampFace(
  face: 'top' | 'side' | 'bottom',
  lit = false,
  seed = 15011,
): TextureData {
  const tile = createEmptyTexture();
  const glow = lit ? LAMP[5]! : LAMP[1]!;
  rect(tile, 0, 0, 15, 15, LAMP[0]!);
  rect(tile, 2, 2, 13, 13, lit ? LAMP[3]! : LAMP[2]!);
  rect(tile, 4, 4, 11, 11, glow);
  rect(tile, 5, 5, 10, 10, lit ? LAMP[5]! : LAMP[3]!);
  if (face === 'side') {
    rect(tile, 1, 1, 14, 2, LAMP[4]!);
    rect(tile, 1, 13, 14, 14, LAMP[0]!);
  } else if (face === 'bottom') {
    rect(tile, 3, 3, 12, 12, LAMP[1]!);
  }
  setPixel(tile, 1 + seededIndex(seed + face.length, 13), 3, lit ? LAMP[5]! : LAMP[4]!);
  return tile;
}

export const genLampTop = (seed = 15011) => genLampFace('top', false, seed);
export const genLampSide = (seed = 15012) => genLampFace('side', false, seed);
export const genLampBottom = (seed = 15013) => genLampFace('bottom', false, seed);
export const genLampTopLit = (seed = 15014) => genLampFace('top', true, seed);
export const genLampSideLit = (seed = 15015) => genLampFace('side', true, seed);
export const genLampBottomLit = (seed = 15016) => genLampFace('bottom', true, seed);

export const CURRENT_PALETTES = {
  copper: [...COPPER, CLEAR],
  stone: STONE,
  wood: WOOD,
  lamp: LAMP,
  stoneCutout: [...STONE, CLEAR],
  woodCutout: [...WOOD, CLEAR],
  relayUnlit: [...STONE, COPPER[1]!, COPPER[2]!],
  relayLit: [...STONE, LAMP[4]!, LAMP[5]!],
  gaugeUnlit: [...STONE, COPPER[2]!, COPPER[3]!],
  gaugeLit: [...STONE, LAMP[4]!, LAMP[5]!],
  tripwireHook: [...STONE, ...COPPER, CLEAR],
  transparent: [CLEAR],
};

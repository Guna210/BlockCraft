import type { Inventory } from '../gameplay/inventory';
import { PAL_PLAYER_COAT, PAL_PLAYER_HEAD, PAL_PLAYER_LEG } from '../render/textures/player';
import type { RGBA } from '../render/textures/noise';
import { PREVIEW_BOX } from './inventory-layout';
import { fillRect } from './ui-kit';

/** One figure pixel is this many UI pixels, so the face keeps its detail at every integer UI scale. */
const UNIT = 2;

const css = (c: RGBA): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const HEAD = PAL_PLAYER_HEAD.map(css);
const COAT = PAL_PLAYER_COAT.map(css);
const LEG = PAL_PLAYER_LEG.map(css);
/** Eye whites reuse the pale end of the trouser ramp. */
const WHITE = LEG[4]!;

/** Armor ramps (dark, mid, light) taken from the ART.md copper and iron ramps. */
const ARMOR_RAMPS: Record<string, [string, string, string]> = {
  copper: ['#8a4b2a', '#b4683a', '#d8874a'],
  iron: ['#8f735f', '#b89a86', '#d9bea8'],
};
/** Every color the figure may draw: the player ramps plus the armor ramps. */
export const FIGURE_COLORS: ReadonlySet<string> = new Set([
  ...HEAD,
  ...COAT,
  ...LEG,
  ...Object.values(ARMOR_RAMPS).flat(),
]);
const ARMOR_SLOTS = { head: 36, chest: 37, legs: 38, feet: 39 } as const;

function armorRamp(inventory: Inventory, slot: number): [string, string, string] | null {
  const id = inventory.slots[slot]?.id;
  if (!id) return null;
  for (const [material, ramp] of Object.entries(ARMOR_RAMPS))
    if (id.startsWith(material)) return ramp;
  return ARMOR_RAMPS.iron!;
}

/**
 * The player in the same palettes as the third-person model: swept dark hair, skin ramp, copper
 * jacket with the sea-green sash, slate trousers. Light comes from the top-left, so every part has
 * a lit left column and a darker right column. Worn armor is drawn over the matching body part.
 */
export function drawPreviewFigure(
  ctx: CanvasRenderingContext2D,
  inventory: Inventory,
  s: number,
): void {
  // Origin: horizontal centre of the box, 4 UI pixels below its top edge.
  const ox = PREVIEW_BOX.x + PREVIEW_BOX.w / 2 - 8 * UNIT;
  const oy = PREVIEW_BOX.y + 4;
  const px = (x: number, y: number, w: number, h: number, color: string): void =>
    fillRect(ctx, ox + x * UNIT, oy + y * UNIT, w * UNIT, h * UNIT, color, s);

  // Legs (4 wide each, 12..) with a lit left column, darker right column and dark boots.
  for (const lx of [4, 8]) {
    px(lx, 20, 4, 11, LEG[2]!);
    px(lx, 20, 1, 11, LEG[3]!);
    px(lx + 3, 20, 1, 11, LEG[1]!);
    px(lx, 31, 4, 2, LEG[0]!);
    px(lx, 31, 1, 1, LEG[1]!);
  }
  px(4, 20, 8, 1, LEG[1]!);

  // Arms: sleeves in coat tones, hands in skin tones.
  for (const ax of [0, 12]) {
    px(ax, 8, 4, 8, COAT[2]!);
    px(ax, 8, 1, 8, COAT[3]!);
    px(ax + 3, 8, 1, 8, COAT[1]!);
    px(ax, 16, 4, 3, HEAD[3]!);
    px(ax, 16, 1, 3, HEAD[4]!);
    px(ax + 3, 16, 1, 3, HEAD[2]!);
  }

  // Jacket with the sea-green sash running from the left shoulder to the right hip.
  px(4, 8, 8, 12, COAT[2]!);
  px(4, 8, 1, 12, COAT[3]!);
  px(11, 8, 1, 12, COAT[1]!);
  for (let i = 0; i < 10; i++) {
    const x = 4 + Math.floor(i * 0.7);
    px(x, 8 + i, 1, 1, COAT[7]!);
    px(x + 1, 8 + i, 2, 1, COAT[6]!);
    px(x + 3, 8 + i, 1, 1, COAT[5]!);
  }
  px(4, 17, 8, 1, COAT[1]!);
  px(7, 17, 2, 1, COAT[4]!);

  // Head: skin, hair, brows, eyes with a pupil and a highlight, nose, mouth, ear shadow.
  px(4, 0, 8, 8, HEAD[3]!);
  px(4, 0, 8, 1, HEAD[0]!);
  px(4, 1, 8, 1, HEAD[0]!);
  px(4, 2, 2, 2, HEAD[0]!);
  px(10, 2, 2, 2, HEAD[0]!);
  px(5, 1, 2, 1, HEAD[1]!);
  px(4, 4, 1, 4, HEAD[4]!);
  px(11, 4, 1, 4, HEAD[2]!);
  px(5, 4, 2, 1, HEAD[2]!);
  px(9, 4, 2, 1, HEAD[2]!);
  for (const ex of [5, 9]) {
    px(ex, 5, 2, 1, WHITE);
    px(ex + (ex === 5 ? 1 : 0), 5, 1, 1, HEAD[0]!);
    px(ex + (ex === 5 ? 0 : 1), 5, 1, 1, WHITE);
  }
  px(7, 6, 2, 1, HEAD[2]!);
  px(8, 6, 1, 1, HEAD[1]!);
  px(6, 7, 4, 1, HEAD[1]!);
  px(4, 8, 8, 1, HEAD[2]!);

  // Worn armor over each body part.
  const helmet = armorRamp(inventory, ARMOR_SLOTS.head);
  if (helmet) {
    // A cap over the hair that leaves the whole face visible.
    px(3, 0, 10, 2, helmet[1]);
    px(3, 0, 10, 1, helmet[2]);
    px(12, 0, 1, 2, helmet[0]);
    px(3, 2, 1, 2, helmet[1]);
    px(12, 2, 1, 2, helmet[0]);
  }
  const chest = armorRamp(inventory, ARMOR_SLOTS.chest);
  if (chest) {
    // Pauldrons on the shoulders and a breastplate that leaves the sash showing at the sides.
    for (const ax of [0, 12]) {
      px(ax, 8, 4, 2, chest[1]);
      px(ax, 8, 4, 1, chest[2]);
      px(ax + 3, 8, 1, 2, chest[0]);
    }
    px(6, 9, 4, 6, chest[1]);
    px(6, 9, 4, 1, chest[2]);
    px(6, 9, 1, 6, chest[2]);
    px(9, 9, 1, 6, chest[0]);
    px(6, 14, 4, 1, chest[0]);
  }
  const legs = armorRamp(inventory, ARMOR_SLOTS.legs);
  if (legs) {
    // Thigh guards.
    for (const lx of [4, 8]) {
      px(lx, 21, 4, 5, legs[1]);
      px(lx, 21, 1, 5, legs[2]);
      px(lx + 3, 21, 1, 5, legs[0]);
      px(lx, 25, 4, 1, legs[0]);
    }
  }
  const feet = armorRamp(inventory, ARMOR_SLOTS.feet);
  if (feet) {
    for (const lx of [4, 8]) {
      px(lx, 29, 4, 4, feet[1]);
      px(lx, 29, 4, 1, feet[2]);
      px(lx + 3, 29, 1, 4, feet[0]);
      px(lx, 32, 4, 1, feet[0]);
    }
  }
}

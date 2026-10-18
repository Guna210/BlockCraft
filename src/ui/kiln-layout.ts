import { SLOT_SIZE, uiScaleFor, type Rect } from './ui-kit';

/** Panel dimensions in UI pixels. */
export const KILN_PANEL_W = 178;
export const KILN_PANEL_H = 166;
export const KILN_SLOT_COUNT = 39;

export const KILN_INPUT_SLOT: readonly [number, number] = [56, 17];
export const KILN_FUEL_SLOT: readonly [number, number] = [56, 53];
export const KILN_OUTPUT_SLOT: readonly [number, number] = [116, 35];

export const KILN_FLAME_BOX: Rect = { x: 58, y: 36, w: 14, h: 14 };
export const KILN_ARROW_BOX: Rect = { x: 79, y: 34, w: 24, h: 17 };
export const KILN_CLOSE_BUTTON: Rect = { x: 162, y: 5, w: 11, h: 11 };

/**
 * 39 slots:
 * 0: Kiln input
 * 1: Kiln fuel
 * 2: Kiln output
 * 3..11: Hotbar (player inventory slots 0..8)
 * 12..38: Main inventory (player inventory slots 9..35)
 */
export const KILN_SLOT_POSITIONS: ReadonlyArray<readonly [number, number]> = (() => {
  const result: Array<readonly [number, number]> = [];
  result[0] = KILN_INPUT_SLOT;
  result[1] = KILN_FUEL_SLOT;
  result[2] = KILN_OUTPUT_SLOT;
  for (let i = 0; i < 9; i++) {
    result[3 + i] = [8 + SLOT_SIZE * i, 142];
  }
  for (let i = 0; i < 27; i++) {
    result[12 + i] = [8 + SLOT_SIZE * (i % 9), 84 + SLOT_SIZE * Math.floor(i / 9)];
  }
  return result;
})();

export interface KilnLayout {
  scale: number;
  originX: number;
  originY: number;
  panel: Rect;
  slots: Rect[];
  closeButton: Rect;
  flame: Rect;
  arrow: Rect;
}

function scaled(r: Rect, s: number, ox: number, oy: number): Rect {
  return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
}

export function computeKilnLayout(width: number, height: number): KilnLayout {
  const scale = uiScaleFor(width, height);
  const originX = Math.floor((width - KILN_PANEL_W * scale) / 2);
  const originY = Math.floor((height - KILN_PANEL_H * scale) / 2);
  return {
    scale,
    originX,
    originY,
    panel: { x: originX, y: originY, w: KILN_PANEL_W * scale, h: KILN_PANEL_H * scale },
    slots: KILN_SLOT_POSITIONS.map(([x, y]) =>
      scaled({ x, y, w: SLOT_SIZE, h: SLOT_SIZE }, scale, originX, originY),
    ),
    closeButton: scaled(KILN_CLOSE_BUTTON, scale, originX, originY),
    flame: scaled(KILN_FLAME_BOX, scale, originX, originY),
    arrow: scaled(KILN_ARROW_BOX, scale, originX, originY),
  };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function kilnSlotAt(layout: KilnLayout, x: number, y: number): number | null {
  const index = layout.slots.findIndex((r) => contains(r, x, y));
  return index < 0 ? null : index;
}

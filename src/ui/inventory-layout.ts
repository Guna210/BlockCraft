import { SLOT_SIZE, uiScaleFor, type Rect } from './ui-kit';

/** Size of the inventory panel in UI pixels. */
export const PANEL_W = 178;
export const PANEL_H = 186;
export const SLOT_COUNT = 41;

/** Slot positions inside the panel, in UI pixels. Indices follow `Inventory`: hotbar, main, armor, offhand. */
export const SLOT_POSITIONS: ReadonlyArray<readonly [number, number]> = (() => {
  const result: Array<readonly [number, number]> = [];
  for (let i = 0; i < 9; i++) result[i] = [8 + SLOT_SIZE * i, 160];
  for (let i = 0; i < 27; i++)
    result[9 + i] = [8 + SLOT_SIZE * (i % 9), 100 + SLOT_SIZE * Math.floor(i / 9)];
  for (let i = 0; i < 4; i++) result[36 + i] = [8, 20 + SLOT_SIZE * i];
  result[40] = [152, 74];
  return result;
})();

export const PREVIEW_BOX: Rect = { x: 34, y: 20, w: 88, h: 72 };
export const CLOSE_BUTTON: Rect = { x: 162, y: 5, w: 11, h: 11 };

export interface InventoryLayout {
  /** Canvas pixels per UI pixel; always an integer. */
  scale: number;
  /** Panel origin in canvas pixels. */
  originX: number;
  originY: number;
  /** Panel rectangle in canvas pixels. */
  panel: Rect;
  /** Slot cells (18×18 UI pixels each) in canvas pixels, indexed by inventory slot. */
  slots: Rect[];
  closeButton: Rect;
}

function scaled(r: Rect, s: number, ox: number, oy: number): Rect {
  return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
}

export function computeLayout(width: number, height: number): InventoryLayout {
  const scale = uiScaleFor(width, height);
  const originX = Math.floor((width - PANEL_W * scale) / 2);
  const originY = Math.floor((height - PANEL_H * scale) / 2);
  return {
    scale,
    originX,
    originY,
    panel: { x: originX, y: originY, w: PANEL_W * scale, h: PANEL_H * scale },
    slots: SLOT_POSITIONS.map(([x, y]) =>
      scaled({ x, y, w: SLOT_SIZE, h: SLOT_SIZE }, scale, originX, originY),
    ),
    closeButton: scaled(CLOSE_BUTTON, scale, originX, originY),
  };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** The slot under a canvas-pixel position, or null. */
export function slotAt(layout: InventoryLayout, x: number, y: number): number | null {
  const index = layout.slots.findIndex((r) => contains(r, x, y));
  return index < 0 ? null : index;
}

import { drawText, textWidth, GLYPH_HEIGHT } from './pixel-font';

/** The shared UI palette (ART.md §4: at most 8 colors, bevels lit from the top-left). */
export const UI = {
  outline: '#15121f',
  shade: '#3a3d5a',
  panel: '#555a80',
  light: '#8189b3',
  slot: '#23253a',
  accent: '#e2b43a',
  text: '#f2eee2',
  highlight: 'rgba(255,255,255,0.35)',
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest integer scale at which a 320×240 UI area still fits the window, never below 1. */
export function uiScaleFor(width: number, height: number): number {
  return Math.max(1, Math.min(Math.floor(width / 320), Math.floor(height / 240)));
}

export function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  s: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x * s, y * s, w * s, h * s);
}

/** Beveled panel: dark outline with clipped corners, light top-left edge, shaded bottom-right edge. */
export function drawPanel(ctx: CanvasRenderingContext2D, r: Rect, s: number): void {
  const { x, y, w, h } = r;
  fillRect(ctx, x + 1, y, w - 2, h, UI.outline, s);
  fillRect(ctx, x, y + 1, w, h - 2, UI.outline, s);
  fillRect(ctx, x + 1, y + 1, w - 2, h - 2, UI.panel, s);
  fillRect(ctx, x + 1, y + 1, w - 2, 1, UI.light, s);
  fillRect(ctx, x + 1, y + 1, 1, h - 2, UI.light, s);
  fillRect(ctx, x + 2, y + h - 2, w - 3, 1, UI.shade, s);
  fillRect(ctx, x + w - 2, y + 2, 1, h - 3, UI.shade, s);
}

/** Recessed square: dark top-left edge, light bottom-right edge. Inner area is `w-2` square. */
export function drawInset(ctx: CanvasRenderingContext2D, r: Rect, s: number): void {
  fillRect(ctx, r.x, r.y, r.w, r.h, UI.slot, s);
  fillRect(ctx, r.x, r.y, r.w, 1, UI.outline, s);
  fillRect(ctx, r.x, r.y, 1, r.h, UI.outline, s);
  fillRect(ctx, r.x + 1, r.y + r.h - 1, r.w - 1, 1, UI.light, s);
  fillRect(ctx, r.x + r.w - 1, r.y + 1, 1, r.h - 1, UI.light, s);
}

export const SLOT_SIZE = 18;

export function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  drawInset(ctx, { x, y, w: SLOT_SIZE, h: SLOT_SIZE }, s);
}

export function drawSlotHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
): void {
  fillRect(ctx, x + 1, y + 1, SLOT_SIZE - 2, SLOT_SIZE - 2, UI.highlight, s);
}

/** Raised button with a one-letter label; pressed buttons swap their bevel. */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  s: number,
  hover: boolean,
): void {
  drawPanel(ctx, r, s);
  if (hover) fillRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, UI.highlight, s);
  const tx = r.x + Math.floor((r.w - textWidth(label)) / 2);
  const ty = r.y + Math.floor((r.h - GLYPH_HEIGHT) / 2);
  drawText(ctx, label, tx * s, ty * s, s, UI.text, UI.outline);
}

/** Item-count text, right-aligned inside a slot whose top-left is (x, y). */
export function drawCount(
  ctx: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  s: number,
): void {
  const text = String(count);
  drawText(
    ctx,
    text,
    (x + SLOT_SIZE - 1 - textWidth(text)) * s,
    (y + 10) * s,
    s,
    UI.text,
    UI.outline,
  );
}

/** Tooltip box with its top-left at canvas pixel (px, py), clamped inside the canvas. */
export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string,
  px: number,
  py: number,
  s: number,
  width: number,
  height: number,
): Rect {
  const w = textWidth(text) + 8;
  const h = GLYPH_HEIGHT + 8;
  const x = Math.max(0, Math.min(px, width - w * s)) / s;
  const y = Math.max(0, Math.min(py, height - h * s)) / s;
  const box = { x: Math.floor(x), y: Math.floor(y), w, h };
  fillRect(ctx, box.x + 1, box.y, w - 2, h, UI.outline, s);
  fillRect(ctx, box.x, box.y + 1, w, h - 2, UI.outline, s);
  fillRect(ctx, box.x + 1, box.y + 1, w - 2, h - 2, UI.slot, s);
  fillRect(ctx, box.x + 2, box.y + 1, w - 4, 1, UI.accent, s);
  drawText(ctx, text, (box.x + 4) * s, (box.y + 4) * s, s, UI.text, UI.outline);
  return box;
}

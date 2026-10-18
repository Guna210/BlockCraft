import type { Inventory } from '../gameplay/inventory';
import type { KilnState } from '../gameplay/kiln';
import { COOK_TICKS_PER_ITEM } from '../gameplay/kiln';
import { displayName, drawText } from './pixel-font';
import type { IconSheet } from './icons';
import {
  KILN_CLOSE_BUTTON,
  KILN_FLAME_BOX,
  KILN_ARROW_BOX,
  KILN_PANEL_H,
  KILN_PANEL_W,
  KILN_SLOT_COUNT,
  KILN_SLOT_POSITIONS,
  type KilnLayout,
} from './kiln-layout';
import { getToolDurability } from '../gameplay/tools';
import {
  UI,
  drawButton,
  drawCount,
  drawDurabilityBar,
  drawPanel,
  drawSlot,
  drawSlotHighlight,
  drawTooltip,
  fillRect,
} from './ui-kit';

export interface KilnView {
  layout: KilnLayout;
  inventory: Inventory;
  kiln: KilnState;
  hoverSlot: number | null;
  hoverClose: boolean;
  mouse: { x: number; y: number };
  width: number;
  height: number;
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  icons: IconSheet,
  sheet: CanvasImageSource,
  id: string,
  x: number,
  y: number,
  size: number,
): void {
  const rect = icons.rects.get(id);
  if (rect) ctx.drawImage(sheet, rect.x, rect.y, 16, 16, x, y, size, size);
}

// 14x14 flame silhouette (1: flame pixel, 0: background)
const FLAME_MASK: readonly string[] = [
  '....#....#....',
  '...###..###...',
  '..##########..',
  '..##########..',
  '.############.',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '.############.',
  '.############.',
  '..##########..',
  '...########...',
];

function drawFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  burnRemaining: number,
  burnTotal: number,
): void {
  const ratio = burnTotal > 0 ? Math.max(0, Math.min(1, burnRemaining / burnTotal)) : 0;
  const fillH = Math.round(14 * ratio);
  const startFillRow = 14 - fillH;

  for (let row = 0; row < 14; row++) {
    const line = FLAME_MASK[row]!;
    const isLitRow = row >= startFillRow && burnRemaining > 0;
    for (let col = 0; col < 14; col++) {
      if (line[col] === '#') {
        const color = isLitRow
          ? col >= 4 && col <= 9 && row >= 4 && row <= 11
            ? UI.text
            : UI.accent
          : UI.slot;
        fillRect(ctx, x + col, y + row, 1, 1, color, s);
      }
    }
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  cookProgress: number,
): void {
  const ratio = Math.max(0, Math.min(1, cookProgress / COOK_TICKS_PER_ITEM));
  const fillW = Math.round(24 * ratio);

  // Background shaft (x: 0..14, y: 6..10) and head (triangle x: 15..23)
  for (let row = 0; row < 17; row++) {
    for (let col = 0; col < 24; col++) {
      let isArrow = false;
      if (col < 15) {
        if (row >= 6 && row <= 10) isArrow = true;
      } else {
        const headCol = col - 15; // 0..8
        const halfH = 8 - headCol;
        if (row >= 8 - halfH && row <= 8 + halfH) isArrow = true;
      }

      if (isArrow) {
        const color = col < fillW ? UI.accent : UI.slot;
        fillRect(ctx, x + col, y + row, 1, 1, color, s);
      }
    }
  }
}

export function kilnTooltipFor(
  inventory: Inventory,
  kiln: KilnState,
  slot: number | null,
): string | null {
  if (slot === null) return null;
  if (slot === 0) return kiln.input ? displayName(kiln.input.id) : null;
  if (slot === 1) return kiln.fuel ? displayName(kiln.fuel.id) : null;
  if (slot === 2) return kiln.output ? displayName(kiln.output.id) : null;
  if (slot >= 3 && slot <= 11) {
    const stack = inventory.slots[slot - 3];
    return stack ? displayName(stack.id) : null;
  }
  if (slot >= 12 && slot <= 38) {
    const stack = inventory.slots[slot - 12 + 9];
    return stack ? displayName(stack.id) : null;
  }
  return null;
}

export function drawKilnScreen(
  ctx: CanvasRenderingContext2D,
  view: KilnView,
  icons: IconSheet,
  sheet: CanvasImageSource,
): void {
  const { layout, inventory, kiln } = view;
  const s = layout.scale;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);

  ctx.globalAlpha = 0.55;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(layout.originX, layout.originY);
  drawPanel(ctx, { x: 0, y: 0, w: KILN_PANEL_W, h: KILN_PANEL_H }, s);
  drawText(ctx, 'KILN', 8 * s, 6 * s, s, UI.text, UI.outline);
  drawText(ctx, 'INVENTORY', 8 * s, 72 * s, s, UI.text, UI.outline);
  drawButton(ctx, KILN_CLOSE_BUTTON, 'X', s, view.hoverClose);

  // Flame and arrow indicators
  drawFlame(ctx, KILN_FLAME_BOX.x, KILN_FLAME_BOX.y, s, kiln.burnRemaining, kiln.burnTotal);
  drawArrow(ctx, KILN_ARROW_BOX.x, KILN_ARROW_BOX.y, s, kiln.cookProgress);

  // Draw 39 slots
  for (let slot = 0; slot < KILN_SLOT_COUNT; slot++) {
    const [x, y] = KILN_SLOT_POSITIONS[slot]!;
    drawSlot(ctx, x, y, s);

    let stack: { id: string; count: number; damage?: number | null } | null = null;
    if (slot === 0) stack = kiln.input;
    else if (slot === 1) stack = kiln.fuel;
    else if (slot === 2) stack = kiln.output;
    else if (slot >= 3 && slot <= 11) stack = inventory.slots[slot - 3] ?? null;
    else if (slot >= 12 && slot <= 38) stack = inventory.slots[slot - 12 + 9] ?? null;

    if (stack) {
      drawIcon(ctx, icons, sheet, stack.id, (x + 1) * s, (y + 1) * s, 16 * s);
      if (stack.count > 1) drawCount(ctx, stack.count, x, y, s);
      if (stack.damage !== undefined && stack.damage !== null && stack.damage > 0) {
        const durability = getToolDurability(stack.id);
        if (durability !== null && durability > 0) {
          drawDurabilityBar(ctx, stack.damage, durability, x, y, s);
        }
      }
    }

    if (view.hoverSlot === slot) drawSlotHighlight(ctx, x, y, s);
  }
  ctx.restore();

  // Cursor stack
  const cursor = inventory.cursor;
  if (cursor) {
    const size = 16 * s;
    const x = view.mouse.x - size / 2;
    const y = view.mouse.y - size / 2;
    drawIcon(ctx, icons, sheet, cursor.id, x, y, size);
    if (cursor.count > 1) {
      ctx.save();
      ctx.translate(x - s, y - s);
      drawCount(ctx, cursor.count, 0, 0, s);
      ctx.restore();
    }
    if (cursor.damage !== undefined && cursor.damage !== null && cursor.damage > 0) {
      const durability = getToolDurability(cursor.id);
      if (durability !== null && durability > 0) {
        drawDurabilityBar(ctx, cursor.damage, durability, Math.floor(x / s), Math.floor(y / s), s);
      }
    }
  } else if (view.hoverSlot !== null) {
    const tip = kilnTooltipFor(inventory, kiln, view.hoverSlot);
    if (tip) {
      drawTooltip(ctx, tip, view.mouse.x + 8 * s, view.mouse.y - 4 * s, s, view.width, view.height);
    }
  }
}

import type { Inventory } from '../gameplay/inventory';
import type { KilnState } from '../gameplay/kiln';
import { COOK_TICKS_PER_ITEM } from '../gameplay/kiln';
import { displayItemStackName, drawText } from './pixel-font';
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
import { isItemAffix, type ItemAffix } from '../gameplay/items';
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

function affixValue(value: unknown): ItemAffix | undefined {
  return isItemAffix(value) ? value : undefined;
}

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

export const FLAME_RED = '#b32b1b';
export const FLAME_ORANGE = '#d96d1a';
export const FLAME_YELLOW = '#f2c12e';

// 14x14 animated flame frames: a ragged teardrop (R: red outer, O: orange body, Y: yellow teardrop core,
// .: empty). The tip and the small tongues on the outer edge move between frames so the flame flickers.
export const FLAME_FRAMES: readonly (readonly string[])[] = [
  [
    '......R.......',
    '.....ROR......',
    '.....ROR......',
    '....ROOORR....',
    '..RROOYOOR....',
    '..ROOYYYOR....',
    '..ROOYYYOOR...',
    '..ROYYYYYOR...',
    '.ROOYYYYYOR...',
    '.ROOOYYYOOORR.',
    'RRROOOOOOOOR..',
    '...ROOOOOOR...',
    '...ROOOOOR....',
    '....RRRRR.....',
  ],
  [
    '.......R......',
    '.....RRR......',
    '.....ROR.R....',
    '....ROOOR.R...',
    '...ROOYOORR...',
    '...ROYYYOR....',
    '...ROYYYOOR...',
    '..ROYYYYYOR...',
    'RROOYYYYYOOR..',
    'ROOOOYYYOOOR..',
    '.ROOOOOOOOR...',
    '..ROOOOOOOR...',
    '...ROOOOOR....',
    '....RRRRR.....',
  ],
  [
    '.....R........',
    '.....RRR......',
    '...R.ROR......',
    '...RROOOR.....',
    '...ROOYOOR....',
    '...ROYYYOOR...',
    '..ROOYYYOORR..',
    '..ROYYYYYR....',
    '.ROOYYYYYORR..',
    '..ROOYYYOOOR..',
    '.ROOOOOOOOORR.',
    '..ROOOOOOOR...',
    '...ROOOOOR....',
    '....RRRRR.....',
  ],
];

export function isFlameEdge(frame: readonly string[], row: number, col: number): boolean {
  if (row === 0 || row === 13 || col === 0 || col === 13) return true;
  return (
    frame[row - 1]![col] === '.' ||
    frame[row + 1]![col] === '.' ||
    frame[row]![col - 1] === '.' ||
    frame[row]![col + 1] === '.'
  );
}

function drawFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  burnRemaining: number,
  burnTotal: number,
): void {
  const frameIndex = burnRemaining > 0 ? Math.floor(burnRemaining / 4) % 3 : 0;
  const frame = FLAME_FRAMES[frameIndex]!;
  const ratio = burnTotal > 0 ? Math.max(0, Math.min(1, burnRemaining / burnTotal)) : 0;
  const fillH = Math.round(14 * ratio);
  const startFillRow = 14 - fillH;

  for (let row = 0; row < 14; row++) {
    const line = frame[row]!;
    const isLitRow = row >= startFillRow && burnRemaining > 0;
    for (let col = 0; col < 14; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      if (isLitRow) {
        const color = ch === 'Y' ? FLAME_YELLOW : ch === 'O' ? FLAME_ORANGE : FLAME_RED;
        fillRect(ctx, x + col, y + row, 1, 1, color, s);
      } else {
        const isEdge = isFlameEdge(frame, row, col);
        const color = isEdge ? UI.outline : UI.slot;
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
  if (slot === 0)
    return kiln.input ? displayItemStackName(kiln.input.id, affixValue(kiln.input.affix)) : null;
  if (slot === 1)
    return kiln.fuel ? displayItemStackName(kiln.fuel.id, affixValue(kiln.fuel.affix)) : null;
  if (slot === 2)
    return kiln.output ? displayItemStackName(kiln.output.id, affixValue(kiln.output.affix)) : null;
  if (slot >= 3 && slot <= 11) {
    const stack = inventory.slots[slot - 3];
    return stack ? displayItemStackName(stack.id, stack.affix) : null;
  }
  if (slot >= 12 && slot <= 38) {
    const stack = inventory.slots[slot - 12 + 9];
    return stack ? displayItemStackName(stack.id, stack.affix) : null;
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

    let stack: { id: string; count: number; damage?: number | null; affix?: ItemAffix } | null =
      null;
    if (slot === 0 && kiln.input) stack = { ...kiln.input, affix: affixValue(kiln.input.affix) };
    else if (slot === 1 && kiln.fuel) stack = { ...kiln.fuel, affix: affixValue(kiln.fuel.affix) };
    else if (slot === 2 && kiln.output)
      stack = { ...kiln.output, affix: affixValue(kiln.output.affix) };
    else if (slot >= 3 && slot <= 11) stack = inventory.slots[slot - 3] ?? null;
    else if (slot >= 12 && slot <= 38) stack = inventory.slots[slot - 12 + 9] ?? null;

    if (stack) {
      drawIcon(ctx, icons, sheet, stack.id, (x + 1) * s, (y + 1) * s, 16 * s);
      if (stack.count > 1) drawCount(ctx, stack.count, x, y, s);
      if (stack.damage !== undefined && stack.damage !== null && stack.damage > 0) {
        const durability = getToolDurability(stack);
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
      const durability = getToolDurability(cursor);
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
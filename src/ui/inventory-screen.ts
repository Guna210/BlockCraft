import type { Inventory } from '../gameplay/inventory';
import { drawPreviewFigure } from './preview-figure';
import { displayItemStackName, drawText } from './pixel-font';
import type { IconSheet } from './icons';
import {
  CLOSE_BUTTON,
  PANEL_H,
  PANEL_W,
  PREVIEW_BOX,
  SLOT_POSITIONS,
  SLOT_COUNT,
  type InventoryLayout,
} from './inventory-layout';
import { getToolDurability } from '../gameplay/tools';
import {
  UI,
  drawButton,
  drawCount,
  drawDurabilityBar,
  drawInset,
  drawPanel,
  drawSlot,
  drawSlotHighlight,
  drawTooltip,
} from './ui-kit';

export interface InventoryView {
  layout: InventoryLayout;
  inventory: Inventory;
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

export function drawInventoryScreen(
  ctx: CanvasRenderingContext2D,
  view: InventoryView,
  icons: IconSheet,
  sheet: CanvasImageSource,
): void {
  const { layout, inventory } = view;
  const s = layout.scale;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);
  // The scrim reuses the outline color, so the screen stays within the shared palette.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(layout.originX, layout.originY);
  drawPanel(ctx, { x: 0, y: 0, w: PANEL_W, h: PANEL_H }, s);
  drawText(ctx, 'INVENTORY', 8 * s, 6 * s, s, UI.text, UI.outline);
  drawText(ctx, 'OFFHAND', (170 - 41) * s, 64 * s, s, UI.text, UI.outline);
  drawButton(ctx, CLOSE_BUTTON, 'X', s, view.hoverClose);
  drawInset(ctx, PREVIEW_BOX, s);
  drawPreviewFigure(ctx, inventory, s);

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const [x, y] = SLOT_POSITIONS[slot]!;
    drawSlot(ctx, x, y, s);
    const stack = inventory.slots[slot];
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
    const stack = inventory.slots[view.hoverSlot];
    if (stack) {
      const name = displayItemStackName(stack.id, stack.affix);
      drawTooltip(
        ctx,
        name,
        view.mouse.x + 8 * s,
        view.mouse.y - 4 * s,
        s,
        view.width,
        view.height,
      );
    }
  }
}

/** The tooltip text for a slot, or null when it is empty. */
export function tooltipFor(inventory: Inventory, slot: number | null): string | null {
  const stack = slot === null ? null : inventory.slots[slot];
  return stack ? displayItemStackName(stack.id, stack.affix) : null;
}

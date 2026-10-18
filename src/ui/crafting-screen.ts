import type { CursorStack, ItemStack } from '../gameplay/inventory';
import type { CraftingSlot } from '../gameplay/crafting-session';
import type { IconSheet } from './icons';
import { displayName, drawText } from './pixel-font';
import {
  UI,
  drawButton,
  drawCount,
  drawInset,
  drawPanel,
  drawSlot,
  drawSlotHighlight,
  type Rect,
} from './ui-kit';

export const CRAFT_PANEL_W = 102;
export const CRAFT_PANEL_H = 118;
export const BOOK_PANEL_W = 132;
export const BOOK_PANEL_H = 186;
export const CHEST_PANEL_W = 178;
export const CHEST_PANEL_H = 240;
const CHEST_CONTENTS_START_Y = 24;
export const CRAFT_GRID_START = 28;
export const CRAFT_OUTPUT = { x: 77, y: 48, w: 18, h: 18 };
export const CRAFT_BOOK_BUTTON = { x: 8, y: 94, w: 38, h: 12 };
export const CRAFT_FILTER_BUTTON = { x: 50, y: 94, w: 44, h: 12 };
export const BOOK_SEARCH = { x: 8, y: 20, w: 116, h: 14 };
export const BOOK_FILTER = { x: 8, y: 38, w: 116, h: 12 };
export const BOOK_PREV = { x: 8, y: 164, w: 48, h: 12 };
export const BOOK_NEXT = { x: 76, y: 164, w: 48, h: 12 };
export const BOOK_LIST_START_Y = 56;
export const BOOK_ROW_H = 17;
export const BOOK_ROWS = 6;
export const CLOSE_BUTTON_RECT = { x: 162, y: 5, w: 11, h: 11 };
export const RECIPE_BASE_INVENTORY = 46;
export const RECIPE_BASE_CRAFTING = 51;

export interface BookRow {
  recipeId: string;
  resultId: string;
  craftable: boolean;
}

export interface CraftPanelView {
  x: number;
  y: number;
  scale: number;
  dimension: 2 | 3;
  grid: readonly CraftingSlot[];
  output: ItemStack | null;
  title: string;
  hoverSlots: ReadonlySet<number>;
  hoverBook: boolean;
  hoverFilter: boolean;
}

export interface RecipeBookView {
  x: number;
  y: number;
  scale: number;
  searchText: string;
  searchFocused: boolean;
  craftableOnly: boolean;
  page: number;
  pageCount: number;
  rows: readonly BookRow[];
  hoveredRow: number | null;
  hoverSearch: boolean;
  hoverFilter: boolean;
  hoverPrev: boolean;
  hoverNext: boolean;
}

export function craftGridRects(dimension: 2 | 3): Rect[] {
  const result: Rect[] = [];
  for (let y = 0; y < dimension; y++)
    for (let x = 0; x < dimension; x++)
      result.push({ x: 8 + x * 20, y: CRAFT_GRID_START + y * 20, w: 18, h: 18 });
  return result;
}

export function bookRowRects(): Rect[] {
  return Array.from({ length: BOOK_ROWS }, (_, row) => ({
    x: 8,
    y: BOOK_LIST_START_Y + row * BOOK_ROW_H,
    w: 116,
    h: 16,
  }));
}

export function chestRects(count: number): Rect[] {
  return Array.from({ length: count }, (_, slot) => ({
    x: 8 + (slot % 9) * 18,
    y: CHEST_CONTENTS_START_Y + Math.floor(slot / 9) * 18,
    w: 18,
    h: 18,
  }));
}

export function chestPlayerRects(): Rect[] {
  const rects = new Array<Rect>(36);
  for (let i = 0; i < 27; i++)
    rects[9 + i] = { x: 8 + (i % 9) * 18, y: 148 + Math.floor(i / 9) * 18, w: 18, h: 18 };
  for (let i = 0; i < 9; i++) rects[i] = { x: 8 + i * 18, y: 208, w: 18, h: 18 };
  return rects;
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

function drawStack(
  ctx: CanvasRenderingContext2D,
  icons: IconSheet,
  sheet: CanvasImageSource,
  stack: CraftingSlot | ItemStack | null,
  rect: Rect,
  scale: number,
): void {
  if (!stack) return;
  drawIcon(ctx, icons, sheet, stack.id, (rect.x + 1) * scale, (rect.y + 1) * scale, 16 * scale);
  if (stack.count > 1) drawCount(ctx, stack.count, rect.x, rect.y, scale);
}

export function drawCraftPanel(
  ctx: CanvasRenderingContext2D,
  view: CraftPanelView,
  icons: IconSheet,
  sheet: CanvasImageSource,
): { grid: Rect[]; output: Rect; book: Rect; filter: Rect } {
  const { x, y, scale: s, dimension } = view;
  drawPanel(ctx, { x, y, w: CRAFT_PANEL_W, h: CRAFT_PANEL_H }, s);
  drawText(ctx, view.title, (x + 8) * s, (y + 6) * s, s, UI.text, UI.outline);
  const grid = craftGridRects(dimension).map((r) => ({ ...r, x: r.x + x, y: r.y + y }));
  grid.forEach((rect, index) => {
    drawSlot(ctx, rect.x, rect.y, s);
    drawStack(ctx, icons, sheet, view.grid[index] ?? null, rect, s);
    if (view.hoverSlots.has(index)) drawSlotHighlight(ctx, rect.x, rect.y, s);
  });

  const output = { ...CRAFT_OUTPUT, x: CRAFT_OUTPUT.x + x, y: CRAFT_OUTPUT.y + y };
  drawText(ctx, 'RESULT', (x + 68) * s, (y + 36) * s, s, UI.text, UI.outline);
  drawSlot(ctx, output.x, output.y, s);
  drawStack(ctx, icons, sheet, view.output, output, s);
  if (view.hoverSlots.has(dimension * dimension)) drawSlotHighlight(ctx, output.x, output.y, s);

  const book = { ...CRAFT_BOOK_BUTTON, x: CRAFT_BOOK_BUTTON.x + x, y: CRAFT_BOOK_BUTTON.y + y };
  const filter = {
    ...CRAFT_FILTER_BUTTON,
    x: CRAFT_FILTER_BUTTON.x + x,
    y: CRAFT_FILTER_BUTTON.y + y,
  };
  drawButton(ctx, book, 'BOOK', s, view.hoverBook);
  drawButton(ctx, filter, 'READY', s, view.hoverFilter);
  return { grid, output, book, filter };
}

export function drawRecipeBookPanel(
  ctx: CanvasRenderingContext2D,
  view: RecipeBookView,
  icons: IconSheet,
  sheet: CanvasImageSource,
): { search: Rect; filter: Rect; rows: Rect[]; prev: Rect; next: Rect } {
  const { x, y, scale: s } = view;
  drawPanel(ctx, { x, y, w: BOOK_PANEL_W, h: BOOK_PANEL_H }, s);
  drawText(ctx, 'RECIPE BOOK', (x + 8) * s, (y + 6) * s, s, UI.text, UI.outline);

  const search = { ...BOOK_SEARCH, x: BOOK_SEARCH.x + x, y: BOOK_SEARCH.y + y };
  drawInset(ctx, search, s);
  const query = view.searchText ? view.searchText.toUpperCase() : 'SEARCH';
  drawText(
    ctx,
    query.slice(0, 16),
    (search.x + 4) * s,
    (search.y + 4) * s,
    s,
    view.searchFocused ? UI.accent : UI.text,
    UI.outline,
  );

  const filter = { ...BOOK_FILTER, x: BOOK_FILTER.x + x, y: BOOK_FILTER.y + y };
  drawButton(
    ctx,
    filter,
    view.craftableOnly ? 'CRAFTABLE ON' : 'CRAFTABLE OFF',
    s,
    view.hoverFilter,
  );

  const rows = bookRowRects().map((r) => ({ ...r, x: r.x + x, y: r.y + y }));
  rows.forEach((rect, index) => {
    const row = view.rows[index];
    drawInset(ctx, rect, s);
    if (view.hoveredRow === index) drawSlotHighlight(ctx, rect.x, rect.y, s);
    if (!row) return;
    drawIcon(ctx, icons, sheet, row.resultId, (rect.x + 2) * s, (rect.y + 1) * s, 14 * s);
    const name = displayName(row.resultId);
    drawText(
      ctx,
      name.slice(0, 14),
      (rect.x + 19) * s,
      (rect.y + 5) * s,
      s,
      row.craftable ? UI.text : UI.light,
      UI.outline,
    );
  });

  const prev = { ...BOOK_PREV, x: BOOK_PREV.x + x, y: BOOK_PREV.y + y };
  const next = { ...BOOK_NEXT, x: BOOK_NEXT.x + x, y: BOOK_NEXT.y + y };
  drawButton(ctx, prev, 'PREV', s, view.hoverPrev);
  drawButton(ctx, next, 'NEXT', s, view.hoverNext);
  const pageText = `${view.page + 1}/${Math.max(1, view.pageCount)}`;
  const pageX = x + Math.floor((BOOK_PANEL_W - pageText.length * 6) / 2);
  drawText(ctx, pageText, pageX * s, (y + 166) * s, s, UI.text, UI.outline);
  return { search, filter, rows, prev, next };
}

export function drawChestScreen(
  ctx: CanvasRenderingContext2D,
  options: {
    scale: number;
    originX: number;
    originY: number;
    inventory: readonly (ItemStack | null)[];
    chestSlots: readonly (ChestSlotLike | null)[];
    double: boolean;
    hoverSlot: number | null;
    hoverClose: boolean;
    cursor: CursorStack | null;
    mouse: { x: number; y: number };
    icons: IconSheet;
    sheet: CanvasImageSource;
  },
): { chest: Rect[]; inventory: Rect[]; close: Rect; panel: Rect } {
  const { scale: s, originX, originY } = options;
  const chest = chestRects(options.chestSlots.length);
  const inventory = chestPlayerRects();
  const panel = { x: originX, y: originY, w: CHEST_PANEL_W * s, h: CHEST_PANEL_H * s };
  ctx.save();
  ctx.translate(originX, originY);
  drawPanel(ctx, { x: 0, y: 0, w: CHEST_PANEL_W, h: CHEST_PANEL_H }, s);
  drawText(ctx, options.double ? 'DOUBLE CHEST' : 'CHEST', 8 * s, 6 * s, s, UI.text, UI.outline);
  chest.forEach((rect, index) => {
    drawSlot(ctx, rect.x, rect.y, s);
    drawStack(ctx, options.icons, options.sheet, options.chestSlots[index] ?? null, rect, s);
    if (options.hoverSlot === index) drawSlotHighlight(ctx, rect.x, rect.y, s);
  });
  drawText(ctx, 'INVENTORY', 8 * s, 136 * s, s, UI.text, UI.outline);
  inventory.forEach((rect, index) => {
    drawSlot(ctx, rect.x, rect.y, s);
    drawStack(ctx, options.icons, options.sheet, options.inventory[index] ?? null, rect, s);
    if (options.hoverSlot === options.chestSlots.length + index)
      drawSlotHighlight(ctx, rect.x, rect.y, s);
  });
  drawButton(ctx, CLOSE_BUTTON_RECT, 'X', s, options.hoverClose);
  ctx.restore();
  if (options.cursor) {
    const size = 16 * s;
    const x = options.mouse.x - size / 2;
    const y = options.mouse.y - size / 2;
    drawIcon(ctx, options.icons, options.sheet, options.cursor.id, x, y, size);
    if (options.cursor.count > 1) {
      ctx.save();
      ctx.translate(x - s, y - s);
      drawCount(ctx, options.cursor.count, 0, 0, s);
      ctx.restore();
    }
  }
  return {
    chest: chest.map((r) => ({
      x: originX + r.x * s,
      y: originY + r.y * s,
      w: r.w * s,
      h: r.h * s,
    })),
    inventory: inventory.map((r) => ({
      x: originX + r.x * s,
      y: originY + r.y * s,
      w: r.w * s,
      h: r.h * s,
    })),
    close: {
      x: originX + CLOSE_BUTTON_RECT.x * s,
      y: originY + CLOSE_BUTTON_RECT.y * s,
      w: CLOSE_BUTTON_RECT.w * s,
      h: CLOSE_BUTTON_RECT.h * s,
    },
    panel,
  };
}

export interface ChestSlotLike {
  id: string;
  count: number;
}

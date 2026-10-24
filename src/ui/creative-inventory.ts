import type { InputEngine } from '../engine/input';
import type { Player } from '../entity/player';
import { items, type ItemDefinition } from '../gameplay/items';
import type { IconSheet } from './icons';
import { OverlayPanel } from './overlay-panel';
import { drawCount, drawSlot, UI } from './ui-kit';
import { displayName, drawText } from './pixel-font';
import { settings, GUI_SCALE_CHANGE_EVENT } from '../engine/settings';
import { isActionCode } from '../engine/keybinds';

export const CREATIVE_CATEGORIES = ['all', 'block', 'gear', 'food', 'material'] as const;
export type CreativeCategory = (typeof CREATIVE_CATEGORIES)[number];
const LABELS = ['All', 'Blocks', 'Gear', 'Food', 'Materials'];
const PAGE_SIZE = 36;

export function creativeItems(category: CreativeCategory, search: string): ItemDefinition[] {
  const query = search.trim().toLowerCase();
  return [...items.items.values()]
    .filter(
      (item) =>
        item.id !== 'air' &&
        (query
          ? `${item.id} ${displayName(item.id)}`.toLowerCase().includes(query)
          : category === 'all' ||
            (category === 'gear'
              ? item.kind === 'tool' || item.kind === 'armor'
              : item.kind === category)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Has no frame hook: only opening, searches, clicks and resizing redraw it. */
export class CreativeInventory {
  private panel: OverlayPanel | null = null;
  private sheet: HTMLCanvasElement | null = null;
  private icons: IconSheet | null = null;
  private player: Player | null = null;
  private wasLocked = false;
  private category: CreativeCategory = 'all';
  private query = '';
  private page = 0;
  private hoverName = '';
  constructor(
    private readonly input: InputEngine,
    private readonly iconSource: () => IconSheet,
  ) {
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    window.addEventListener(GUI_SCALE_CHANGE_EVENT, this.onResize);
  }
  get visible(): boolean {
    return this.player !== null;
  }
  open(player: Player): void {
    if (this.visible) return;
    this.player = player;
    this.query = '';
    this.page = 0;
    this.category = 'all';
    this.wasLocked = this.input.pointerLocked;
    this.input.setCapture(true);
    if (this.wasLocked) document.exitPointerLock();
    this.panel ??= new OverlayPanel('creative-inventory', 'Creative inventory', 320, 320);
    if (!this.sheet) {
      this.icons = this.iconSource();
      this.sheet = document.createElement('canvas');
      this.sheet.width = this.icons.width;
      this.sheet.height = this.icons.height;
      this.sheet
        .getContext('2d')!
        .putImageData(new ImageData(this.icons.data, this.icons.width, this.icons.height), 0, 0);
    }
    this.panel.root.style.display = 'block';
    this.render();
  }
  close(): void {
    if (!this.player) return;
    this.player.inventory.returnCursor();
    // Creative cursor overflow is discarded, like the delete slot.
    this.player.inventory.cursor = null;
    this.player = null;
    this.panel!.root.style.display = 'none';
    this.input.setCapture(false);
    if (this.wasLocked) {
      try {
        this.input.relock()?.catch(() => {});
      } catch {
        /* Click the canvas to regain pointer lock. */
      }
    }
  }
  private readonly onResize = (): void => {
    if (this.visible) this.render();
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.visible) return;
    event.stopImmediatePropagation();
    const typing = event.target instanceof HTMLInputElement;
    if (
      isActionCode(event.code, 'menuBack', settings.keyBindings) ||
      (!typing && isActionCode(event.code, 'inventory', settings.keyBindings))
    ) {
      event.preventDefault();
      this.close();
    }
  };
  private icon(id: string, x: number, y: number): void {
    const rect = this.icons!.rects.get(id);
    if (rect) this.panel!.ctx.drawImage(this.sheet!, rect.x, rect.y, 16, 16, x, y, 16, 16);
  }
  private render(): void {
    if (!this.player || !this.panel) return;
    const p = this.panel,
      ctx = p.ctx,
      inventory = this.player.inventory;
    const focused = document.activeElement?.id === 'creative-search';
    p.begin('CREATIVE INVENTORY');
    p.button('Close', 265, 5, 47, 17, () => this.close());
    CREATIVE_CATEGORIES.forEach((category, i) => {
      const button = p.button(
        LABELS[i]!,
        8 + i * 61,
        27,
        59,
        16,
        () => {
          this.category = category;
          this.page = 0;
          this.render();
        },
        this.category === category,
      );
      button.setAttribute('role', 'tab');
    });
    const search = document.createElement('input');
    search.id = 'creative-search';
    search.type = 'search';
    search.value = this.query;
    search.placeholder = 'Search all items';
    search.setAttribute('aria-label', 'Search all items');
    search.maxLength = 80;
    Object.assign(search.style, {
      font: `${8 * p.scale}px monospace`,
      color: UI.text,
      background: UI.slot,
      border: `${p.scale}px solid ${UI.light}`,
      padding: `${3 * p.scale}px`,
    });
    p.position(search, 9, 48, 224, 18);
    search.addEventListener('input', () => {
      this.query = search.value;
      this.page = 0;
      this.render();
    });
    const matches = creativeItems(this.category, this.query);
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    p.button('PREV', 240, 48, 30, 18, () => {
      this.page = Math.max(0, this.page - 1);
      this.render();
    });
    p.button('NEXT', 276, 48, 30, 18, () => {
      this.page = Math.min(pages - 1, this.page + 1);
      this.render();
    });
    drawText(
      ctx,
      `${matches.length} ITEMS  /  ${this.page + 1} OF ${pages}`,
      10,
      69,
      1,
      UI.text,
      UI.outline,
    );
    const grid = document.createElement('div');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Creative items');
    p.controls.append(grid);
    matches.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).forEach((item, i) => {
      const x = 14 + (i % 9) * 33,
        y = 81 + Math.floor(i / 9) * 27;
      drawSlot(ctx, x, y, 1);
      this.icon(item.id, x + 1, y + 1);
      const button = p.hit(displayName(item.id), x - 1, y - 1, 24, 24, () => {
        inventory.cursor = { id: item.id, count: item.maxStack };
        this.hoverName = displayName(item.id);
        this.render();
      });
      button.dataset.itemId = item.id;
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        inventory.cursor = { id: item.id, count: 1 };
        this.render();
      });
      grid.append(button);
    });
    if (!matches.length) drawText(ctx, 'NO MATCHING ITEMS', 14, 100, 1, UI.accent, UI.outline);
    drawText(ctx, 'PLAYER INVENTORY', 10, 191, 1, UI.text, UI.outline);
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 9; column++) {
        const slot = row === 3 ? column : 9 + row * 9 + column;
        const x = 14 + column * 27,
          y = 205 + row * 21;
        drawSlot(ctx, x, y, 1);
        const stack = inventory.slots[slot];
        if (stack) {
          this.icon(stack.id, x + 1, y + 1);
          drawCount(ctx, stack.count, x, y, 1);
        }
        const button = p.hit(
          `Inventory slot ${slot}${stack ? `: ${displayName(stack.id)} ${stack.count}` : ': empty'}`,
          x,
          y,
          18,
          18,
          () => {
            inventory.leftClick(slot);
            this.render();
          },
        );
        button.dataset.inventorySlot = String(slot);
        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          inventory.rightClick(slot);
          this.render();
        });
      }
    p.button('DELETE', 261, 207, 49, 29, () => {
      inventory.cursor = null;
      this.render();
    });
    drawText(ctx, 'CURSOR', 261, 245, 1, UI.text, UI.outline);
    if (inventory.cursor) {
      drawSlot(ctx, 272, 258, 1);
      this.icon(inventory.cursor.id, 273, 259);
      drawCount(ctx, inventory.cursor.count, 272, 258, 1);
    }
    drawText(
      ctx,
      (inventory.cursor
        ? displayName(inventory.cursor.id)
        : this.hoverName || 'TAKE A STACK. BUILD SOMETHING.'
      ).slice(0, 48),
      10,
      295,
      1,
      UI.accent,
      UI.outline,
    );
    drawText(ctx, 'GRID STACKS NEVER RUN OUT', 10, 308, 1, UI.text, UI.outline);
    if (focused) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }
}

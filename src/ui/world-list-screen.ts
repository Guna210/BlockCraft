import type { InputEngine } from '../engine/input';
import type { WorldManager } from '../world/world-manager';
import type { WorldRecord } from '../persist/world-store';
import { drawButton, drawInset, drawPanel, fillRect, UI, uiScaleFor, type Rect } from './ui-kit';
import { drawText, textWidth } from './pixel-font';

const PANEL_W = 300;
const PANEL_H = 226;
const ROW_H = 50;
const ROW_GAP = 3;
const VISIBLE_ROWS = 3;
const THUMB_W = 64;
const THUMB_H = 36;
const BUTTONS = [
  { action: 'select', label: 'SELECT', width: 41 },
  { action: 'rename', label: 'RENAME', width: 43 },
  { action: 'duplicate', label: 'COPY', width: 33 },
  { action: 'delete', label: 'DELETE', width: 42 },
] as const;

type Modal =
  | { kind: 'create'; draft: string; error: string | null }
  | { kind: 'rename'; source: string; draft: string; error: string | null }
  | { kind: 'duplicate'; source: string; draft: string; error: string | null }
  | { kind: 'delete'; source: string; error: string | null };

interface WorldRowLayout {
  card: Rect;
  thumbnail: Rect;
  buttons: Record<(typeof BUTTONS)[number]['action'], Rect>;
}

function worldTime(timestamp: number): string {
  const date = new Date(timestamp);
  const part = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
}

function compareWorlds(a: WorldRecord, b: WorldRecord): number {
  return b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name);
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (word.length > maxChars) {
      if (line) lines.push(line);
      line = '';
      for (let start = 0; start < word.length; start += maxChars)
        lines.push(word.slice(start, start + maxChars));
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, rect: Rect, scale: number): void {
  const cell = 4;
  const pixel = (x: number, y: number, w: number, h: number, color: string) =>
    fillRect(ctx, rect.x + x * cell, rect.y + y * cell, w * cell, h * cell, color, scale);

  pixel(0, 0, 16, 9, '#79b8d8');
  pixel(12, 1, 2, 2, UI.accent);
  pixel(2, 1, 3, 1, '#e8e2c6');
  pixel(1, 2, 5, 1, '#e8e2c6');
  pixel(7, 3, 3, 1, '#e8e2c6');
  pixel(8, 2, 2, 1, '#e8e2c6');
  pixel(0, 5, 4, 1, '#3f6b24');
  pixel(1, 4, 2, 1, '#3f6b24');
  pixel(11, 5, 5, 1, '#3f6b24');
  pixel(12, 4, 3, 1, '#3f6b24');
  pixel(0, 6, 16, 1, '#63a038');
  pixel(0, 7, 16, 2, '#72513a');
  pixel(3, 3, 1, 3, '#45311f');
  pixel(2, 3, 3, 2, '#3f7a2c');
  pixel(2, 2, 2, 1, '#63a038');
  pixel(4, 2, 2, 1, '#3f7a2c');
  pixel(5, 3, 1, 2, '#3f7a2c');
  pixel(9, 5, 1, 1, '#45311f');
  pixel(8, 4, 3, 1, '#3f7a2c');
}

/** Pixel-font world list overlay; independent of a running player or the M18 menu flow. */
export class WorldListScreen {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opened = false;
  private wasLocked = false;
  private rows: WorldRecord[] = [];
  private bitmaps = new Map<string, ImageBitmap>();
  private refreshId = 0;
  private selectedName: string | null = null;
  private scrollOffset = 0;
  private modal: Modal | null = null;
  private busy = false;
  private message: string | null = null;
  private dpr = 1;
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private mouse = { x: -1, y: -1 };

  constructor(
    private readonly input: InputEngine,
    private readonly manager: WorldManager,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'world-list-canvas';
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Saved worlds');
    this.canvas.tabIndex = 0;
    this.ctx = this.canvas.getContext('2d')!;
    Object.assign(this.canvas.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      display: 'none',
      imageRendering: 'pixelated',
      cursor: 'default',
      zIndex: '8',
    });
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.appendChild(this.canvas);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  async open(): Promise<void> {
    if (!this.opened) {
      this.opened = true;
      this.wasLocked = this.input.pointerLocked;
      this.input.setCapture(true);
      if (this.wasLocked) document.exitPointerLock();
      this.canvas.style.display = 'block';
      this.resize();
      this.modal = null;
      this.message = null;
      this.scrollOffset = 0;
    }
    await this.refresh();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.modal = null;
    this.busy = false;
    this.canvas.style.display = 'none';
    this.refreshId++;
    for (const bitmap of this.bitmaps.values()) bitmap.close();
    this.bitmaps.clear();
    this.input.setCapture(false);
    if (this.wasLocked) {
      try {
        const lock = this.input.relock();
        if (lock) lock.catch(() => {});
      } catch {
        // The browser can decline pointer lock; the next game click can request it again.
      }
    }
  }

  private async refresh(selectName?: string): Promise<void> {
    const refreshId = ++this.refreshId;
    const records = (await this.manager.saves.listWorlds()).sort(compareWorlds);
    if (!this.opened || refreshId !== this.refreshId) return;
    for (const bitmap of this.bitmaps.values()) bitmap.close();
    this.bitmaps.clear();
    this.rows = records;
    this.selectedName =
      (selectName && records.some((record) => record.name === selectName) ? selectName : null) ??
      (this.selectedName && records.some((record) => record.name === this.selectedName)
        ? this.selectedName
        : (records[0]?.name ?? null));
    if (this.selectedName) {
      const selectedIndex = records.findIndex((record) => record.name === this.selectedName);
      this.scrollOffset = Math.min(
        Math.max(0, selectedIndex - VISIBLE_ROWS + 1),
        Math.max(0, records.length - VISIBLE_ROWS),
      );
    }
    const loaded = await Promise.all(
      records.map(async (record) => {
        if (!record.thumbnail) return null;
        try {
          return [record.name, await createImageBitmap(record.thumbnail)] as const;
        } catch {
          return null;
        }
      }),
    );
    if (!this.opened || refreshId !== this.refreshId) {
      for (const entry of loaded) entry?.[1].close();
      return;
    }
    for (const entry of loaded) if (entry) this.bitmaps.set(entry[0], entry[1]);
    this.render();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.dpr));
    this.scale = uiScaleFor(this.canvas.width, this.canvas.height);
    this.originX = Math.floor((this.canvas.width / this.scale - PANEL_W) / 2);
    this.originY = Math.floor((this.canvas.height / this.scale - PANEL_H) / 2);
  }

  private panel(): Rect {
    return { x: this.originX, y: this.originY, w: PANEL_W, h: PANEL_H };
  }

  private rowLayout(visibleIndex: number): WorldRowLayout {
    const panel = this.panel();
    const card = {
      x: panel.x + 8,
      y: panel.y + 28 + visibleIndex * (ROW_H + ROW_GAP),
      w: PANEL_W - 16,
      h: ROW_H,
    };
    const thumbnail = { x: card.x + 3, y: card.y + 5, w: THUMB_W, h: THUMB_H };
    const buttonY = card.y + 31;
    let buttonX = card.x + 72;
    const buttons = {} as WorldRowLayout['buttons'];
    for (const button of BUTTONS) {
      buttons[button.action] = { x: buttonX, y: buttonY, w: button.width, h: 15 };
      buttonX += button.width + 2;
    }
    return { card, thumbnail, buttons };
  }

  private footerButtons(): { create: Rect; back: Rect } {
    const panel = this.panel();
    return {
      create: { x: panel.x + 8, y: panel.y + 196, w: 78, h: 18 },
      back: { x: panel.x + PANEL_W - 42, y: panel.y + 196, w: 34, h: 18 },
    };
  }

  private modalRects(): { panel: Rect; field: Rect; confirm: Rect; cancel: Rect } {
    const panel = {
      x: this.originX + Math.floor((PANEL_W - 236) / 2),
      y: this.originY + Math.floor((PANEL_H - 112) / 2),
      w: 236,
      h: 112,
    };
    return {
      panel,
      field: { x: panel.x + 9, y: panel.y + 34, w: panel.w - 18, h: 16 },
      cancel: { x: panel.x + 111, y: panel.y + 87, w: 48, h: 17 },
      confirm: { x: panel.x + 167, y: panel.y + 87, w: 59, h: 17 },
    };
  }

  private accessibleLabel(): string {
    const pending = this.busy ? 'Working. ' : '';
    if (this.modal?.kind === 'delete')
      return `${pending}Confirm deleting world ${this.modal.source}. Cancel or delete.`;
    if (this.modal)
      return `${pending}${this.modal.kind} world name. ${this.modal.draft}${this.modal.error ? `. ${this.modal.error}` : ''}`;
    const list = this.rows
      .map((record) => `${record.name}, last played ${worldTime(record.lastPlayed)}`)
      .join('. ');
    return `${pending}Saved worlds. ${list}${this.selectedName ? `. Selected ${this.selectedName}` : ''}${this.message ? `. ${this.message}` : ''}`;
  }

  private render(): void {
    if (!this.opened) return;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(9, 11, 20, 0.72)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const panel = this.panel();
    drawPanel(this.ctx, panel, this.scale);
    drawText(
      this.ctx,
      'SAVED WORLDS',
      (panel.x + 10) * this.scale,
      (panel.y + 9) * this.scale,
      this.scale,
      UI.text,
      UI.outline,
    );
    drawText(
      this.ctx,
      `${this.rows.length} WORLDS`,
      (panel.x + PANEL_W - 62) * this.scale,
      (panel.y + 10) * this.scale,
      this.scale,
      UI.text,
      UI.outline,
    );

    const visible = this.rows.slice(this.scrollOffset, this.scrollOffset + VISIBLE_ROWS);
    if (visible.length === 0) {
      drawText(
        this.ctx,
        'NO SAVED WORLDS',
        (panel.x + 96) * this.scale,
        (panel.y + 90) * this.scale,
        this.scale,
        UI.text,
        UI.outline,
      );
    }
    visible.forEach((record, visibleIndex) => this.renderRow(record, visibleIndex));

    const footer = this.footerButtons();
    drawButton(
      this.ctx,
      footer.create,
      'CREATE',
      this.scale,
      contains(footer.create, this.mouse.x, this.mouse.y),
    );
    drawButton(
      this.ctx,
      footer.back,
      'BACK',
      this.scale,
      contains(footer.back, this.mouse.x, this.mouse.y),
    );
    if (this.rows.length > VISIBLE_ROWS) {
      const scroll = `${this.scrollOffset + 1}-${Math.min(this.rows.length, this.scrollOffset + VISIBLE_ROWS)} / ${this.rows.length}`;
      drawText(
        this.ctx,
        scroll,
        (panel.x + 112) * this.scale,
        (panel.y + 202) * this.scale,
        this.scale,
        UI.text,
        UI.outline,
      );
    }
    if (this.message) {
      drawText(
        this.ctx,
        this.message,
        (panel.x + 95) * this.scale,
        (panel.y + 203) * this.scale,
        this.scale,
        UI.accent,
        UI.outline,
      );
    }

    this.canvas.setAttribute('aria-label', this.accessibleLabel());
    if (this.modal) this.renderModal(this.modal);
  }

  private renderRow(record: WorldRecord, visibleIndex: number): void {
    const layout = this.rowLayout(visibleIndex);
    const selected = record.name === this.selectedName;
    if (selected) {
      fillRect(
        this.ctx,
        layout.card.x,
        layout.card.y,
        layout.card.w,
        layout.card.h,
        UI.accent,
        this.scale,
      );
      fillRect(
        this.ctx,
        layout.card.x + 1,
        layout.card.y + 1,
        layout.card.w - 2,
        layout.card.h - 2,
        UI.panel,
        this.scale,
      );
    } else drawPanel(this.ctx, layout.card, this.scale);

    const thumbnailFrame = {
      x: layout.thumbnail.x - 1,
      y: layout.thumbnail.y - 1,
      w: THUMB_W + 2,
      h: THUMB_H + 2,
    };
    drawInset(this.ctx, thumbnailFrame, this.scale);
    const bitmap = this.bitmaps.get(record.name);
    if (bitmap)
      this.ctx.drawImage(
        bitmap,
        layout.thumbnail.x * this.scale,
        layout.thumbnail.y * this.scale,
        layout.thumbnail.w * this.scale,
        layout.thumbnail.h * this.scale,
      );
    else drawPlaceholder(this.ctx, layout.thumbnail, this.scale);

    const name = record.name.toUpperCase();
    const nameMax = Math.floor((layout.card.w - 80) / 6);
    const shownName = [...name].slice(0, nameMax).join('');
    drawText(
      this.ctx,
      shownName,
      (layout.card.x + 72) * this.scale,
      (layout.card.y + 5) * this.scale,
      this.scale,
      UI.text,
      UI.outline,
    );
    drawText(
      this.ctx,
      worldTime(record.lastPlayed),
      (layout.card.x + 72) * this.scale,
      (layout.card.y + 17) * this.scale,
      this.scale,
      UI.text,
      UI.outline,
    );

    for (const button of BUTTONS) {
      const rect = layout.buttons[button.action];
      drawButton(
        this.ctx,
        rect,
        button.label,
        this.scale,
        contains(rect, this.mouse.x, this.mouse.y),
      );
    }
  }

  private renderModal(modal: Modal): void {
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const rects = this.modalRects();
    drawPanel(this.ctx, rects.panel, this.scale);
    const title =
      modal.kind === 'create'
        ? 'CREATE WORLD'
        : modal.kind === 'rename'
          ? 'RENAME WORLD'
          : modal.kind === 'duplicate'
            ? 'DUPLICATE WORLD'
            : 'DELETE WORLD?';
    drawText(
      this.ctx,
      title,
      (rects.panel.x + 9) * this.scale,
      (rects.panel.y + 9) * this.scale,
      this.scale,
      UI.text,
      UI.outline,
    );

    if (modal.kind === 'delete') {
      drawText(
        this.ctx,
        modal.source.toUpperCase(),
        (rects.panel.x + 9) * this.scale,
        (rects.panel.y + 25) * this.scale,
        this.scale,
        UI.accent,
        UI.outline,
      );
      drawText(
        this.ctx,
        'ALL SAVED DATA WILL BE REMOVED',
        (rects.panel.x + 9) * this.scale,
        (rects.panel.y + 43) * this.scale,
        this.scale,
        UI.text,
        UI.outline,
      );
    } else {
      drawInset(this.ctx, rects.field, this.scale);
      const draft = modal.draft.toUpperCase();
      const maxChars = Math.floor((rects.field.w - 8) / 6);
      const shown = [...draft].slice(-maxChars).join('');
      drawText(
        this.ctx,
        shown,
        (rects.field.x + 4) * this.scale,
        (rects.field.y + 5) * this.scale,
        this.scale,
        UI.text,
        UI.outline,
      );
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        const caretX = rects.field.x + 4 + textWidth(shown);
        fillRect(this.ctx, caretX, rects.field.y + 4, 1, 9, UI.accent, this.scale);
      }
    }

    if (modal.error) {
      const lines = wrapText(modal.error.toUpperCase(), 32).slice(0, 2);
      lines.forEach((line, index) =>
        drawText(
          this.ctx,
          line,
          (rects.panel.x + 9) * this.scale,
          (rects.panel.y + (modal.kind === 'delete' ? 61 : 55) + index * 9) * this.scale,
          this.scale,
          UI.accent,
          UI.outline,
        ),
      );
    }
    const confirmLabel =
      modal.kind === 'delete'
        ? 'DELETE'
        : modal.kind === 'create'
          ? 'CREATE'
          : modal.kind === 'rename'
            ? 'SAVE'
            : 'COPY';
    drawButton(
      this.ctx,
      rects.cancel,
      'CANCEL',
      this.scale,
      contains(rects.cancel, this.mouse.x, this.mouse.y),
    );
    drawButton(
      this.ctx,
      rects.confirm,
      this.busy ? 'WAIT' : confirmLabel,
      this.scale,
      contains(rects.confirm, this.mouse.x, this.mouse.y),
    );
  }

  private async submitModal(): Promise<void> {
    const modal = this.modal;
    if (!modal || modal.kind === 'delete' || this.busy) return;
    const name = modal.draft.trim();
    const length = Array.from(name).length;
    if (length < 1 || length > 32) {
      modal.error = 'World names must be 1 to 32 characters.';
      this.render();
      return;
    }
    if (
      this.rows.some(
        (record) =>
          record.name === name && (modal.kind === 'create' || record.name !== modal.source),
      )
    ) {
      modal.error = `A world named '${name}' already exists.`;
      this.render();
      return;
    }

    this.busy = true;
    modal.error = null;
    this.render();
    try {
      if (modal.kind === 'create') {
        await this.manager.createWorld({ name, seed: name, mode: 'survival', type: 'default' });
        await this.manager.save();
        this.close();
        return;
      }
      if (modal.kind === 'rename') {
        await this.manager.saves.renameWorld(modal.source, name);
      } else {
        await this.manager.saves.duplicateWorld(modal.source, name);
      }
      this.modal = null;
      this.message = null;
      await this.refresh(name);
    } catch (error) {
      modal.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async confirmDelete(): Promise<void> {
    const modal = this.modal;
    if (modal?.kind !== 'delete' || this.busy) return;
    this.busy = true;
    modal.error = null;
    this.render();
    try {
      await this.manager.saves.deleteWorld(modal.source);
      this.modal = null;
      this.message = null;
      await this.refresh();
    } catch (error) {
      modal.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async selectWorld(name: string): Promise<void> {
    if (this.busy) return;
    this.selectedName = name;
    this.busy = true;
    this.message = null;
    this.render();
    try {
      await this.manager.loadWorld(name);
      this.close();
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private handleRowAction(action: (typeof BUTTONS)[number]['action'], record: WorldRecord): void {
    this.selectedName = record.name;
    this.message = null;
    if (action === 'select') {
      void this.selectWorld(record.name);
      return;
    }
    if (action === 'rename') {
      this.modal = { kind: 'rename', source: record.name, draft: record.name, error: null };
    } else if (action === 'duplicate') {
      this.modal = {
        kind: 'duplicate',
        source: record.name,
        draft: `${record.name} Copy`,
        error: null,
      };
    } else {
      this.modal = { kind: 'delete', source: record.name, error: null };
    }
    this.render();
  }

  private eventPosition(event: MouseEvent): { x: number; y: number } {
    return {
      x: (event.clientX * this.dpr) / this.scale,
      y: (event.clientY * this.dpr) / this.scale,
    };
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.opened) return;
    this.mouse = this.eventPosition(event);
    this.render();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    if (!this.opened || event.button !== 0 || this.busy) return;
    const { x, y } = this.eventPosition(event);
    if (this.modal) {
      const modal = this.modal;
      const rects = this.modalRects();
      if (contains(rects.cancel, x, y)) {
        this.modal = null;
        this.render();
      } else if (contains(rects.confirm, x, y)) {
        if (modal.kind === 'delete') void this.confirmDelete();
        else void this.submitModal();
      }
      return;
    }

    const footer = this.footerButtons();
    if (contains(footer.create, x, y)) {
      this.modal = { kind: 'create', draft: '', error: null };
      this.render();
      return;
    }
    if (contains(footer.back, x, y)) return this.close();

    const visible = this.rows.slice(this.scrollOffset, this.scrollOffset + VISIBLE_ROWS);
    for (let index = 0; index < visible.length; index++) {
      const record = visible[index]!;
      const layout = this.rowLayout(index);
      for (const button of BUTTONS) {
        if (contains(layout.buttons[button.action], x, y)) {
          this.handleRowAction(button.action, record);
          return;
        }
      }
      if (contains(layout.card, x, y)) {
        this.selectedName = record.name;
        this.render();
        return;
      }
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.opened || this.modal || this.rows.length <= VISIBLE_ROWS) return;
    event.preventDefault();
    this.scrollOffset = Math.max(
      0,
      Math.min(this.rows.length - VISIBLE_ROWS, this.scrollOffset + (event.deltaY > 0 ? 1 : -1)),
    );
    this.render();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.opened || event.repeat) return;
    if (this.modal) {
      event.preventDefault();
      const modal = this.modal;
      if (event.key === 'Escape' && !this.busy) {
        this.modal = null;
        return this.render();
      }
      if (event.key === 'Enter') {
        if (modal.kind === 'delete') void this.confirmDelete();
        else void this.submitModal();
        return;
      }
      if (modal.kind === 'delete' || this.busy) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') modal.draft = '';
      else if (event.key === 'Backspace')
        modal.draft = Array.from(modal.draft).slice(0, -1).join('');
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
        modal.draft += event.key;
      modal.error = null;
      this.render();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.rows.length === 0) return;
      const selected = this.rows.findIndex((record) => record.name === this.selectedName);
      const next = Math.max(
        0,
        Math.min(this.rows.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      this.selectedName = this.rows[next]!.name;
      this.scrollOffset = Math.min(
        Math.max(0, next - VISIBLE_ROWS + 1),
        Math.max(0, this.rows.length - VISIBLE_ROWS),
      );
      this.render();
    }
  };

  private readonly onResize = (): void => {
    if (!this.opened) return;
    this.resize();
    this.render();
  };
}

export const activeWorldList: { screen: WorldListScreen | null } = { screen: null };

/** Exposed for unit coverage of the local-date presentation. */
export const formatWorldListTime = worldTime;

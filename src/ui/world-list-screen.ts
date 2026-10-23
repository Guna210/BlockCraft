import type { InputEngine } from '../engine/input';
import type { WorldManager } from '../world/world-manager';
import type { WorldRecord } from '../persist/world-store';
import { drawButton, drawInset, drawPanel, fillRect, UI, uiScaleFor, type Rect } from './ui-kit';
import { isActionCode } from '../engine/keybinds';
import { settings } from '../engine/settings';
import { drawText, textWidth } from './pixel-font';
import { OVERWORLD_BIOME_IDS, type OverworldBiomeId } from '../gen/biomes';
import { WORLD_TYPES, type WorldType } from '../gen/world-options';

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
  | { kind: 'rename'; source: string; draft: string; error: string | null }
  | { kind: 'duplicate'; source: string; draft: string; error: string | null }
  | { kind: 'delete'; source: string; error: string | null };

/** The Create World screen's fields (SPEC M18, decisions/M18a-menus.md). */
interface CreateForm {
  name: string;
  /** The default name is selected: the first typed character replaces it. */
  nameSelected: boolean;
  seed: string;
  focus: 'name' | 'seed';
  mode: 'survival' | 'creative';
  type: WorldType;
  biome: OverworldBiomeId;
  structures: boolean;
  startingChest: boolean;
  error: string | null;
}

type CreateToggle = 'mode' | 'type' | 'biome' | 'structures' | 'startingChest';

interface CreateLayout {
  panel: Rect;
  name: Rect;
  seed: Rect;
  toggles: Partial<Record<CreateToggle, Rect>>;
  cancel: Rect;
  create: Rect;
}

export const DEFAULT_WORLD_NAME = 'New World';
const SEED_MAX_CHARS = 64;

const TYPE_LABELS: Record<WorldType, string> = {
  default: 'DEFAULT',
  flat: 'FLAT',
  amplified: 'AMPLIFIED',
  single_biome: 'SINGLE BIOME',
};

/** A random seed string for a Create World screen left with an empty seed. */
export function randomSeedString(random: () => number = Math.random): string {
  let digits = String(1 + Math.floor(random() * 9));
  for (let i = 0; i < 11; i++) digits += String(Math.floor(random() * 10));
  return digits;
}

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
  private form: CreateForm | null = null;
  private busy = false;
  /** Called with the seed text after the Create World screen made a world (main.ts shows it). */
  public onWorldCreated: ((name: string, seed: string) => void) | null = null;
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
      this.form = null;
      this.message = null;
      this.scrollOffset = 0;
    }
    await this.refresh();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.modal = null;
    this.form = null;
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
    if (this.form) {
      const f = this.form;
      const type = f.type === 'single_biome' ? `single biome ${f.biome}` : f.type;
      return `${pending}Create world name. ${f.name}. Seed ${f.seed || 'random'}. Mode ${f.mode}. Type ${type}. Structures ${f.structures ? 'on' : 'off'}. Starting chest ${f.startingChest ? 'on' : 'off'}${f.error ? `. ${f.error}` : ''}`;
    }
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
    if (this.form) this.renderCreate(this.form);
  }

  /**
   * The Create World screen's layout. Cancel and Create sit where the M17c name prompt had its
   * buttons, so clicking through that prompt keeps working.
   */
  private createLayout(): CreateLayout {
    const panel = { x: this.originX, y: this.originY, w: PANEL_W, h: 190 };
    const left = (y: number) => ({ x: panel.x + 9, y: panel.y + y, w: 138, h: 17 });
    const right = (y: number) => ({ x: panel.x + 153, y: panel.y + y, w: 138, h: 17 });
    const { cancel, confirm } = this.modalRects();
    const toggles: CreateLayout['toggles'] = {
      mode: left(84),
      type: right(84),
      structures: left(104),
      startingChest: right(104),
    };
    if (this.form?.type === 'single_biome') toggles.biome = left(124);
    return {
      panel,
      name: { x: panel.x + 9, y: panel.y + 31, w: PANEL_W - 18, h: 16 },
      seed: { x: panel.x + 9, y: panel.y + 61, w: PANEL_W - 18, h: 16 },
      toggles,
      cancel,
      create: confirm,
    };
  }

  private toggleLabel(form: CreateForm, toggle: CreateToggle): string {
    switch (toggle) {
      case 'mode':
        return `MODE: ${form.mode.toUpperCase()}`;
      case 'type':
        return `TYPE: ${TYPE_LABELS[form.type]}`;
      case 'biome':
        return `BIOME: ${form.biome.replace(/_/g, ' ').toUpperCase()}`;
      case 'structures':
        return `STRUCTURES: ${form.structures ? 'ON' : 'OFF'}`;
      case 'startingChest':
        return `START CHEST: ${form.startingChest ? 'ON' : 'OFF'}`;
    }
  }

  private renderCreate(form: CreateForm): void {
    const s = this.scale;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const layout = this.createLayout();
    drawPanel(this.ctx, layout.panel, s);
    const label = (text: string, x: number, y: number, color: string = UI.text) =>
      drawText(this.ctx, text, x * s, y * s, s, color, UI.outline);
    label('CREATE NEW WORLD', layout.panel.x + 9, layout.panel.y + 9);
    label('WORLD NAME', layout.name.x, layout.name.y - 9);
    label('SEED (LEAVE EMPTY FOR RANDOM)', layout.seed.x, layout.seed.y - 9);

    const field = (rect: Rect, text: string, focused: boolean, selected: boolean) => {
      drawInset(this.ctx, rect, s);
      if (focused) {
        fillRect(this.ctx, rect.x, rect.y, rect.w, 1, UI.accent, s);
        fillRect(this.ctx, rect.x, rect.y + rect.h - 1, rect.w, 1, UI.accent, s);
      }
      const maxChars = Math.floor((rect.w - 8) / 6);
      const shown = [...text.toUpperCase()].slice(-maxChars).join('');
      if (selected && shown)
        fillRect(this.ctx, rect.x + 3, rect.y + 3, textWidth(shown) + 2, 11, UI.shade, s);
      drawText(this.ctx, shown, (rect.x + 4) * s, (rect.y + 5) * s, s, UI.text, UI.outline);
      if (focused && !selected && Math.floor(performance.now() / 500) % 2 === 0)
        fillRect(this.ctx, rect.x + 4 + textWidth(shown) + 1, rect.y + 4, 1, 9, UI.accent, s);
    };
    field(layout.name, form.name, form.focus === 'name', form.nameSelected);
    field(layout.seed, form.seed, form.focus === 'seed', false);

    for (const [toggle, rect] of Object.entries(layout.toggles) as Array<[CreateToggle, Rect]>)
      drawButton(
        this.ctx,
        rect,
        this.toggleLabel(form, toggle),
        s,
        contains(rect, this.mouse.x, this.mouse.y),
      );
    drawButton(
      this.ctx,
      layout.cancel,
      'CANCEL',
      s,
      contains(layout.cancel, this.mouse.x, this.mouse.y),
    );
    drawButton(
      this.ctx,
      layout.create,
      this.busy ? 'WAIT' : 'CREATE',
      s,
      contains(layout.create, this.mouse.x, this.mouse.y),
    );
    if (form.error) {
      wrapText(form.error.toUpperCase(), 46)
        .slice(0, 2)
        .forEach((line, index) =>
          label(line, layout.panel.x + 9, layout.panel.y + 167 + index * 9, UI.accent),
        );
    }
  }

  private openCreate(): void {
    this.form = {
      name: DEFAULT_WORLD_NAME,
      nameSelected: true,
      seed: '',
      focus: 'name',
      mode: 'survival',
      type: 'default',
      biome: OVERWORLD_BIOME_IDS[0],
      structures: true,
      startingChest: false,
      error: null,
    };
    this.message = null;
    this.render();
  }

  private cycle(form: CreateForm, toggle: CreateToggle): void {
    const next = <T>(values: readonly T[], value: T): T =>
      values[(values.indexOf(value) + 1) % values.length]!;
    if (toggle === 'mode') form.mode = form.mode === 'survival' ? 'creative' : 'survival';
    else if (toggle === 'type') form.type = next(WORLD_TYPES, form.type);
    else if (toggle === 'biome') form.biome = next(OVERWORLD_BIOME_IDS, form.biome);
    else if (toggle === 'structures') form.structures = !form.structures;
    else form.startingChest = !form.startingChest;
    form.error = null;
  }

  private async submitCreate(): Promise<void> {
    const form = this.form;
    if (!form || this.busy) return;
    const name = form.name.trim();
    const length = Array.from(name).length;
    if (length < 1 || length > 32) {
      form.error = 'World names must be 1 to 32 characters.';
      this.render();
      return;
    }
    if (this.rows.some((record) => record.name === name)) {
      form.error = `A world named '${name}' already exists.`;
      this.render();
      return;
    }
    const seed = form.seed.trim() || randomSeedString();
    this.busy = true;
    form.error = null;
    this.render();
    try {
      await this.manager.createWorld({
        name,
        seed,
        mode: form.mode,
        type: form.type,
        ...(form.type === 'single_biome' ? { biome: form.biome } : {}),
        structures: form.structures,
        startingChest: form.startingChest,
      });
      await this.manager.save();
      this.close();
      this.onWorldCreated?.(name, seed);
    } catch (error) {
      form.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private onCreateMouseDown(form: CreateForm, x: number, y: number): void {
    const layout = this.createLayout();
    if (contains(layout.cancel, x, y)) {
      this.form = null;
    } else if (contains(layout.create, x, y)) {
      void this.submitCreate();
      return;
    } else if (contains(layout.name, x, y)) {
      form.focus = 'name';
      form.nameSelected = false;
    } else if (contains(layout.seed, x, y)) {
      form.focus = 'seed';
      form.nameSelected = false;
    } else {
      for (const [toggle, rect] of Object.entries(layout.toggles) as Array<[CreateToggle, Rect]>)
        if (contains(rect, x, y)) this.cycle(form, toggle);
    }
    this.render();
  }

  private onCreateKeyDown(form: CreateForm, event: KeyboardEvent): void {
    event.preventDefault();
    if (isActionCode(event.code, 'menuBack', settings.keyBindings) && !this.busy) {
      this.form = null;
      return this.render();
    }
    if (isActionCode(event.code, 'menuConfirm', settings.keyBindings))
      return void this.submitCreate();
    if (this.busy) return;
    if (event.key === 'Tab') {
      form.focus = form.focus === 'name' ? 'seed' : 'name';
      form.nameSelected = false;
      return this.render();
    }
    const key = form.focus;
    let text = form[key];
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') text = '';
    else if (event.key === 'Backspace')
      text = key === 'name' && form.nameSelected ? '' : Array.from(text).slice(0, -1).join('');
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
      text = (key === 'name' && form.nameSelected ? '' : text) + event.key;
    else return;
    form[key] = key === 'seed' ? Array.from(text).slice(0, SEED_MAX_CHARS).join('') : text;
    form.nameSelected = false;
    form.error = null;
    this.render();
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
      modal.kind === 'rename'
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
      modal.kind === 'delete' ? 'DELETE' : modal.kind === 'rename' ? 'SAVE' : 'COPY';
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
    if (this.rows.some((record) => record.name === name && record.name !== modal.source)) {
      modal.error = `A world named '${name}' already exists.`;
      this.render();
      return;
    }

    this.busy = true;
    modal.error = null;
    this.render();
    try {
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
    if (this.form) return this.onCreateMouseDown(this.form, x, y);
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
    if (contains(footer.create, x, y)) return this.openCreate();
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
    if (!this.opened || this.modal || this.form || this.rows.length <= VISIBLE_ROWS) return;
    event.preventDefault();
    this.scrollOffset = Math.max(
      0,
      Math.min(this.rows.length - VISIBLE_ROWS, this.scrollOffset + (event.deltaY > 0 ? 1 : -1)),
    );
    this.render();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.opened || event.repeat) return;
    if (this.form) return this.onCreateKeyDown(this.form, event);
    if (this.modal) {
      event.preventDefault();
      const modal = this.modal;
      if (isActionCode(event.code, 'menuBack', settings.keyBindings) && !this.busy) {
        this.modal = null;
        return this.render();
      }
      if (isActionCode(event.code, 'menuConfirm', settings.keyBindings)) {
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
    if (isActionCode(event.code, 'menuBack', settings.keyBindings)) {
      event.preventDefault();
      this.close();
    } else if (
      isActionCode(event.code, 'menuDown', settings.keyBindings) ||
      isActionCode(event.code, 'menuUp', settings.keyBindings)
    ) {
      event.preventDefault();
      if (this.rows.length === 0) return;
      const selected = this.rows.findIndex((record) => record.name === this.selectedName);
      const next = Math.max(
        0,
        Math.min(
          this.rows.length - 1,
          selected + (isActionCode(event.code, 'menuDown', settings.keyBindings) ? 1 : -1),
        ),
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

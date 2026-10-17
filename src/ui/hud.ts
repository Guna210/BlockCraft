import type { InputEngine } from '../engine/input';
import type { PlayerController } from '../engine/player-controller';
import { items } from '../gameplay/items';
import type { Player } from '../entity/player';
import { displayName, drawText, textWidth } from './pixel-font';
import type { IconSheet } from './icons';
import { UI, drawCount, drawInset, drawPanel, drawSlot, fillRect, uiScaleFor } from './ui-kit';

const HEART: readonly string[] = [
  '..##.##..',
  '.#######.',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
  '.........',
];
const CARROT: readonly string[] = [
  '...LLL...',
  '...LLLL..',
  '...LLLL..',
  'BBBBBBBBB',
  'BBBBBBBBB',
  '.BBBBBBBB',
  '...BBBBBB',
  '......BBB',
  '........B',
];
const HEART_PALETTE = {
  outline: '#4a1528',
  empty: '#4a4248',
  shadow: '#8f1d35',
  mid: '#c82a44',
  red: '#ea455b',
  pink: '#ff93a3',
  highlight: '#ffe8ec',
} as const;
const CARROT_PALETTE = {
  outline: '#493120',
  empty: '#4a4140',
  leafShadow: '#397a43',
  leaf: '#7fbd5b',
  orangeShadow: '#ca5a22',
  orange: '#ef842f',
  highlight: '#ffd478',
  ridge: '#9b3f1c',
} as const;
const HEART_HIGHLIGHTS = new Set(['6,1', '5,2', '6,2']);
const CARROT_HIGHLIGHTS = new Set(['4,3', '5,4', '6,5']);
const CARROT_RIDGES = new Set(['5,3', '5,5', '7,6']);
const ARMOR: readonly string[] = [
  '00111100',
  '01111110',
  '11111111',
  '11111111',
  '01111110',
  '00111100',
  '00011000',
];
const BUBBLE: readonly string[] = ['001100', '010010', '100001', '100001', '010010', '001100'];
const SLOT_STEP = 20;

export interface HudSnapshot {
  mode: string;
  health: number;
  hunger: number;
  air: number;
  submerged: boolean;
  armorPoints: number;
  xpLevel: number;
  xpProgress: number;
  selectedSlot: number;
  hotbar: Array<{ id: string; count: number } | null>;
}

export interface DebugOverlaySnapshot {
  fps: number;
  frameTimes: number[];
  position: [number, number, number];
  chunk: [number, number];
  facing: string;
  biome: string;
  light: { sky: number; block: number };
  target: string;
  render: {
    frameCpuMsP95: number;
    uploadMsP95: number;
    drawCalls: number;
    triangles: number;
    chunksLoaded: number;
    chunksMeshed: number;
    chunksVisible: number;
  };
  workers: { genMsP95: number; meshMsP95: number; queueLength: number };
}

export function equippedArmorPoints(player: Pick<Player, 'inventory'>): number {
  let points = 0;
  for (let slot = 36; slot <= 39; slot++) {
    const stack = player.inventory.slots[slot];
    if (stack) points += items.get(stack.id).armorPoints ?? 0;
  }
  return points;
}

export function hudSnapshot(player: Player, submerged: boolean): HudSnapshot {
  return {
    mode: player.mode,
    health: player.health,
    hunger: player.hunger,
    air: player.air,
    submerged,
    armorPoints: equippedArmorPoints(player),
    xpLevel: player.xpLevel,
    xpProgress: player.xpProgress,
    selectedSlot: player.selectedSlot,
    hotbar: player.inventory.slots
      .slice(0, 9)
      .map((stack) => (stack ? { id: stack.id, count: stack.count } : null)),
  };
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  pattern: readonly string[],
  x: number,
  y: number,
  fraction: number,
  s: number,
  color: string,
): void {
  const width = pattern[0]?.length ?? 0;
  const bounded = Math.max(0, Math.min(1, fraction));
  pattern.forEach((row, py) => {
    for (let px = 0; px < width; px++) {
      if (row[px] !== '1') continue;
      fillRect(ctx, x + px, y + py, 1, 1, px / width < bounded ? color : UI.shade, s);
    }
  });
}

function isPatternEdge(pattern: readonly string[], x: number, y: number): boolean {
  const filled = (px: number, py: number) =>
    py >= 0 && py < pattern.length && px >= 0 && px < (pattern[py]?.length ?? 0)
      ? pattern[py]?.[px] !== '.'
      : false;
  return !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1);
}

function drawStatusGlyph(
  ctx: CanvasRenderingContext2D,
  pattern: readonly string[],
  x: number,
  y: number,
  fraction: number,
  s: number,
  colorForCell: (px: number, py: number, type: string, edge: boolean, amount: number) => string,
): void {
  const amount = Math.max(0, Math.min(1, fraction));
  pattern.forEach((row, py) => {
    for (let px = 0; px < row.length; px++) {
      const type = row[px]!;
      if (type === '.') continue;
      fillRect(
        ctx,
        x + px,
        y + py,
        1,
        1,
        colorForCell(px, py, type, isPatternEdge(pattern, px, py), amount),
        s,
      );
    }
  });
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fraction: number,
  s: number,
) {
  drawStatusGlyph(ctx, HEART, x, y, fraction, s, (px, py, _type, edge, amount) => {
    if (edge) return HEART_PALETTE.outline;
    if (px / HEART[0]!.length >= amount) return HEART_PALETTE.empty;
    if (HEART_HIGHLIGHTS.has(`${px},${py}`))
      return px === 6 && py === 1 ? HEART_PALETTE.highlight : HEART_PALETTE.pink;
    if (px <= 2 || py >= 6) return HEART_PALETTE.shadow;
    if (px <= 4 || py >= 4) return HEART_PALETTE.mid;
    return HEART_PALETTE.red;
  });
}

function drawCarrot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fraction: number,
  s: number,
): void {
  const minDepth = 6;
  const maxDepth = 16;
  drawStatusGlyph(ctx, CARROT, x, y, fraction, s, (px, py, type, edge, amount) => {
    if (edge) return CARROT_PALETTE.outline;
    const depth = (px + py - minDepth) / (maxDepth - minDepth);
    const filled = type === 'L' ? amount >= 1 : depth >= 1 - amount;
    if (!filled) return CARROT_PALETTE.empty;
    if (CARROT_RIDGES.has(`${px},${py}`)) return CARROT_PALETTE.ridge;
    if (CARROT_HIGHLIGHTS.has(`${px},${py}`)) return CARROT_PALETTE.highlight;
    if (type === 'L')
      return (px === 4 && py === 1) || (px === 5 && py === 2)
        ? CARROT_PALETTE.leafShadow
        : CARROT_PALETTE.leaf;
    return depth > 0.58 ? CARROT_PALETTE.orangeShadow : CARROT_PALETTE.orange;
  });
}

function drawStatusMeter(
  ctx: CanvasRenderingContext2D,
  glyph: 'heart' | 'carrot',
  amount: number,
  count: number,
  x: number,
  y: number,
  s: number,
  step: number,
): void {
  for (let i = 0; i < count; i++) {
    const fraction = Math.max(0, Math.min(1, amount / 2 - i));
    if (glyph === 'heart') drawHeart(ctx, x + i * step, y, fraction, s);
    else drawCarrot(ctx, x + i * step, y, fraction, s);
  }
}

function drawMeter(
  ctx: CanvasRenderingContext2D,
  pattern: readonly string[],
  amount: number,
  count: number,
  x: number,
  y: number,
  s: number,
  color: string,
  step: number,
): void {
  for (let i = 0; i < count; i++)
    drawPattern(ctx, pattern, x + i * step, y, amount / 2 - i, s, color);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const arm = (x0: number, y0: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, w, h);
  };
  // Keep the center open and use 1× strokes so target blocks and diagnostic pixels stay visible.
  arm(x - 5, y, 4, 1, UI.outline);
  arm(x + 2, y, 4, 1, UI.outline);
  arm(x, y - 5, 1, 4, UI.outline);
  arm(x, y + 2, 1, 4, UI.outline);
  arm(x - 4, y, 1, 1, UI.text);
  arm(x + 2, y, 1, 1, UI.text);
  arm(x, y - 4, 1, 1, UI.text);
  arm(x, y + 2, 1, 1, UI.text);
}

function drawSelection(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  fillRect(ctx, x, y, 18, 1, UI.text, s);
  fillRect(ctx, x, y + 17, 18, 1, UI.text, s);
  fillRect(ctx, x, y, 1, 18, UI.text, s);
  fillRect(ctx, x + 17, y, 1, 18, UI.text, s);
  fillRect(ctx, x + 1, y + 1, 16, 1, UI.accent, s);
  fillRect(ctx, x + 1, y + 16, 16, 1, UI.accent, s);
  fillRect(ctx, x + 1, y + 1, 1, 16, UI.accent, s);
  fillRect(ctx, x + 16, y + 1, 1, 16, UI.accent, s);
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

function drawHud(
  ctx: CanvasRenderingContext2D,
  snapshot: HudSnapshot,
  icons: IconSheet,
  sheet: CanvasImageSource,
  width: number,
  height: number,
): void {
  const s = uiScaleFor(width, height);
  const logicalWidth = Math.floor(width / s);
  const logicalHeight = Math.floor(height / s);
  const centerX = Math.floor(logicalWidth / 2);
  const hotbarWidth = 8 * SLOT_STEP + 18;
  const hotbarX = centerX - Math.floor(hotbarWidth / 2);
  const hotbarY = logicalHeight - 22;
  const xpY = hotbarY - 6;
  const statusY = xpY - 11;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  drawPanel(ctx, { x: hotbarX - 2, y: hotbarY - 2, w: hotbarWidth + 4, h: 22 }, s);
  for (let slot = 0; slot < 9; slot++) {
    const x = hotbarX + slot * SLOT_STEP;
    drawSlot(ctx, x, hotbarY, s);
    const stack = snapshot.hotbar[slot];
    if (stack) {
      drawIcon(ctx, icons, sheet, stack.id, (x + 1) * s, (hotbarY + 1) * s, 16 * s);
      if (stack.count > 1) drawCount(ctx, stack.count, x, hotbarY, s);
    }
    if (slot === snapshot.selectedSlot) drawSelection(ctx, x, hotbarY, s);
  }

  drawCrosshair(ctx, width, height);
  if (snapshot.mode === 'creative') return;

  drawStatusMeter(ctx, 'heart', snapshot.health, 10, centerX - 94, statusY, s, 9);
  drawStatusMeter(ctx, 'carrot', snapshot.hunger, 10, centerX + 5, statusY, s, 9);
  if (snapshot.armorPoints > 0)
    drawMeter(ctx, ARMOR, snapshot.armorPoints, 10, centerX - 44, statusY - 10, s, UI.light, 9);
  if (snapshot.submerged)
    drawMeter(ctx, BUBBLE, snapshot.air / 15, 10, centerX + 52, statusY - 10, s, UI.light, 8);

  const barWidth = 180;
  const barX = centerX - Math.floor(barWidth / 2);
  drawInset(ctx, { x: barX, y: xpY, w: barWidth, h: 4 }, s);
  fillRect(
    ctx,
    barX + 1,
    xpY + 1,
    Math.floor((barWidth - 2) * snapshot.xpProgress),
    2,
    UI.accent,
    s,
  );
  if (snapshot.xpLevel > 0) {
    const level = String(snapshot.xpLevel);
    drawText(
      ctx,
      level,
      (centerX - Math.floor(textWidth(level) / 2)) * s,
      (xpY - 8) * s,
      s,
      UI.accent,
      UI.outline,
    );
  }
}

function drawPopup(
  ctx: CanvasRenderingContext2D,
  label: string,
  width: number,
  height: number,
): void {
  const s = uiScaleFor(width, height);
  const x = Math.floor(width / s / 2 - textWidth(label) / 2 - 5);
  const y = Math.floor(height / s - 72);
  ctx.clearRect(0, 0, width, height);
  drawPanel(ctx, { x, y, w: textWidth(label) + 10, h: 17 }, s);
  drawText(ctx, label, (x + 5) * s, (y + 5) * s, s, UI.text, UI.outline);
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  samples: readonly number[],
  x: number,
  y: number,
  width: number,
  height: number,
  s: number,
): void {
  drawInset(ctx, { x, y, w: width, h: height }, s);
  samples.slice(-width + 2).forEach((ms, i) => {
    const barHeight = Math.max(
      1,
      Math.min(height - 2, Math.round((Math.min(ms, 50) / 50) * (height - 2))),
    );
    fillRect(ctx, x + 1 + i, y + height - 1 - barHeight, 1, barHeight, UI.accent, s);
  });
}

function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  graphCanvas: HTMLCanvasElement,
  sample: DebugOverlaySnapshot | null,
  width: number,
  height: number,
): void {
  const s = uiScaleFor(width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  drawPanel(ctx, { x: 4, y: 4, w: 278, h: 112 }, s);
  const line = (text: string, row: number) =>
    drawText(ctx, text, 9 * s, (9 + row * 8) * s, s, UI.text, UI.outline);
  if (!sample) {
    line('NO WORLD', 0);
    return;
  }
  const [x, y, z] = sample.position;
  const latestFrame = sample.frameTimes[sample.frameTimes.length - 1] ?? 0;
  line(`FPS ${sample.fps}  FRAME ${latestFrame.toFixed(1)} MS`, 0);
  line(`POS ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`, 1);
  line(`CHUNK ${sample.chunk[0]} ${sample.chunk[1]} FACING ${sample.facing}`, 2);
  line(`BIOME ${sample.biome.replace(/_/g, ' ').toUpperCase()}`, 3);
  line(`LIGHT SKY ${sample.light.sky} BLOCK ${sample.light.block}`, 4);
  line(`TARGET ${sample.target}`, 5);
  line(`DRAW ${sample.render.drawCalls} TRI ${sample.render.triangles}`, 6);
  line(
    `VISIBLE ${sample.render.chunksVisible} MESHED ${sample.render.chunksMeshed} LOADED ${sample.render.chunksLoaded}`,
    7,
  );
  line(
    `CPU ${sample.render.frameCpuMsP95.toFixed(1)} UP ${sample.render.uploadMsP95.toFixed(1)} MS`,
    8,
  );
  line(
    `WORKER ${sample.workers.genMsP95.toFixed(1)}-${sample.workers.meshMsP95.toFixed(1)} Q ${sample.workers.queueLength}`,
    9,
  );
  graphCanvas.width = 264 * s;
  graphCanvas.height = 17 * s;
  const graphContext = graphCanvas.getContext('2d')!;
  graphContext.imageSmoothingEnabled = false;
  drawGraph(graphContext, sample.frameTimes, 0, 0, 264, 17, s);
  ctx.drawImage(graphCanvas, 9 * s, 92 * s);
}

/** HUD input and rendering. HUD and diagnostic canvases are independent of the inventory redraw. */
export class Hud {
  private hudCanvas!: HTMLCanvasElement;
  private hudContext!: CanvasRenderingContext2D;
  private popupCanvas!: HTMLCanvasElement;
  private popupContext!: CanvasRenderingContext2D;
  private debugCanvas!: HTMLCanvasElement;
  private debugContext!: CanvasRenderingContext2D;
  private graphCanvas!: HTMLCanvasElement;
  private sheet!: HTMLCanvasElement;
  private icons!: IconSheet;
  private size = { width: 0, height: 0 };
  private lastHudKey = '';
  private lastSelectedSlot: number | null = null;
  private popupTimer: number | undefined;
  private debugOpen = false;
  private lastDebugUpdate = -Infinity;

  constructor(
    private readonly input: InputEngine,
    private readonly controller: () => PlayerController | null,
    private readonly iconSource: () => IconSheet,
    private readonly debugEnabled: boolean,
    private readonly getDebugSnapshot: () => DebugOverlaySnapshot | null,
    private readonly isSubmerged: () => boolean,
    private readonly screenOpen: () => boolean,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', this.onResize);
  }

  private ensureCanvases(): void {
    if (this.hudCanvas) return;
    this.icons = this.iconSource();
    this.sheet = document.createElement('canvas');
    this.sheet.width = this.icons.width;
    this.sheet.height = this.icons.height;
    this.sheet
      .getContext('2d')!
      .putImageData(new ImageData(this.icons.data, this.icons.width, this.icons.height), 0, 0);
    this.hudCanvas = this.createCanvas('hud-canvas', 2);
    this.hudContext = this.hudCanvas.getContext('2d')!;
    this.popupCanvas = this.createCanvas('hud-item-popup', 3);
    this.popupContext = this.popupCanvas.getContext('2d')!;
    this.debugCanvas = this.createCanvas('f3-overlay', 4);
    this.debugCanvas.setAttribute('aria-label', 'F3 debug overlay');
    this.debugCanvas.setAttribute('aria-hidden', 'false');
    this.debugContext = this.debugCanvas.getContext('2d')!;
    this.graphCanvas = document.createElement('canvas');
    this.resizeCanvases();
  }

  private createCanvas(id: string, zIndex: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      display: 'none',
      imageRendering: 'pixelated',
      pointerEvents: 'none',
      zIndex: String(zIndex),
    });
    document.body.appendChild(canvas);
    return canvas;
  }

  private resizeCanvases(): void {
    if (!this.hudCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    for (const canvas of [this.hudCanvas, this.popupCanvas, this.debugCanvas]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.size = { width, height };
    this.lastHudKey = '';
  }

  private readonly onResize = (): void => this.resizeCanvases();

  private readonly onWheel = (event: WheelEvent): void => {
    const player = this.controller()?.player;
    if (this.input.captured || !player || !event.deltaY) return;
    event.preventDefault();
    player.inventory.selectedSlot = (player.selectedSlot + (event.deltaY > 0 ? 1 : 8)) % 9;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') {
      event.preventDefault();
      if (!event.repeat && this.debugEnabled && !this.input.captured) {
        this.debugOpen = !this.debugOpen;
        this.lastDebugUpdate = -Infinity;
        if (this.debugOpen && this.controller()?.player) {
          this.ensureCanvases();
          this.debugCanvas.style.display = 'block';
        } else if (this.debugCanvas) {
          this.debugCanvas.style.display = 'none';
        }
      }
      return;
    }
    if (this.input.captured || event.ctrlKey || event.metaKey || event.altKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    const player = this.controller()?.player;
    if (digit && player) {
      player.inventory.selectedSlot = Number(digit[1]) - 1;
      event.preventDefault();
    }
  };

  private showPopup(player: Player): void {
    this.ensureCanvases();
    const stack = player.inventory.slots[player.selectedSlot];
    drawPopup(
      this.popupContext,
      stack ? displayName(stack.id) : 'EMPTY',
      this.size.width,
      this.size.height,
    );
    this.popupCanvas.style.transition = 'none';
    this.popupCanvas.style.opacity = '1';
    this.popupCanvas.style.display = 'block';
    if (this.popupTimer !== undefined) window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => {
      this.popupCanvas.style.transition = 'opacity 400ms linear';
      this.popupCanvas.style.opacity = '0';
      this.popupTimer = window.setTimeout(() => {
        this.popupCanvas.style.display = 'none';
      }, 400);
    }, 1600);
  }

  frame(time: number): void {
    const player = this.controller()?.player;
    if (!player) {
      if (this.hudCanvas) this.hudCanvas.style.display = 'none';
      if (this.popupCanvas) this.popupCanvas.style.display = 'none';
      if (this.debugOpen && this.debugCanvas && time - this.lastDebugUpdate >= 250) {
        this.drawDebug(null);
        this.lastDebugUpdate = time;
      }
      return;
    }
    this.ensureCanvases();
    const screenOpen = this.screenOpen();
    this.hudCanvas.style.display = screenOpen ? 'none' : 'block';
    if (this.debugOpen) this.debugCanvas.style.display = 'block';
    if (screenOpen) this.popupCanvas.style.display = 'none';
    const snapshot = hudSnapshot(player, this.isSubmerged());
    if (this.lastSelectedSlot === null) {
      this.lastSelectedSlot = snapshot.selectedSlot;
    } else if (this.lastSelectedSlot !== snapshot.selectedSlot) {
      this.lastSelectedSlot = snapshot.selectedSlot;
      if (!screenOpen && snapshot.mode !== 'creative') this.showPopup(player);
    }
    if (snapshot.mode === 'creative') this.popupCanvas.style.display = 'none';
    if (!screenOpen) {
      const key = JSON.stringify([snapshot, this.size.width, this.size.height]);
      if (key !== this.lastHudKey) {
        this.lastHudKey = key;
        drawHud(
          this.hudContext,
          snapshot,
          this.icons,
          this.sheet,
          this.size.width,
          this.size.height,
        );
      }
    }
    if (this.debugOpen && time - this.lastDebugUpdate >= 250) {
      this.drawDebug(this.getDebugSnapshot());
      this.lastDebugUpdate = time;
    }
  }

  private drawDebug(snapshot: DebugOverlaySnapshot | null): void {
    drawDebugOverlay(
      this.debugContext,
      this.graphCanvas,
      snapshot,
      this.size.width,
      this.size.height,
    );
    this.debugCanvas.dataset.biome = snapshot?.biome ?? '';
  }
}

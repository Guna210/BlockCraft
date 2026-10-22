import type { InputEngine } from '../engine/input';
import {
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  conflictsFor,
  mouseCode,
  readableKey,
  type KeybindAction,
} from '../engine/keybinds';
import { settings, type GuiScaleSetting, type Settings } from '../engine/settings';
import {
  applySetting,
  persistCurrentSettings,
  resetSettings,
  setSetting,
} from '../engine/settings-runtime';
import { drawButton, drawInset, drawPanel, fillRect, UI, uiScaleFor } from './ui-kit';
import { drawText, textWidth } from './pixel-font';

type Tab = 'video' | 'audio' | 'controls-1' | 'controls-2';
type RangeKey =
  | 'renderDistance'
  | 'fov'
  | 'mouseSensitivity'
  | 'brightness'
  | 'masterVolume'
  | 'musicVolume'
  | 'effectsVolume'
  | 'ambientVolume';
type BoolKey = 'invertY' | 'smoothLighting' | 'particles' | 'viewBobbing';
type EnumKey = 'leaves' | 'clouds' | 'guiScale';

interface RangeRow {
  kind: 'range';
  key: RangeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}
interface BoolRow {
  kind: 'bool';
  key: BoolKey;
  label: string;
}
interface EnumRow {
  kind: 'enum';
  key: EnumKey;
  label: string;
  values: readonly (string | number)[];
  format: (value: string | number) => string;
}
type SettingRow = RangeRow | BoolRow | EnumRow;

const videoRows: SettingRow[] = [
  {
    kind: 'range',
    key: 'renderDistance',
    label: 'Render distance',
    min: 2,
    max: 32,
    step: 1,
    format: (v) => `${v} chunks`,
  },
  {
    kind: 'range',
    key: 'fov',
    label: 'Field of view',
    min: 50,
    max: 110,
    step: 1,
    format: (v) => `${v}°`,
  },
  {
    kind: 'range',
    key: 'mouseSensitivity',
    label: 'Mouse sensitivity',
    min: 0.1,
    max: 5,
    step: 0.1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  { kind: 'bool', key: 'invertY', label: 'Invert Y axis' },
  {
    kind: 'enum',
    key: 'leaves',
    label: 'Leaves',
    values: ['fancy', 'fast'],
    format: (v) => String(v).toUpperCase(),
  },
  {
    kind: 'enum',
    key: 'clouds',
    label: 'Clouds',
    values: ['fancy', 'fast', 'off'],
    format: (v) => String(v).toUpperCase(),
  },
  { kind: 'bool', key: 'smoothLighting', label: 'Smooth lighting' },
  { kind: 'bool', key: 'particles', label: 'Particles' },
  {
    kind: 'enum',
    key: 'guiScale',
    label: 'GUI scale',
    values: ['auto', 1, 2, 3, 4],
    format: (v) => String(v).toUpperCase(),
  },
  {
    kind: 'range',
    key: 'brightness',
    label: 'Brightness',
    min: 0.25,
    max: 1.5,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  { kind: 'bool', key: 'viewBobbing', label: 'View bobbing' },
];

const audioRows: SettingRow[] = [
  {
    kind: 'range',
    key: 'masterVolume',
    label: 'Master volume',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    kind: 'range',
    key: 'musicVolume',
    label: 'Music volume',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    kind: 'range',
    key: 'effectsVolume',
    label: 'Effects volume',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    kind: 'range',
    key: 'ambientVolume',
    label: 'Ambient volume',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'video', label: 'VIDEO' },
  { id: 'audio', label: 'AUDIO' },
  { id: 'controls-1', label: 'KEYS 1' },
  { id: 'controls-2', label: 'KEYS 2' },
];

const actionGroups = [KEYBIND_ACTIONS.slice(0, 14), KEYBIND_ACTIONS.slice(14)];

/** Pixel-font settings overlay with accessible DOM hit targets over the drawn controls. */
export class SettingsScreen {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly controls: HTMLDivElement;
  private tab: Tab = 'video';
  private waitingAction: KeybindAction | null = null;
  private wasCaptured = false;
  private closeCallback: (() => void) | null = null;
  private scale = 1;

  constructor(private readonly input: InputEngine) {
    this.root = document.createElement('div');
    this.root.id = 'settings-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Settings');
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '20',
      display: 'none',
      background: 'rgba(9,11,20,.82)',
      fontFamily: 'monospace',
    });

    this.frame = document.createElement('div');
    Object.assign(this.frame.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      imageRendering: 'pixelated',
    });
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    this.controls = document.createElement('div');
    Object.assign(this.controls.style, { position: 'absolute', inset: '0' });
    this.frame.append(this.canvas, this.controls);
    this.root.appendChild(this.frame);
    document.body.appendChild(this.root);
    const rangeStyle = document.createElement('style');
    rangeStyle.textContent =
      '#settings-screen input[type=range]::-webkit-slider-runnable-track{height:4px;background:transparent}' +
      '#settings-screen input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;margin-top:-2px;background:#e2b43a;border:2px solid #15121f}' +
      '#settings-screen input[type=range]::-moz-range-track{height:4px;background:transparent}' +
      '#settings-screen input[type=range]::-moz-range-thumb{width:6px;height:6px;background:#e2b43a;border:2px solid #15121f;border-radius:0}';
    document.head.appendChild(rangeStyle);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('mousedown', this.onMouseDown);
  }

  show(onClose?: () => void): void {
    this.closeCallback = onClose ?? null;
    this.wasCaptured = this.input.captured;
    this.input.setCapture(true);
    this.root.style.display = 'block';
    this.tab = 'video';
    this.waitingAction = null;
    this.layout();
  }

  close(): void {
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.waitingAction = null;
    this.input.setCapture(this.wasCaptured);
    const callback = this.closeCallback;
    this.closeCallback = null;
    callback?.();
  }

  private readonly onResize = (): void => {
    if (this.root.style.display !== 'none') this.layout();
  };

  private layout(): void {
    this.scale = uiScaleFor(window.innerWidth, window.innerHeight);
    this.frame.style.width = `${320 * this.scale}px`;
    this.frame.style.height = `${240 * this.scale}px`;
    this.canvas.style.width = `${320 * this.scale}px`;
    this.canvas.style.height = `${240 * this.scale}px`;
    this.render();
  }

  private addHitTarget(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    Object.assign(button.style, {
      position: 'absolute',
      left: `${x * this.scale}px`,
      top: `${y * this.scale}px`,
      width: `${w * this.scale}px`,
      height: `${h * this.scale}px`,
      margin: '0',
      padding: '0',
      border: '0',
      color: 'transparent',
      background: 'transparent',
      cursor: 'pointer',
      outline: 'none',
    });
    button.addEventListener('click', onClick);
    this.controls.appendChild(button);
    return button;
  }

  private addSlider(row: RangeRow, y: number): void {
    const rawValue = settings[row.key];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    input.value = String(rawValue);
    input.setAttribute('aria-label', row.label);
    Object.assign(input.style, {
      position: 'absolute',
      left: `${177 * this.scale}px`,
      top: `${(y + 1) * this.scale}px`,
      width: `${78 * this.scale}px`,
      height: `${9 * this.scale}px`,
      margin: '0',
      padding: '0',
      appearance: 'none',
      background: 'transparent',
      cursor: 'pointer',
      accentColor: UI.accent,
    });
    input.addEventListener('input', () => {
      const stepped = Math.round(Number(input.value) / row.step) * row.step;
      applySetting(row.key, stepped);
    });
    input.addEventListener('change', () => {
      persistCurrentSettings();
      this.render();
    });
    this.controls.appendChild(input);
    this.addHitTarget(`${row.label} decrease`, 164, y, 12, 11, () => {
      setSetting(
        row.key,
        Math.max(row.min, Math.round((rawValue - row.step) / row.step) * row.step),
      );
      this.render();
    });
    this.addHitTarget(`${row.label} increase`, 296, y, 12, 11, () => {
      setSetting(
        row.key,
        Math.min(row.max, Math.round((rawValue + row.step) / row.step) * row.step),
      );
      this.render();
    });
  }

  private addSettingRows(rows: readonly SettingRow[], startY: number, rowHeight: number): void {
    rows.forEach((row, index) => {
      const y = startY + index * rowHeight;
      if (row.kind === 'range') return this.addSlider(row, y);
      const current = settings[row.key];
      const value =
        row.kind === 'bool' ? (current ? 'ON' : 'OFF') : row.format(current as string | number);
      this.addHitTarget(`${row.label}: ${value}`, 164, y, 144, 11, () => {
        if (row.kind === 'bool') setSetting(row.key, !settings[row.key]);
        else {
          const currentIndex = row.values.indexOf(settings[row.key] as string | number);
          const next = row.values[(currentIndex + 1) % row.values.length]!;
          if (row.key === 'guiScale') setSetting('guiScale', next as GuiScaleSetting);
          else setSetting(row.key, next as Settings[typeof row.key]);
        }
        this.render();
      });
    });
  }

  private addKeyTargets(actions: readonly KeybindAction[], startY: number): void {
    actions.forEach((action, index) => {
      const y = startY + index * 11;
      this.addHitTarget(
        `Rebind ${KEYBIND_LABELS[action]} (${readableKey(settings.keyBindings[action])})`,
        201,
        y,
        106,
        10,
        () => {
          this.waitingAction = action;
          this.render();
        },
      );
    });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.root.style.display === 'none' || event.repeat) return;
    if (this.waitingAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        this.waitingAction = null;
      } else {
        setSetting('keyBindings', { ...settings.keyBindings, [this.waitingAction]: event.code });
        this.waitingAction = null;
      }
      this.render();
      return;
    }
    if (event.code === settings.keyBindings.menuBack) {
      event.preventDefault();
      this.close();
    }
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.root.style.display === 'none' || !this.waitingAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setSetting('keyBindings', {
      ...settings.keyBindings,
      [this.waitingAction]: mouseCode(event.button),
    });
    this.waitingAction = null;
    this.render();
  };

  private render(): void {
    const nextScale = uiScaleFor(window.innerWidth, window.innerHeight);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.frame.style.width = `${320 * this.scale}px`;
      this.frame.style.height = `${240 * this.scale}px`;
      this.canvas.style.width = `${320 * this.scale}px`;
      this.canvas.style.height = `${240 * this.scale}px`;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 320, 240);
    drawPanel(ctx, { x: 1, y: 1, w: 318, h: 238 }, 1);
    const title = this.waitingAction ? 'PRESS KEY OR MOUSE' : 'SETTINGS';
    drawText(ctx, title, Math.floor((320 - textWidth(title)) / 2), 8, 1, UI.accent, UI.outline);
    if (this.waitingAction) {
      const action = KEYBIND_LABELS[this.waitingAction].toUpperCase();
      drawText(
        ctx,
        `FOR ${action}`,
        Math.floor((320 - textWidth(`FOR ${action}`)) / 2),
        16,
        1,
        UI.text,
        UI.outline,
      );
    }

    this.controls.replaceChildren();
    let tabX = 8;
    for (const tab of tabs) {
      const w = tab.id.startsWith('controls') ? 72 : 68;
      drawButton(ctx, { x: tabX, y: 23, w, h: 17 }, tab.label, 1, this.tab === tab.id);
      this.addHitTarget(tab.label, tabX, 23, w, 17, () => {
        this.tab = tab.id;
        this.waitingAction = null;
        this.render();
      });
      tabX += w + 3;
    }

    if (this.tab === 'video' || this.tab === 'audio') {
      const rows = this.tab === 'video' ? videoRows : audioRows;
      const rowHeight = this.tab === 'video' ? 13 : 24;
      const startY = this.tab === 'video' ? 47 : 55;
      this.addSettingRows(rows, startY, rowHeight);
      rows.forEach((row, index) => {
        const y = startY + index * rowHeight;
        const value =
          row.kind === 'range'
            ? row.format(settings[row.key])
            : row.kind === 'bool'
              ? settings[row.key]
                ? 'ON'
                : 'OFF'
              : row.format(settings[row.key] as string | number);
        drawText(ctx, row.label.toUpperCase(), 9, y + 2, 1, UI.text, UI.outline);
        if (row.kind === 'range') {
          const ratio = (settings[row.key] - row.min) / (row.max - row.min);
          drawInset(ctx, { x: 177, y: y + 3, w: 78, h: 5 }, 1);
          fillRect(ctx, 179, y + 4, Math.round(74 * ratio), 3, UI.accent, 1);
          drawText(ctx, value, 258, y + 2, 1, UI.text, UI.outline);
        } else {
          drawButton(ctx, { x: 164, y, w: 144, h: 11 }, value, 1, false);
        }
      });
    } else {
      const group = this.tab === 'controls-1' ? 0 : 1;
      const actions = actionGroups[group]!;
      actions.forEach((action, index) => {
        const y = 47 + index * 11;
        drawText(ctx, KEYBIND_LABELS[action].toUpperCase(), 8, y + 1, 1, UI.text, UI.outline);
        const binding =
          this.waitingAction === action
            ? 'PRESS KEY'
            : readableKey(settings.keyBindings[action]).toUpperCase();
        drawButton(ctx, { x: 201, y, w: 107, h: 10 }, binding, 1, false);
      });
      this.addKeyTargets(actions, 47);
    }

    const conflicts = conflictsFor(settings.keyBindings);
    if (conflicts.length) {
      const [code, actions] = conflicts[0]!;
      const names = actions.map((action) => KEYBIND_LABELS[action].toUpperCase()).join(' + ');
      const warning = `KEY CONFLICT: ${names} (${readableKey(code).toUpperCase()})`;
      drawText(ctx, warning.slice(0, 48), 8, 204, 1, UI.accent, UI.outline);
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = warning;
      Object.assign(alert.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
      });
      this.controls.appendChild(alert);
    }
    if (this.waitingAction) {
      drawText(ctx, 'ESC CANCELS', 8, 216, 1, UI.text, UI.outline);
    } else {
      drawButton(ctx, { x: 8, y: 216, w: 112, h: 16 }, 'RESET DEFAULTS', 1, false);
      this.addHitTarget('Reset settings to defaults', 8, 216, 112, 16, () => {
        resetSettings();
        this.waitingAction = null;
        this.render();
      });
      drawButton(ctx, { x: 232, y: 216, w: 80, h: 16 }, 'DONE', 1, false);
      this.addHitTarget('Done', 232, 216, 80, 16, () => this.close());
    }
  }
}

import { settings } from '../engine/settings';
import { isActionCode, mouseCode } from '../engine/keybinds';
import type { InputEngine } from '../engine/input';
import { UI } from './ui-kit';

/** Snapshots the canvas in the rendering call stack; WebGL buffer preservation stays disabled. */
export class Screenshots {
  pending = false;
  private url: string | null = null;
  private link: HTMLAnchorElement | null = null;
  private timer: number | undefined;
  constructor(
    input: InputEngine,
    canCapture: () => boolean,
    private readonly message: (text: string, error?: boolean) => void,
  ) {
    window.addEventListener(
      'keydown',
      (event) => {
        if (
          event.repeat ||
          input.captured ||
          !canCapture() ||
          !isActionCode(event.code, 'screenshot', settings.keyBindings)
        )
          return;
        event.preventDefault();
        this.pending = true;
      },
      true,
    );
    window.addEventListener(
      'mousedown',
      (event) => {
        if (
          input.captured ||
          !canCapture() ||
          !(event.target instanceof HTMLCanvasElement) ||
          !isActionCode(mouseCode(event.button), 'screenshot', settings.keyBindings)
        )
          return;
        event.preventDefault();
        this.pending = true;
      },
      true,
    );
  }
  captureAfterRender(canvas: HTMLCanvasElement): void {
    if (!this.pending) return;
    this.pending = false;
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          this.message('Screenshot failed', true);
          return;
        }
        this.clear();
        this.url = URL.createObjectURL(blob);
        this.link = document.createElement('a');
        this.link.href = this.url;
        this.link.download = `blockcraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        this.link.id = 'screenshot-download';
        this.link.textContent = 'Download screenshot (PNG)';
        Object.assign(this.link.style, {
          position: 'fixed',
          right: '20px',
          top: '20px',
          zIndex: '15',
          color: UI.accent,
          background: UI.outline,
          border: `2px solid ${UI.light}`,
          padding: '12px',
          font: '16px monospace',
        });
        document.body.append(this.link);
        this.message('Screenshot ready. Use the PNG download link.');
        this.timer = window.setTimeout(() => this.clear(), 120_000);
      }, 'image/png');
    } catch {
      this.message('Screenshot failed', true);
    }
  }
  private clear(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.link?.remove();
    this.link = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

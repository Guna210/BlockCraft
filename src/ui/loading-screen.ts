import { OverlayPanel } from './overlay-panel';
import { drawInset, fillRect, UI } from './ui-kit';
import { drawText } from './pixel-font';

export function loadingProgress(previous: number, ready: number, required: number): number {
  return Math.max(previous, Math.min(required, ready));
}

export class LoadingScreen {
  private readonly panel = new OverlayPanel('world-loading', 'Loading world', 164, 52);
  private readonly bar = document.createElement('div');
  private required = 1;
  private ready = 0;
  private session = 0;

  constructor() {
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-label', 'Terrain columns ready');
    this.bar.setAttribute('aria-valuemin', '0');
    this.panel.root.style.background = UI.outline;
    this.panel.root.style.zIndex = '30';
  }

  show(required: number): number {
    this.ready = 0;
    this.required = required;
    this.panel.begin('LOADING WORLD');
    this.panel.position(this.bar, 9, 24, 146, 10);
    this.panel.root.style.display = 'block';
    this.draw();
    return ++this.session;
  }

  update(session: number, ready: number): void {
    if (session !== this.session) return;
    const next = loadingProgress(this.ready, ready, this.required);
    if (next === this.ready) return;
    this.ready = next;
    this.draw();
  }

  hide(session: number): void {
    if (session === this.session) this.panel.root.style.display = 'none';
  }

  private draw(): void {
    const { ctx } = this.panel;
    this.bar.setAttribute('aria-valuemax', String(this.required));
    this.bar.setAttribute('aria-valuenow', String(this.ready));
    drawInset(ctx, { x: 9, y: 24, w: 146, h: 10 }, 1);
    fillRect(ctx, 10, 25, Math.floor((144 * this.ready) / this.required), 8, UI.accent, 1);
    fillRect(ctx, 9, 37, 146, 10, UI.panel, 1);
    drawText(ctx, `${this.ready} / ${this.required}`, 9, 38, 1, UI.text, UI.outline);
  }
}

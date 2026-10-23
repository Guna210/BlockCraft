import { drawPanel, drawButton, UI, uiScaleFor } from './ui-kit';
import { drawText } from './pixel-font';

/** Event-driven pixel-art panel with real, accessible DOM hit targets. */
export class OverlayPanel {
  readonly root = document.createElement('div');
  readonly frame = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  readonly controls = document.createElement('div');
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  constructor(
    id: string,
    label: string,
    readonly width: number,
    readonly height: number,
  ) {
    this.root.id = id;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', label);
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      zIndex: '12',
      background: 'rgba(9,11,20,.65)',
    });
    Object.assign(this.frame.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      imageRendering: 'pixelated',
    });
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    Object.assign(this.controls.style, { position: 'absolute', inset: '0' });
    this.frame.append(this.canvas, this.controls);
    this.root.append(this.frame);
    document.body.append(this.root);
  }
  begin(title: string): void {
    this.scale = Math.min(
      uiScaleFor(innerWidth, innerHeight),
      Math.max(1, Math.floor(innerHeight / this.height)),
    );
    this.frame.style.width = `${this.width * this.scale}px`;
    this.frame.style.height = `${this.height * this.scale}px`;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.clearRect(0, 0, this.width, this.height);
    drawPanel(this.ctx, { x: 0, y: 0, w: this.width, h: this.height }, 1);
    drawText(this.ctx, title, 9, 9, 1, UI.accent, UI.outline);
    this.controls.replaceChildren();
  }
  position(element: HTMLElement, x: number, y: number, w: number, h: number): void {
    Object.assign(element.style, {
      position: 'absolute',
      left: `${x * this.scale}px`,
      top: `${y * this.scale}px`,
      width: `${w * this.scale}px`,
      height: `${h * this.scale}px`,
      boxSizing: 'border-box',
      margin: '0',
      padding: '0',
    });
    this.controls.append(element);
  }
  button(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    click: () => void,
    active = false,
  ): HTMLButtonElement {
    drawButton(this.ctx, { x, y, w, h }, label.toUpperCase(), 1, active);
    const button = this.hit(label, x, y, w, h, click);
    button.setAttribute('aria-pressed', String(active));
    return button;
  }
  hit(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    click: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    Object.assign(button.style, {
      color: 'transparent',
      background: 'transparent',
      border: '0',
      cursor: 'pointer',
    });
    button.addEventListener('click', click);
    this.position(button, x, y, w, h);
    return button;
  }
}

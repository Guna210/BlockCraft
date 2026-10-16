import type { InputEngine } from '../engine/input';
import type { PlayerController } from '../engine/player-controller';
import { dropInventoryStack } from '../gameplay/inventory-drop';
import type { InventoryTarget } from '../gameplay/inventory';
import type { Player } from '../entity/player';
import type { IconSheet } from './icons';
import {
  computeLayout,
  contains,
  slotAt,
  SLOT_COUNT,
  type InventoryLayout,
} from './inventory-layout';
import { drawInventoryScreen, tooltipFor } from './inventory-screen';
import type { Rect } from './ui-kit';

export type ScreenName = 'inventory';
export type ClickButton = 'left' | 'right';

export interface ScreenSnapshot {
  name: ScreenName | null;
  /** Canvas pixels per UI pixel (an integer). */
  scale: number;
  /** Rectangles in CSS pixels; `slots[i]` is the 18×18 UI-pixel cell of inventory slot i. */
  panel: Rect | null;
  slots: Rect[];
  closeButton: Rect | null;
  hoverSlot: number | null;
  tooltip: string | null;
}

const DOUBLE_CLICK_MS = 400;
const THROW_SPEED = 4;
const THROW_PICKUP_DELAY_TICKS = 40;

/** The UI overlay: a 2D canvas above the game canvas that owns screens and their input. */
export class UiManager {
  screen: ScreenName | null = null;
  // The 2D canvases are created on first open, so startup does not pay for them.
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sheet!: HTMLCanvasElement;
  private icons!: IconSheet;
  private layout: InventoryLayout | null = null;
  private dpr = 1;
  private mouse = { x: 0, y: 0 };
  private hoverSlot: number | null = null;
  private hoverClose = false;
  private drag: { button: ClickButton; slots: number[] } | null = null;
  private lastPick = { slot: -1, time: 0 };
  private wasLocked = false;

  constructor(
    private readonly input: InputEngine,
    private readonly controller: () => PlayerController | null,
    private readonly iconSource: () => IconSheet,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('resize', this.onResize);
  }

  private ensureCanvases(): void {
    if (this.canvas) return;
    this.icons = this.iconSource();
    this.sheet = document.createElement('canvas');
    this.sheet.width = this.icons.width;
    this.sheet.height = this.icons.height;
    this.sheet
      .getContext('2d')!
      .putImageData(new ImageData(this.icons.data, this.icons.width, this.icons.height), 0, 0);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    const style = this.canvas.style;
    style.position = 'fixed';
    style.left = '0';
    style.top = '0';
    style.width = '100%';
    style.height = '100%';
    style.display = 'none';
    style.imageRendering = 'pixelated';
    style.cursor = 'default';
    this.canvas.id = 'ui-canvas';
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(this.canvas);
  }

  private get player(): Player | null {
    return this.controller()?.player ?? null;
  }

  private requirePlayer(): Player {
    const player = this.player;
    if (!player) throw new Error('Create a world before opening a screen');
    return player;
  }

  open(name: ScreenName): void {
    if (name !== 'inventory') throw new Error(`Unknown screen: ${name}`);
    this.requirePlayer();
    if (this.screen) return;
    this.ensureCanvases();
    this.screen = name;
    this.wasLocked = this.input.pointerLocked;
    this.input.setCapture(true);
    if (this.wasLocked) document.exitPointerLock();
    this.canvas.style.display = 'block';
    this.resizeCanvas();
    this.hoverSlot = null;
    this.hoverClose = false;
    this.drag = null;
    this.render();
  }

  /** Returns the cursor stack to the inventory, or throws it into the world when it does not fit. */
  close(): void {
    if (!this.screen) return;
    const player = this.player;
    if (player) {
      player.inventory.returnCursor();
      if (player.inventory.cursor) this.throwStack('cursor', true);
    }
    this.screen = null;
    this.drag = null;
    this.canvas.style.display = 'none';
    this.input.setCapture(false);
    if (this.wasLocked) {
      // Keyboard activation allows re-locking; a refusal leaves the player to click the game.
      try {
        const lock = this.input.relock();
        if (lock) lock.catch(() => {});
      } catch {
        /* the browser declined; clicking the game locks the pointer again */
      }
    }
  }

  /** The same operation a mouse click performs; shift-click quick-moves. */
  clickSlot(slot: number, button: ClickButton, shift = false): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT)
      throw new Error('Invalid inventory slot');
    const inventory = this.requirePlayer().inventory;
    if (shift) inventory.shiftClick(slot);
    else if (button === 'left') inventory.leftClick(slot);
    else inventory.rightClick(slot);
  }

  /** Throws a stack from the player's eye along the view direction; a full pool keeps the stack. */
  throwStack(target: InventoryTarget, whole: boolean): void {
    const player = this.player;
    const items = this.controller()?.itemEntities;
    if (!player || !items) return;
    const cos = Math.cos(player.pitch);
    const dir = [
      Math.cos(player.yaw) * cos,
      Math.sin(player.pitch),
      Math.sin(player.yaw) * cos,
    ] as const;
    const eye = player.pos[1] + player.eye - 0.3;
    dropInventoryStack(
      player.inventory,
      items,
      [player.pos[0] + dir[0] * 0.3, eye + dir[1] * 0.3, player.pos[2] + dir[2] * 0.3],
      target,
      whole,
      {
        velocity: [dir[0] * THROW_SPEED, dir[1] * THROW_SPEED + 1, dir[2] * THROW_SPEED],
        pickupDelay: THROW_PICKUP_DELAY_TICKS,
      },
    );
  }

  snapshot(): ScreenSnapshot {
    const layout = this.screen ? this.layout : null;
    const inv = this.player?.inventory;
    const css = (r: Rect): Rect => ({
      x: r.x / this.dpr,
      y: r.y / this.dpr,
      w: r.w / this.dpr,
      h: r.h / this.dpr,
    });
    return {
      name: this.screen,
      scale: layout?.scale ?? 0,
      panel: layout ? css(layout.panel) : null,
      slots: layout ? layout.slots.map(css) : [],
      closeButton: layout ? css(layout.closeButton) : null,
      hoverSlot: this.hoverSlot,
      tooltip: inv ? tooltipFor(inv, this.hoverSlot) : null,
    };
  }

  /** Redraws the open screen; called every frame while one is open. */
  frame(): void {
    if (this.screen) this.render();
  }

  render(): void {
    const player = this.player;
    if (!this.screen || !player) return;
    this.layout = computeLayout(this.canvas.width, this.canvas.height);
    drawInventoryScreen(
      this.ctx,
      {
        layout: this.layout,
        inventory: player.inventory,
        hoverSlot: this.hoverSlot,
        hoverClose: this.hoverClose,
        mouse: this.mouse,
        width: this.canvas.width,
        height: this.canvas.height,
      },
      this.icons,
      this.sheet,
    );
  }

  private resizeCanvas(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.dpr));
  }

  private readonly onResize = (): void => {
    if (!this.screen) return;
    this.resizeCanvas();
    this.render();
  };

  private updateMouse(e: MouseEvent): void {
    this.mouse = { x: e.clientX * this.dpr, y: e.clientY * this.dpr };
    if (!this.layout) return;
    this.hoverSlot = slotAt(this.layout, this.mouse.x, this.mouse.y);
    this.hoverClose = contains(this.layout.closeButton, this.mouse.x, this.mouse.y);
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.updateMouse(e);
    const slot = this.hoverSlot;
    if (this.drag && slot !== null && !this.drag.slots.includes(slot)) this.drag.slots.push(slot);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    if (!this.screen || !this.layout) return;
    this.updateMouse(e);
    const button: ClickButton | null = e.button === 0 ? 'left' : e.button === 2 ? 'right' : null;
    const player = this.player;
    if (!button || !player) return;
    const inventory = player.inventory;
    if (this.hoverClose && button === 'left') return this.close();
    const slot = this.hoverSlot;
    if (slot === null) {
      // Outside the panel, a click throws the cursor stack (all with left, one with right).
      if (inventory.cursor && !contains(this.layout.panel, this.mouse.x, this.mouse.y))
        this.throwStack('cursor', button === 'left');
      return;
    }
    if (e.shiftKey) return this.clickSlot(slot, button, true);
    const now = performance.now();
    if (
      button === 'left' &&
      inventory.cursor &&
      this.lastPick.slot === slot &&
      now - this.lastPick.time < DOUBLE_CLICK_MS
    ) {
      this.lastPick.slot = -1;
      return inventory.doubleClick();
    }
    if (inventory.cursor) {
      // A held stack may be spread over several slots; the press decides on release.
      this.drag = { button, slots: [slot] };
      return;
    }
    this.clickSlot(slot, button);
    this.lastPick = { slot: inventory.cursor ? slot : -1, time: now };
  };

  private readonly onMouseUp = (): void => {
    const drag = this.drag;
    this.drag = null;
    const player = this.player;
    if (!drag || !player) return;
    if (drag.slots.length === 1) this.clickSlot(drag.slots[0]!, drag.button);
    else player.inventory.drag(drag.slots, drag.button);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.screen) this.close();
      else if (this.player) this.open('inventory');
      e.preventDefault();
    } else if (e.code === 'Escape' && this.screen) {
      this.close();
    } else if (e.code === 'KeyQ' && this.player) {
      // Open: the hovered slot. Closed: the selected hotbar slot.
      const target = this.screen ? this.hoverSlot : this.player.selectedSlot;
      if (target !== null) this.throwStack(target, e.ctrlKey);
      e.preventDefault();
    }
  };
}

/** Holder for the running UI, so the debug API can reach it. */
export const activeUi: { manager: UiManager | null } = { manager: null };

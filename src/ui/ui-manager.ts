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
import { computeKilnLayout, kilnSlotAt, KILN_SLOT_COUNT, type KilnLayout } from './kiln-layout';
import { drawKilnScreen, kilnTooltipFor } from './kiln-screen';
import type { BlockEntityInstance } from '../world/block-entities';
import { createKilnState, type KilnState } from '../gameplay/kiln';
import { items } from '../gameplay/items';
import { smelting } from '../gameplay/smelting';
import { addXp } from '../gameplay/xp';
import type { Rect } from './ui-kit';

export type ScreenName = 'inventory' | 'kiln';
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
  activeKiln: BlockEntityInstance<KilnState> | null = null;
  // The 2D canvases are created on first open, so startup does not pay for them.
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sheet!: HTMLCanvasElement;
  private icons!: IconSheet;
  private layout: InventoryLayout | null = null;
  private kilnLayout: KilnLayout | null = null;
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

  open(name: ScreenName, entity?: BlockEntityInstance<KilnState>): void {
    if (name !== 'inventory' && name !== 'kiln') throw new Error(`Unknown screen: ${name}`);
    this.requirePlayer();
    if (this.screen) return;
    this.ensureCanvases();
    this.screen = name;
    if (name === 'kiln') {
      if (entity) {
        this.activeKiln = entity;
      } else {
        const ctrl = this.controller();
        let found: BlockEntityInstance<KilnState> | null = null;
        const player = ctrl?.player;
        if (ctrl?.interaction?.target.hit && player) {
          const hit = ctrl.interaction.target;
          const be = player.collision.world.blockEntities.get<KilnState>(hit.x, hit.y, hit.z);
          if (be && be.blockId === 'kiln') found = be;
        }
        if (!found && player) {
          const all = player.collision.world.blockEntities.getAll();
          const be = all.find((e) => e.blockId === 'kiln');
          if (be) found = be as BlockEntityInstance<KilnState>;
        }
        this.activeKiln = found ?? {
          blockId: 'kiln',
          x: 0,
          y: 0,
          z: 0,
          state: createKilnState(0, 0, 0, 0),
        };
      }
    }
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
    this.activeKiln = null;
    this.layout = null;
    this.kilnLayout = null;
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
    const player = this.requirePlayer();
    if (this.screen === 'kiln') {
      if (!Number.isInteger(slot) || slot < 0 || slot >= KILN_SLOT_COUNT) {
        throw new Error('Invalid kiln slot');
      }
      this.handleKilnSlot(slot, button, shift, player);
      return;
    }
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT)
      throw new Error('Invalid inventory slot');
    const inventory = player.inventory;
    if (shift) inventory.shiftClick(slot);
    else if (button === 'left') inventory.leftClick(slot);
    else inventory.rightClick(slot);
  }

  private handleKilnSlot(slot: number, button: ClickButton, shift: boolean, player: Player): void {
    if (!this.activeKiln) return;
    const kiln = this.activeKiln.state;
    const inv = player.inventory;

    if (slot === 0 || slot === 1) {
      const slotKey = slot === 0 ? 'input' : 'fuel';
      const current = kiln[slotKey];
      if (shift) {
        if (current) {
          inv.route(current);
          if (current.count <= 0) kiln[slotKey] = null;
        }
        return;
      }

      if (button === 'left') {
        if (!inv.cursor) {
          if (current) {
            inv.cursor = {
              id: current.id,
              count: current.count,
              damage: current.damage ?? undefined,
            };
            kiln[slotKey] = null;
          }
        } else {
          const cursor = inv.cursor;
          if (!current) {
            kiln[slotKey] = {
              id: cursor.id,
              count: cursor.count,
              damage: cursor.damage ?? null,
            };
            inv.cursor = null;
          } else if (current.id === cursor.id) {
            const max = items.get(current.id).maxStack;
            const canAdd = Math.min(cursor.count, max - current.count);
            current.count += canAdd;
            cursor.count -= canAdd;
            if (cursor.count <= 0) inv.cursor = null;
          } else {
            const temp = {
              id: current.id,
              count: current.count,
              damage: current.damage ?? undefined,
            };
            kiln[slotKey] = {
              id: cursor.id,
              count: cursor.count,
              damage: cursor.damage ?? null,
            };
            inv.cursor = temp;
          }
        }
      } else if (button === 'right') {
        if (!inv.cursor) {
          if (current) {
            const take = Math.ceil(current.count / 2);
            inv.cursor = {
              id: current.id,
              count: take,
              damage: current.damage ?? undefined,
            };
            current.count -= take;
            if (current.count <= 0) kiln[slotKey] = null;
          }
        } else {
          const cursor = inv.cursor;
          if (!current) {
            kiln[slotKey] = {
              id: cursor.id,
              count: 1,
              damage: cursor.damage ?? null,
            };
            cursor.count--;
            if (cursor.count <= 0) inv.cursor = null;
          } else if (current.id === cursor.id) {
            const max = items.get(current.id).maxStack;
            if (current.count < max) {
              current.count++;
              cursor.count--;
              if (cursor.count <= 0) inv.cursor = null;
            }
          }
        }
      }
    } else if (slot === 2) {
      if (!kiln.output) return;
      if (shift) {
        const before = kiln.output.count;
        inv.route(kiln.output);
        const moved = before - (kiln.output ? kiln.output.count : 0);
        if (moved > 0) {
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
        }
        if (kiln.output.count <= 0) kiln.output = null;
        return;
      }

      if (button === 'left') {
        if (!inv.cursor) {
          inv.cursor = {
            id: kiln.output.id,
            count: kiln.output.count,
            damage: kiln.output.damage ?? undefined,
          };
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
          kiln.output = null;
        } else if (inv.cursor.id === kiln.output.id) {
          const max = items.get(kiln.output.id).maxStack;
          const canAdd = Math.min(kiln.output.count, max - inv.cursor.count);
          if (canAdd > 0) {
            inv.cursor.count += canAdd;
            kiln.output.count -= canAdd;
            addXp(player, kiln.storedXp);
            kiln.storedXp = 0;
            if (kiln.output.count <= 0) kiln.output = null;
          }
        }
      } else if (button === 'right') {
        if (!inv.cursor) {
          const take = Math.ceil(kiln.output.count / 2);
          inv.cursor = {
            id: kiln.output.id,
            count: take,
            damage: kiln.output.damage ?? undefined,
          };
          kiln.output.count -= take;
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
          if (kiln.output.count <= 0) kiln.output = null;
        } else if (inv.cursor.id === kiln.output.id) {
          const max = items.get(kiln.output.id).maxStack;
          if (inv.cursor.count < max) {
            inv.cursor.count++;
            kiln.output.count--;
            addXp(player, kiln.storedXp);
            kiln.storedXp = 0;
            if (kiln.output.count <= 0) kiln.output = null;
          }
        }
      }
    } else {
      const pSlot = slot <= 11 ? slot - 3 : slot - 12 + 9;
      if (!shift) {
        if (button === 'left') inv.leftClick(pSlot);
        else inv.rightClick(pSlot);
      } else {
        const stack = inv.slots[pSlot];
        if (!stack) return;
        const isFuel = smelting.isFuel(stack.id);
        const isSmeltable = smelting.getByInput(stack.id) !== undefined;
        if (
          isFuel &&
          (!kiln.fuel ||
            (kiln.fuel.id === stack.id && kiln.fuel.count < items.get(stack.id).maxStack))
        ) {
          if (!kiln.fuel) {
            kiln.fuel = {
              id: stack.id,
              count: stack.count,
              damage: stack.damage ?? null,
            };
            inv.slots[pSlot] = null;
          } else {
            const max = items.get(stack.id).maxStack;
            const add = Math.min(stack.count, max - kiln.fuel.count);
            kiln.fuel.count += add;
            stack.count -= add;
            if (stack.count <= 0) inv.slots[pSlot] = null;
          }
        } else if (
          isSmeltable &&
          (!kiln.input ||
            (kiln.input.id === stack.id && kiln.input.count < items.get(stack.id).maxStack))
        ) {
          if (!kiln.input) {
            kiln.input = {
              id: stack.id,
              count: stack.count,
              damage: stack.damage ?? null,
            };
            inv.slots[pSlot] = null;
          } else {
            const max = items.get(stack.id).maxStack;
            const add = Math.min(stack.count, max - kiln.input.count);
            kiln.input.count += add;
            stack.count -= add;
            if (stack.count <= 0) inv.slots[pSlot] = null;
          }
        } else {
          inv.shiftClick(pSlot);
        }
      }
    }
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
    const css = (r: Rect): Rect => ({
      x: r.x / this.dpr,
      y: r.y / this.dpr,
      w: r.w / this.dpr,
      h: r.h / this.dpr,
    });
    if (this.screen === 'kiln') {
      const layout = this.kilnLayout;
      const inv = this.player?.inventory;
      const kiln = this.activeKiln?.state ?? createKilnState(0, 0, 0, 0);
      return {
        name: this.screen,
        scale: layout?.scale ?? 0,
        panel: layout ? css(layout.panel) : null,
        slots: layout ? layout.slots.map(css) : [],
        closeButton: layout ? css(layout.closeButton) : null,
        hoverSlot: this.hoverSlot,
        tooltip: inv ? kilnTooltipFor(inv, kiln, this.hoverSlot) : null,
      };
    }
    const layout = this.screen ? this.layout : null;
    const inv = this.player?.inventory;
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
    if (this.screen === 'kiln') {
      this.kilnLayout = computeKilnLayout(this.canvas.width, this.canvas.height);
      drawKilnScreen(
        this.ctx,
        {
          layout: this.kilnLayout,
          inventory: player.inventory,
          kiln: this.activeKiln ? this.activeKiln.state : createKilnState(0, 0, 0, 0),
          hoverSlot: this.hoverSlot,
          hoverClose: this.hoverClose,
          mouse: this.mouse,
          width: this.canvas.width,
          height: this.canvas.height,
        },
        this.icons,
        this.sheet,
      );
      return;
    }
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
    if (this.screen === 'kiln') {
      if (!this.kilnLayout) return;
      this.hoverSlot = kilnSlotAt(this.kilnLayout, this.mouse.x, this.mouse.y);
      this.hoverClose = contains(this.kilnLayout.closeButton, this.mouse.x, this.mouse.y);
    } else {
      if (!this.layout) return;
      this.hoverSlot = slotAt(this.layout, this.mouse.x, this.mouse.y);
      this.hoverClose = contains(this.layout.closeButton, this.mouse.x, this.mouse.y);
    }
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.updateMouse(e);
    const slot = this.hoverSlot;
    if (this.drag && slot !== null && !this.drag.slots.includes(slot)) this.drag.slots.push(slot);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    if (!this.screen) return;
    this.updateMouse(e);
    const button: ClickButton | null = e.button === 0 ? 'left' : e.button === 2 ? 'right' : null;
    const player = this.player;
    if (!button || !player) return;
    const inventory = player.inventory;
    if (this.hoverClose && button === 'left') return this.close();
    const slot = this.hoverSlot;
    if (slot === null) {
      // Outside the panel, a click throws the cursor stack (all with left, one with right).
      const panel = this.screen === 'kiln' ? this.kilnLayout?.panel : this.layout?.panel;
      if (inventory.cursor && panel && !contains(panel, this.mouse.x, this.mouse.y))
        this.throwStack('cursor', button === 'left');
      return;
    }
    if (e.shiftKey) return this.clickSlot(slot, button, true);
    const now = performance.now();
    if (
      this.screen === 'inventory' &&
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
    if (drag.slots.length === 1) {
      this.clickSlot(drag.slots[0]!, drag.button);
      return;
    }
    if (this.screen === 'kiln') {
      const playerSlots: number[] = [];
      for (const s of drag.slots) {
        if (s >= 3 && s <= 38) {
          playerSlots.push(s <= 11 ? s - 3 : s - 12 + 9);
        }
      }
      if (playerSlots.length > 0) {
        player.inventory.drag(playerSlots, drag.button);
      }
    } else {
      player.inventory.drag(drag.slots, drag.button);
    }
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

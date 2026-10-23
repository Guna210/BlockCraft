import type { InputEngine } from '../engine/input';
import type { PlayerController } from '../engine/player-controller';
import { dropInventoryStack } from '../gameplay/inventory-drop';
import type { InventoryTarget, ItemStack } from '../gameplay/inventory';
import type { Player } from '../entity/player';
import type { IconSheet } from './icons';
import {
  computeLayout,
  contains,
  PANEL_H,
  PANEL_W,
  type InventoryLayout,
} from './inventory-layout';
import { drawInventoryScreen, tooltipFor } from './inventory-screen';
import {
  BOOK_FILTER,
  BOOK_NEXT,
  BOOK_PANEL_W,
  BOOK_PREV,
  BOOK_ROWS,
  BOOK_SEARCH,
  CHEST_PANEL_H,
  CHEST_PANEL_W,
  CRAFT_BOOK_BUTTON,
  CRAFT_FILTER_BUTTON,
  CRAFT_OUTPUT,
  CRAFT_PANEL_H,
  CRAFT_PANEL_W,
  RECIPE_BASE_CRAFTING,
  RECIPE_BASE_INVENTORY,
  bookRowRects,
  craftGridRects,
  drawChestScreen,
  drawCraftPanel,
  drawRecipeBookPanel,
  type BookRow,
} from './crafting-screen';
import { UI, drawButton, drawPanel, uiScaleFor, type Rect } from './ui-kit';
import { displayName, displayItemStackName, drawText, textWidth } from './pixel-font';
import { crafting } from '../gameplay/crafting';
import {
  canFillRecipe,
  fillRecipe,
  takeCraftingOutput,
  type CraftingSlot,
} from '../gameplay/crafting-session';
import { isItemAffix, items, type ItemAffix } from '../gameplay/items';
import { computeKilnLayout, type KilnLayout } from './kiln-layout';
import { drawKilnScreen, kilnTooltipFor } from './kiln-screen';
import type { BlockEntityInstance } from '../world/block-entities';
import type { KilnState } from '../gameplay/kiln';
import { smelting } from '../gameplay/smelting';
import { addXp } from '../gameplay/xp';
import { chestStorageAt, type ChestStorage, type ChestSlot } from '../gameplay/chests';
import { isActionCode } from '../engine/keybinds';
import { settings } from '../engine/settings';

export type ScreenName =
  'inventory' | 'crafting' | 'chest' | 'kiln' | 'death' | 'sleeping' | 'pause';
export type ClickButton = 'left' | 'right';

interface ExternalItemStack {
  id: string;
  count: number;
  damage?: number | null;
  affix?: ItemAffix;
}

function sameItemStackKind(a: ExternalItemStack, b: ExternalItemStack): boolean {
  return a.id === b.id && (a.damage ?? null) === (b.damage ?? null) && a.affix === b.affix;
}

function toExternalItemStack(stack: {
  id: string;
  count: number;
  damage?: unknown;
  affix?: unknown;
}): ExternalItemStack {
  return {
    id: stack.id,
    count: stack.count,
    ...(typeof stack.damage === 'number' || stack.damage === null ? { damage: stack.damage } : {}),
    ...(isItemAffix(stack.affix) ? { affix: stack.affix } : {}),
  };
}

export interface ScreenSnapshot {
  name: ScreenName | null;
  /** Canvas pixels per UI pixel (an integer). */
  scale: number;
  /** The full visible screen rectangle in CSS pixels. */
  panel: Rect | null;
  /** Clickable slot rectangles indexed by uiClickSlot's slot argument. */
  slots: Rect[];
  closeButton: Rect | null;
  hoverSlot: number | null;
  tooltip: string | null;
  craftingSlots: Rect[];
  outputSlot: Rect | null;
  recipeSlots: Rect[];
  recipeIds: Array<string | null>;
  recipeBookButton: Rect | null;
  craftableFilterButton: Rect | null;
  recipeFilterButton: Rect | null;
  searchField: Rect | null;
  searchText: string;
  craftableOnly: boolean;
  doubleChest: boolean;
  /** The kiln's flame indicator in CSS pixels; null outside the kiln screen. */
  flameBox: Rect | null;
  cause: string | null;
  respawnButton: Rect | null;
  /** Pause menu buttons in CSS pixels; null outside the pause menu. */
  resumeButton: Rect | null;
  saveQuitButton: Rect | null;
  settingsButton: Rect | null;
  message: string | null;
}

const DOUBLE_CLICK_MS = 400;
const THROW_SPEED = 4;
const THROW_PICKUP_DELAY_TICKS = 40;
const INVENTORY_CRAFT_BASE = 41;
const INVENTORY_OUTPUT_SLOT = 45;
const CRAFTING_OUTPUT_SLOT = 9;
const CHEST_RADIUS = 4.5;
const KILN_RADIUS = 4.5;
const CRAFT_PANEL_X = PANEL_W + 6;
const BOOK_PANEL_X = CRAFT_PANEL_X + CRAFT_PANEL_W + 6;

interface ClickTarget {
  slot: number;
  rect: Rect;
}

interface ScreenControls {
  close: Rect | null;
  book: Rect | null;
  craftFilter: Rect | null;
  search: Rect | null;
  bookFilter: Rect | null;
  previous: Rect | null;
  next: Rect | null;
}

/** The overlay canvas owns inventory, crafting, recipe-book and chest input. */
export class UiManager {
  screen: ScreenName | null = null;
  /** Independent settings DOM overlay sits above the menu or pause canvas. */
  public settingsOverlayOpen = false;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sheet!: HTMLCanvasElement;
  private icons!: IconSheet;
  private layout: InventoryLayout | null = null;
  private dpr = 1;
  private mouse = { x: 0, y: 0 };
  private hoverSlot: number | null = null;
  private hoverClose = false;
  private hoverBook = false;
  private hoverCraftFilter = false;
  private hoverBookFilter = false;
  private hoverSearch = false;
  private hoverPrevious = false;
  private hoverNext = false;
  private hoverRecipeRow: number | null = null;
  private drag: { button: ClickButton; slots: number[] } | null = null;
  private lastPick = { slot: -1, time: 0 };
  private wasLocked = false;
  private grid: CraftingSlot[] = [];
  private dimension: 2 | 3 = 2;
  private chestStorage: ChestStorage | null = null;
  activeKiln: BlockEntityInstance<KilnState> | null = null;
  private kilnLayout: KilnLayout | null = null;
  private bookOpen = false;
  private searchFocused = false;
  private searchText = '';
  private craftableOnly = false;
  private bookPage = 0;
  private bookRows: BookRow[] = [];
  private screenSlots: Rect[] = [];
  private clickTargets: ClickTarget[] = [];
  private craftingSlotRects: Rect[] = [];
  private outputRect: Rect | null = null;
  private recipeSlotRects: Rect[] = [];
  private panelRect: Rect | null = null;
  private closeRect: Rect | null = null;
  private deathCause: string | null = null;
  private respawnRect: Rect | null = null;
  private resumeRect: Rect | null = null;
  private saveQuitRect: Rect | null = null;
  private settingsRect: Rect | null = null;
  private quitting = false;
  private sleepFade = 0;
  private messageText: string | null = null;
  private messageTimer: number | undefined;
  private damageOverlay: HTMLDivElement | null = null;
  private pauseSettingsButton: HTMLButtonElement | null = null;
  private damageTimer: number | undefined;
  private messageElement: HTMLDivElement | null = null;
  public onRespawn: () => void = () => {};
  /** Pause menu "Save & Quit": saves and leaves the world (main.ts returns to the main menu). */
  public onSaveAndQuit: () => Promise<void> = async () => {};
  /** Opens the independent settings overlay over the menu or pause screen. */
  public onOpenSettings: () => void = () => {};
  private controls: ScreenControls = {
    close: null,
    book: null,
    craftFilter: null,
    search: null,
    bookFilter: null,
    previous: null,
    next: null,
  };

  constructor(
    private readonly input: InputEngine,
    private readonly controller: () => PlayerController | null,
    private readonly iconSource: () => IconSheet,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
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
    style.zIndex = '6';
    this.canvas.id = 'ui-canvas';
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.appendChild(this.canvas);
    this.pauseSettingsButton = document.createElement('button');
    this.pauseSettingsButton.type = 'button';
    this.pauseSettingsButton.setAttribute('aria-label', 'Settings');
    Object.assign(this.pauseSettingsButton.style, {
      position: 'fixed',
      display: 'none',
      margin: '0',
      padding: '0',
      border: '0',
      color: 'transparent',
      background: 'transparent',
      outline: 'none',
      cursor: 'pointer',
      zIndex: '7',
      font: '1px monospace',
    });
    this.pauseSettingsButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenSettings();
    });
    document.body.appendChild(this.pauseSettingsButton);
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
    if (name === 'death' || name === 'sleeping')
      throw new Error('Death and sleeping screens are controlled by gameplay');
    if (name === 'pause') {
      this.requirePlayer();
      this.openPause();
      return;
    }
    if (name === 'chest') {
      const target = this.findNearbyChest();
      if (!target) throw new Error('No chest is within reach');
      this.openChest(target[0], target[1], target[2]);
      return;
    }
    if (name === 'kiln') {
      const target = this.findNearbyKiln();
      if (!target) throw new Error('No kiln is within reach');
      this.openKiln(target);
      return;
    }
    this.startOpen(name);
  }

  showDeath(cause: string): void {
    const player = this.player;
    const drops = this.controller()?.itemEntities;
    if (!player || !drops) return;
    this.ensureCanvases();
    const [x, y, z] = player.pos;
    const spill = (id: string, count: number) => {
      drops.spawn(
        id,
        count,
        x + (Math.random() - 0.5) * 0.5,
        y + Math.random() * 0.2,
        z + (Math.random() - 0.5) * 0.5,
        {
          velocity: [(Math.random() - 0.5) * 0.8, 1.4, (Math.random() - 0.5) * 0.8],
          pickupDelay: 40,
        },
      );
    };
    for (const stack of this.grid) if (stack) spill(stack.id, stack.count);
    this.grid = [];
    if (player.inventory.cursor) {
      spill(player.inventory.cursor.id, player.inventory.cursor.count);
      player.inventory.cursor = null;
    }
    if (!this.screen) {
      this.wasLocked = this.input.pointerLocked;
      if (this.wasLocked) document.exitPointerLock();
    }
    this.input.setCapture(true);
    this.screen = 'death';
    this.deathCause = cause;
    this.chestStorage = null;
    this.activeKiln = null;
    this.kilnLayout = null;
    this.bookOpen = false;
    this.searchFocused = false;
    this.drag = null;
    this.canvas.style.display = 'block';
    this.resizeCanvas();
    this.hoverSlot = null;
    this.render();
  }

  /**
   * Opens the pause menu over a played world: the game loop pauses (which saves, M17b) until
   * Resume, Esc or Save & Quit.
   */
  openPause(): void {
    const controller = this.controller();
    if (this.screen || !controller?.player || controller.player.dead) return;
    this.ensureCanvases();
    this.wasLocked = this.input.pointerLocked;
    this.input.setCapture(true);
    if (this.wasLocked) document.exitPointerLock();
    this.screen = 'pause';
    this.quitting = false;
    this.grid = [];
    this.chestStorage = null;
    this.activeKiln = null;
    this.bookOpen = false;
    this.searchFocused = false;
    this.drag = null;
    controller.loop.pause();
    this.canvas.style.display = 'block';
    this.resizeCanvas();
    this.hoverSlot = null;
    this.render();
  }

  private async saveAndQuit(): Promise<void> {
    if (this.screen !== 'pause' || this.quitting) return;
    this.quitting = true;
    this.render();
    try {
      await this.onSaveAndQuit();
    } finally {
      this.quitting = false;
      this.screen = null;
      this.resumeRect = null;
      this.saveQuitRect = null;
      this.canvas.style.display = 'none';
      if (this.pauseSettingsButton) this.pauseSettingsButton.style.display = 'none';
      this.input.setCapture(false);
    }
  }

  showMessage(text: string, durationMs = 1800): void {
    this.messageText = text;
    if (!this.messageElement) {
      this.messageElement = document.createElement('div');
      this.messageElement.id = 'game-message';
      Object.assign(this.messageElement.style, {
        position: 'fixed',
        left: '50%',
        bottom: '22%',
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        color: UI.text,
        background: UI.outline,
        border: `2px solid ${UI.accent}`,
        font: 'bold 16px monospace',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: '7',
        display: 'none',
      });
      document.body.appendChild(this.messageElement);
    }
    this.messageElement.textContent = text;
    this.messageElement.style.display = 'block';
    if (this.messageTimer !== undefined) window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.messageText = null;
      if (this.messageElement) this.messageElement.style.display = 'none';
    }, durationMs);
  }

  showDamageFlash(): void {
    if (!this.damageOverlay) {
      this.damageOverlay = document.createElement('div');
      this.damageOverlay.id = 'damage-vignette';
      Object.assign(this.damageOverlay.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '3',
        opacity: '0',
        background:
          'radial-gradient(ellipse at center, rgba(175,16,36,0) 37%, rgba(175,16,36,.72) 100%), rgba(175,16,36,.12)',
      });
      document.body.appendChild(this.damageOverlay);
    }
    if (this.damageTimer !== undefined) window.clearTimeout(this.damageTimer);
    this.damageOverlay.style.transition = 'none';
    this.damageOverlay.style.opacity = '1';
    this.damageTimer = window.setTimeout(() => {
      if (!this.damageOverlay) return;
      this.damageOverlay.style.transition = 'opacity 800ms linear';
      this.damageOverlay.style.opacity = '0';
    }, 700);
  }

  fadeToBlackThen(onBlack: () => void): void {
    if (this.screen) return;
    this.ensureCanvases();
    this.wasLocked = this.input.pointerLocked;
    this.input.setCapture(true);
    if (this.wasLocked) document.exitPointerLock();
    this.screen = 'sleeping';
    this.sleepFade = 0;
    this.canvas.style.display = 'block';
    this.resizeCanvas();
    const start = performance.now();
    let applied = false;
    const animate = (now: number) => {
      if (this.screen !== 'sleeping') return;
      const elapsed = now - start;
      if (elapsed < 360) this.sleepFade = elapsed / 360;
      else if (elapsed < 560) this.sleepFade = 1;
      else this.sleepFade = Math.max(0, 1 - (elapsed - 560) / 360);
      this.render();
      if (!applied && elapsed >= 360) {
        applied = true;
        onBlack();
      }
      if (elapsed >= 920) this.finishOverlay();
      else window.requestAnimationFrame(animate);
    };
    window.requestAnimationFrame(animate);
  }

  private finishOverlay(): void {
    if (!this.screen) return;
    this.screen = null;
    this.deathCause = null;
    this.respawnRect = null;
    this.canvas.style.display = 'none';
    this.input.setCapture(false);
    if (this.wasLocked) {
      try {
        const lock = this.input.relock();
        if (lock) lock.catch(() => {});
      } catch {
        /* the browser declined; clicking the game locks the pointer again */
      }
    }
  }

  openKiln(entity: BlockEntityInstance<KilnState>): void {
    if (this.screen) this.close();
    if (this.screen) return;
    this.activeKiln = entity;
    this.startOpen('kiln');
  }

  openChest(x: number, y: number, z: number): void {
    const world = this.requirePlayer().collision.world;
    const storage = chestStorageAt(world, x, y, z);
    if (!storage) throw new Error('Chest block entity is unavailable');
    if (this.screen) this.close();
    if (this.screen) return;
    this.chestStorage = storage;
    this.startOpen('chest');
  }

  private startOpen(name: Exclude<ScreenName, 'chest'> | 'chest'): void {
    this.requirePlayer();
    if (this.screen) this.close();
    if (this.screen) return;
    this.ensureCanvases();
    this.screen = name;
    this.dimension = name === 'crafting' ? 3 : 2;
    this.grid =
      name === 'chest' || name === 'kiln'
        ? []
        : Array.from({ length: this.dimension * this.dimension }, () => null);
    if (name !== 'chest') this.chestStorage = null;
    if (name !== 'kiln') this.activeKiln = null;
    this.bookOpen = false;
    this.searchFocused = false;
    this.searchText = '';
    this.craftableOnly = false;
    this.bookPage = 0;
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

  /** Returns cursor and crafting-grid items before closing; a full drop pool leaves the screen open. */
  close(): void {
    if (!this.screen || this.screen === 'death' || this.screen === 'sleeping') return;
    if (this.screen === 'pause') {
      if (this.quitting) return;
      this.controller()?.loop.resume();
      this.resumeRect = null;
      this.saveQuitRect = null;
    }
    const player = this.player;
    if (player) {
      if (this.grid.length && !this.returnCraftGrid()) {
        this.render();
        return;
      }
      player.inventory.returnCursor();
      if (player.inventory.cursor) this.throwStack('cursor', true);
    }
    this.screen = null;
    this.grid = [];
    this.chestStorage = null;
    this.activeKiln = null;
    this.kilnLayout = null;
    this.bookOpen = false;
    this.searchFocused = false;
    this.drag = null;
    this.canvas.style.display = 'none';
    if (this.pauseSettingsButton) this.pauseSettingsButton.style.display = 'none';
    this.input.setCapture(false);
    if (this.wasLocked) {
      try {
        const lock = this.input.relock();
        if (lock) lock.catch(() => {});
      } catch {
        /* the browser declined; clicking the game locks the pointer again */
      }
    }
  }

  private returnCraftGrid(): boolean {
    const player = this.player;
    const controller = this.controller();
    if (!player) return true;
    for (let i = 0; i < this.grid.length; i++) {
      const stack = this.grid[i];
      if (!stack) continue;
      const move = Math.min(stack.count, player.inventory.capacity(stack.id));
      if (move > 0) {
        player.inventory.insert(stack.id, move);
        stack.count -= move;
      }
      if (stack.count > 0) {
        if (!controller?.itemEntities) return false;
        const [x, y, z] = player.pos;
        if (!controller.itemEntities.spawn(stack.id, stack.count, x, y + 0.5, z)) return false;
      }
      this.grid[i] = null;
    }
    return true;
  }

  private findNearbyChest(): [number, number, number] | null {
    const player = this.requirePlayer();
    const world = player.collision.world;
    const px = player.pos[0];
    const py = player.pos[1] + player.eye;
    const pz = player.pos[2];
    let nearest: [number, number, number] | null = null;
    let nearestDistance = CHEST_RADIUS * CHEST_RADIUS;
    for (let x = Math.floor(px) - 5; x <= Math.floor(px) + 5; x++)
      for (let y = Math.floor(py) - 4; y <= Math.floor(py) + 2; y++)
        for (let z = Math.floor(pz) - 5; z <= Math.floor(pz) + 5; z++) {
          if (world.getBlock(x, y, z).id !== 'chest') continue;
          const distance = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 + (z + 0.5 - pz) ** 2;
          if (distance <= nearestDistance) {
            nearest = [x, y, z];
            nearestDistance = distance;
          }
        }
    return nearest;
  }

  private findNearbyKiln(): BlockEntityInstance<KilnState> | null {
    const player = this.requirePlayer();
    const world = player.collision.world;
    const px = player.pos[0];
    const py = player.pos[1] + player.eye;
    const pz = player.pos[2];
    let nearest: BlockEntityInstance<KilnState> | null = null;
    let nearestDistance = KILN_RADIUS * KILN_RADIUS;
    for (const entity of world.blockEntities.getAll()) {
      if (entity.blockId !== 'kiln') continue;
      const distance =
        (entity.x + 0.5 - px) ** 2 + (entity.y + 0.5 - py) ** 2 + (entity.z + 0.5 - pz) ** 2;
      if (distance <= nearestDistance) {
        nearest = entity as BlockEntityInstance<KilnState>;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /** The same operation a mouse click performs; shift-click quick-moves. */
  clickSlot(slot: number, button: ClickButton, shift = false): void {
    if (!Number.isInteger(slot) || slot < 0 || !this.screen) throw new Error('Invalid screen slot');
    const player = this.requirePlayer();
    const inventory = player.inventory;

    if (this.screen === 'inventory') {
      if (slot < 41) this.clickInventorySlot(slot, button, shift);
      else if (slot < INVENTORY_OUTPUT_SLOT)
        this.clickGridSlot(slot - INVENTORY_CRAFT_BASE, button, shift);
      else if (slot === INVENTORY_OUTPUT_SLOT) takeCraftingOutput(this.grid, inventory, shift);
      else this.selectRecipe(slot - RECIPE_BASE_INVENTORY);
    } else if (this.screen === 'crafting') {
      if (slot < CRAFTING_OUTPUT_SLOT) this.clickGridSlot(slot, button, shift);
      else if (slot === CRAFTING_OUTPUT_SLOT) takeCraftingOutput(this.grid, inventory, shift);
      else if (slot < RECIPE_BASE_CRAFTING) this.clickInventorySlot(slot - 10, button, shift);
      else this.selectRecipe(slot - RECIPE_BASE_CRAFTING);
    } else if (this.screen === 'kiln') {
      this.handleKilnSlot(slot, button, shift, player);
    } else if (this.chestStorage) {
      const chestCount = this.chestSlotCount;
      if (slot < chestCount) this.clickChestSlot(slot, button, shift);
      else if (slot < chestCount + 41) this.clickInventorySlot(slot - chestCount, button, shift);
    }
    this.render();
  }

  private clickInventorySlot(slot: number, button: ClickButton, shift: boolean): void {
    const inventory = this.requirePlayer().inventory;
    if (this.screen === 'chest' && shift) {
      this.quickMoveInventoryToChest(slot);
      return;
    }
    if (this.screen !== 'chest' && shift && slot >= 0 && slot < 36) {
      inventory.shiftClick(slot);
      return;
    }
    if (shift) {
      inventory.shiftClick(slot);
      return;
    }
    if (button === 'left') inventory.leftClick(slot);
    else inventory.rightClick(slot);
  }

  private clickGridSlot(slot: number, button: ClickButton, shift: boolean): void {
    if (slot < 0 || slot >= this.grid.length) return;
    if (shift) {
      const stack = this.grid[slot];
      if (!stack) return;
      const inventory = this.requirePlayer().inventory;
      const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
      if (moved) inventory.insert(stack.id, moved, stack);
      stack.count -= moved;
      if (!stack.count) this.grid[slot] = null;
      return;
    }
    this.clickExternalSlot(
      () => this.grid[slot] ?? null,
      (stack) => (this.grid[slot] = stack),
      button,
    );
  }

  private clickChestSlot(slot: number, button: ClickButton, shift: boolean): void {
    if (shift) {
      this.quickMoveChestToInventory(slot);
      return;
    }
    this.clickExternalSlot(
      () => {
        const stack = this.getChestSlot(slot);
        return stack ? toExternalItemStack(stack) : null;
      },
      (stack) => this.setChestSlot(slot, stack),
      button,
    );
  }

  private clickExternalSlot(
    read: () => ExternalItemStack | null,
    write: (stack: ExternalItemStack | null) => void,
    button: ClickButton,
  ): void {
    const inventory = this.requirePlayer().inventory;
    const slotStack = read();
    const cursor = inventory.cursor;
    if (button === 'left') {
      if (!cursor) {
        inventory.cursor = slotStack ? { ...slotStack } : null;
        write(null);
      } else if (
        slotStack &&
        sameItemStackKind(slotStack, cursor) &&
        items.get(cursor.id).maxStack > 1 &&
        slotStack.count < items.get(cursor.id).maxStack
      ) {
        const moved = Math.min(cursor.count, items.get(cursor.id).maxStack - slotStack.count);
        slotStack.count += moved;
        cursor.count -= moved;
        if (!cursor.count) inventory.cursor = null;
      } else {
        write(cursor);
        inventory.cursor = slotStack ? { ...slotStack } : null;
      }
    } else if (!cursor && slotStack) {
      const half = Math.ceil(slotStack.count / 2);
      inventory.cursor = { ...slotStack, count: half };
      slotStack.count -= half;
      write(slotStack.count ? slotStack : null);
    } else if (
      cursor &&
      (!slotStack ||
        (sameItemStackKind(slotStack, cursor) && slotStack.count < items.get(cursor.id).maxStack))
    ) {
      if (slotStack) slotStack.count++;
      else write({ ...cursor, count: 1 });
      cursor.count--;
      if (!cursor.count) inventory.cursor = null;
    }
    inventory.assertInvariant();
  }

  private get chestSlotCount(): number {
    return (this.chestStorage?.halves.length ?? 0) * 27;
  }

  private getChestSlot(slot: number): ChestSlot | null {
    const halves = this.chestStorage?.halves;
    if (!halves || slot < 0 || slot >= halves.length * 27) return null;
    return halves[Math.floor(slot / 27)]!.slots[slot % 27] ?? null;
  }

  private setChestSlot(slot: number, stack: ExternalItemStack | null): void {
    const halves = this.chestStorage?.halves;
    if (!halves || slot < 0 || slot >= halves.length * 27) return;
    halves[Math.floor(slot / 27)]!.slots[slot % 27] = stack
      ? ({
          id: stack.id,
          count: stack.count,
          ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
          ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
        } as ChestSlot)
      : null;
  }

  private quickMoveChestToInventory(slot: number): void {
    const stored = this.getChestSlot(slot);
    if (!stored) return;
    const stack = toExternalItemStack(stored);
    const inventory = this.requirePlayer().inventory;
    const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
    if (!moved || !inventory.insert(stack.id, moved, stack)) return;
    stack.count -= moved;
    this.setChestSlot(slot, stack.count ? stack : null);
  }

  private quickMoveInventoryToChest(slot: number): void {
    const inventory = this.requirePlayer().inventory;
    const stack = inventory.slots[slot];
    if (!stack || slot < 0 || slot >= 41) return;
    let count = stack.count;
    const max = items.get(stack.id).maxStack;
    for (let target = 0; target < this.chestSlotCount && count > 0; target++) {
      const stored = this.getChestSlot(target);
      const dest = stored ? toExternalItemStack(stored) : null;
      if (!dest || !sameItemStackKind(dest, stack)) continue;
      const moved = Math.min(count, max - dest.count);
      dest.count += moved;
      stored!.count = dest.count;
      count -= moved;
    }
    for (let target = 0; target < this.chestSlotCount && count > 0; target++) {
      if (this.getChestSlot(target)) continue;
      const moved = Math.min(count, max);
      this.setChestSlot(target, {
        id: stack.id,
        count: moved,
        ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
        ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
      });
      count -= moved;
    }
    stack.count = count;
    if (count === 0) inventory.slots[slot] = null;
    inventory.assertInvariant();
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
          const source = toExternalItemStack(current);
          inv.route(source);
          current.count = source.count;
          if (current.count <= 0) kiln[slotKey] = null;
        }
        return;
      }

      if (button === 'left') {
        if (!inv.cursor) {
          if (current) {
            inv.cursor = toExternalItemStack(current);
            kiln[slotKey] = null;
          }
        } else {
          const cursor = inv.cursor;
          if (!current) {
            kiln[slotKey] = {
              id: cursor.id,
              count: cursor.count,
              damage: cursor.damage ?? null,
              ...(cursor.affix !== undefined ? { affix: cursor.affix } : {}),
            };
            inv.cursor = null;
          } else if (sameItemStackKind(toExternalItemStack(current), cursor)) {
            const max = items.get(current.id).maxStack;
            const canAdd = Math.min(cursor.count, max - current.count);
            current.count += canAdd;
            cursor.count -= canAdd;
            if (cursor.count <= 0) inv.cursor = null;
          } else {
            const temp = toExternalItemStack(current);
            kiln[slotKey] = {
              id: cursor.id,
              count: cursor.count,
              damage: cursor.damage ?? null,
              ...(cursor.affix !== undefined ? { affix: cursor.affix } : {}),
            };
            inv.cursor = temp;
          }
        }
      } else if (button === 'right') {
        if (!inv.cursor) {
          if (current) {
            const take = Math.ceil(current.count / 2);
            inv.cursor = {
              ...toExternalItemStack(current),
              count: take,
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
              ...(cursor.affix !== undefined ? { affix: cursor.affix } : {}),
            };
            cursor.count--;
            if (cursor.count <= 0) inv.cursor = null;
          } else if (sameItemStackKind(toExternalItemStack(current), cursor)) {
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
        const output = toExternalItemStack(kiln.output);
        inv.route(output);
        kiln.output.count = output.count;
        const moved = before - output.count;
        if (moved > 0) {
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
        }
        if (kiln.output.count <= 0) kiln.output = null;
        return;
      }

      if (button === 'left') {
        if (!inv.cursor) {
          inv.cursor = toExternalItemStack(kiln.output);
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
          kiln.output = null;
        } else if (sameItemStackKind(inv.cursor, toExternalItemStack(kiln.output))) {
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
            ...toExternalItemStack(kiln.output),
            count: take,
          };
          kiln.output.count -= take;
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
          if (kiln.output.count <= 0) kiln.output = null;
        } else if (sameItemStackKind(inv.cursor, toExternalItemStack(kiln.output))) {
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
            (sameItemStackKind(toExternalItemStack(kiln.fuel), stack) &&
              kiln.fuel.count < items.get(stack.id).maxStack))
        ) {
          if (!kiln.fuel) {
            kiln.fuel = {
              id: stack.id,
              count: stack.count,
              damage: stack.damage ?? null,
              ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
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
            (sameItemStackKind(toExternalItemStack(kiln.input), stack) &&
              kiln.input.count < items.get(stack.id).maxStack))
        ) {
          if (!kiln.input) {
            kiln.input = {
              id: stack.id,
              count: stack.count,
              damage: stack.damage ?? null,
              ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
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

  private throwStack(target: InventoryTarget, whole: boolean): void {
    const player = this.player;
    const itemEntities = this.controller()?.itemEntities;
    if (!player || !itemEntities) return;
    const cos = Math.cos(player.pitch);
    const dir = [
      Math.cos(player.yaw) * cos,
      Math.sin(player.pitch),
      Math.sin(player.yaw) * cos,
    ] as const;
    const eye = player.pos[1] + player.eye - 0.3;
    dropInventoryStack(
      player.inventory,
      itemEntities,
      [player.pos[0] + dir[0] * 0.3, eye + dir[1] * 0.3, player.pos[2] + dir[2] * 0.3],
      target,
      whole,
      {
        velocity: [dir[0] * THROW_SPEED, dir[1] * THROW_SPEED + 1, dir[2] * THROW_SPEED],
        pickupDelay: THROW_PICKUP_DELAY_TICKS,
      },
    );
  }

  private selectRecipe(row: number): void {
    const recipe = this.bookRows[this.bookPage * BOOK_ROWS + row];
    if (!recipe) return;
    const definition = crafting.recipes.get(recipe.recipeId);
    if (!definition) return;
    const filled = fillRecipe(
      definition,
      this.dimension,
      this.grid,
      this.requirePlayer().inventory.slots,
    );
    if (!filled) return;
    const inventory = this.requirePlayer().inventory;
    this.grid = filled.grid;
    for (let slot = 0; slot < inventory.slots.length; slot++)
      inventory.slots[slot] = filled.inventory[slot] ?? null;
  }

  private filteredRecipes(): BookRow[] {
    const player = this.player;
    if (!player) return [];
    const query = this.searchText.trim().toLowerCase();
    const rows: BookRow[] = [];
    for (const recipe of crafting.recipes.values()) {
      const resultName = displayName(recipe.result.id).toLowerCase();
      if (query && !resultName.includes(query)) continue;
      const craftable = canFillRecipe(recipe, this.dimension, this.grid, player.inventory.slots);
      if (this.craftableOnly && !craftable) continue;
      rows.push({ recipeId: recipe.id, resultId: recipe.result.id, craftable });
    }
    rows.sort(
      (a, b) =>
        displayName(a.resultId).localeCompare(displayName(b.resultId)) ||
        a.recipeId.localeCompare(b.recipeId),
    );
    return rows;
  }

  private outputStack(): ItemStack | null {
    const recipe = crafting.match(this.grid);
    return recipe ? { slot: -1, id: recipe.result.id, count: recipe.result.count } : null;
  }

  snapshot(): ScreenSnapshot {
    const css = (rect: Rect | null): Rect | null =>
      rect
        ? {
            x: rect.x / this.dpr,
            y: rect.y / this.dpr,
            w: rect.w / this.dpr,
            h: rect.h / this.dpr,
          }
        : null;
    return {
      name: this.screen,
      scale: (this.screen === 'kiln' ? this.kilnLayout?.scale : this.layout?.scale) ?? 0,
      panel: css(this.panelRect),
      slots: this.screenSlots.map((rect) => css(rect)!),
      closeButton: css(this.closeRect),
      hoverSlot: this.hoverSlot,
      tooltip: this.hoveredTooltip(),
      craftingSlots: this.craftingSlotRects.map((rect) => css(rect)!),
      outputSlot: css(this.outputRect),
      recipeSlots: this.recipeSlotRects.map((rect) => css(rect)!),
      recipeIds: Array.from(
        { length: BOOK_ROWS },
        (_, index) => this.bookRows[this.bookPage * BOOK_ROWS + index]?.recipeId ?? null,
      ),
      recipeBookButton: css(this.controls.book),
      craftableFilterButton: css(this.controls.craftFilter),
      recipeFilterButton: css(this.controls.bookFilter),
      searchField: css(this.controls.search),
      searchText: this.searchText,
      craftableOnly: this.craftableOnly,
      doubleChest: this.chestStorage?.double ?? false,
      flameBox: this.screen === 'kiln' && this.kilnLayout ? css(this.kilnLayout.flame) : null,
      cause: this.screen === 'death' ? this.deathCause : null,
      respawnButton: this.screen === 'death' ? css(this.respawnRect) : null,
      resumeButton: this.screen === 'pause' ? css(this.resumeRect) : null,
      saveQuitButton: this.screen === 'pause' ? css(this.saveQuitRect) : null,
      settingsButton: this.screen === 'pause' ? css(this.settingsRect) : null,
      message: this.messageText,
    };
  }

  private hoveredTooltip(): string | null {
    if (this.hoverSlot === null || !this.screen) return null;
    if (this.screen === 'kiln') {
      return this.activeKiln
        ? kilnTooltipFor(this.requirePlayer().inventory, this.activeKiln.state, this.hoverSlot)
        : null;
    }
    if (this.screen === 'inventory') {
      if (this.hoverSlot < 41) return tooltipFor(this.requirePlayer().inventory, this.hoverSlot);
      if (this.hoverSlot < INVENTORY_OUTPUT_SLOT) {
        const stack = this.grid[this.hoverSlot - INVENTORY_CRAFT_BASE];
        return stack ? displayItemStackName(stack.id, stack.affix) : null;
      }
      if (this.hoverSlot === INVENTORY_OUTPUT_SLOT) {
        const output = this.outputStack();
        return output ? displayName(output.id) : null;
      }
    } else if (this.screen === 'crafting') {
      if (this.hoverSlot < CRAFTING_OUTPUT_SLOT) {
        const stack = this.grid[this.hoverSlot];
        return stack ? displayItemStackName(stack.id, stack.affix) : null;
      }
      if (this.hoverSlot === CRAFTING_OUTPUT_SLOT) {
        const output = this.outputStack();
        return output ? displayName(output.id) : null;
      }
      if (this.hoverSlot < RECIPE_BASE_CRAFTING)
        return tooltipFor(this.requirePlayer().inventory, this.hoverSlot - 10);
    } else {
      if (this.hoverSlot < this.chestSlotCount) {
        const stack = this.getChestSlot(this.hoverSlot);
        return stack ? displayItemStackName(stack.id, toExternalItemStack(stack).affix) : null;
      }
      return tooltipFor(this.requirePlayer().inventory, this.hoverSlot - this.chestSlotCount);
    }
    return null;
  }

  frame(): void {
    if (this.screen) this.render();
  }

  render(): void {
    const player = this.player;
    if (!this.screen || !player) return;
    if (this.screen !== 'pause' && this.pauseSettingsButton)
      this.pauseSettingsButton.style.display = 'none';
    if (this.screen === 'death') {
      this.renderDeath();
      return;
    }
    if (this.screen === 'sleeping') {
      this.renderSleeping();
      return;
    }
    if (this.screen === 'pause') {
      this.renderPause();
      return;
    }
    this.bookRows = this.bookOpen ? this.filteredRecipes() : [];
    const pageCount = Math.max(1, Math.ceil(this.bookRows.length / BOOK_ROWS));
    this.bookPage = Math.max(0, Math.min(this.bookPage, pageCount - 1));
    const visibleRows = this.bookRows.slice(
      this.bookPage * BOOK_ROWS,
      (this.bookPage + 1) * BOOK_ROWS,
    );
    this.screenSlots = [];
    this.clickTargets = [];
    this.craftingSlotRects = [];
    this.outputRect = null;
    this.recipeSlotRects = [];
    this.controls = {
      close: null,
      book: null,
      craftFilter: null,
      search: null,
      bookFilter: null,
      previous: null,
      next: null,
    };

    if (this.screen === 'chest') {
      this.renderChest(player);
      return;
    }
    if (this.screen === 'kiln') {
      this.renderKiln(player);
      return;
    }

    const base = computeLayout(this.canvas.width, this.canvas.height);
    const scale = base.scale;
    const bookWidth = this.bookOpen ? 6 + BOOK_PANEL_W : 0;
    const totalWidth = PANEL_W + 6 + CRAFT_PANEL_W + bookWidth;
    const originX = Math.floor((this.canvas.width - totalWidth * scale) / 2);
    const shiftX = originX - base.originX;
    this.layout = {
      ...base,
      originX,
      panel: { ...base.panel, x: base.panel.x + shiftX },
      slots: base.slots.map((rect) => ({ ...rect, x: rect.x + shiftX })),
      closeButton: { ...base.closeButton, x: base.closeButton.x + shiftX },
    };
    this.panelRect = {
      x: originX,
      y: base.originY,
      w: totalWidth * scale,
      h: PANEL_H * scale,
    };
    this.closeRect = this.layout.closeButton;
    this.controls.close = this.closeRect;
    this.screenSlots = this.layout.slots.map((rect) => ({ ...rect }));
    this.layout.slots.forEach((rect, slot) => this.clickTargets.push({ slot, rect }));

    const craftX = CRAFT_PANEL_X;
    const craftY = Math.floor((PANEL_H - CRAFT_PANEL_H) / 2);
    const gridLocal = craftGridRects(this.dimension);
    const gridBase = this.screen === 'inventory' ? INVENTORY_CRAFT_BASE : 0;
    this.craftingSlotRects = gridLocal.map((rect, index) => {
      const screenSlot = gridBase + index;
      const pixel = this.toCanvasRect(rect, craftX, craftY, scale, originX, base.originY);
      this.screenSlots[screenSlot] = pixel;
      this.clickTargets.push({ slot: screenSlot, rect: pixel });
      return pixel;
    });
    const outputId = this.screen === 'inventory' ? INVENTORY_OUTPUT_SLOT : CRAFTING_OUTPUT_SLOT;
    this.outputRect = this.toCanvasRect(CRAFT_OUTPUT, craftX, craftY, scale, originX, base.originY);
    this.screenSlots[outputId] = this.outputRect;
    this.clickTargets.push({ slot: outputId, rect: this.outputRect });

    if (this.screen === 'crafting') {
      const firstInventorySlot = 10;
      this.layout.slots.forEach((rect, slot) => {
        const mapped = firstInventorySlot + slot;
        this.screenSlots[mapped] = rect;
        this.clickTargets.push({ slot: mapped, rect });
      });
    }

    let bookRects: { search: Rect; filter: Rect; rows: Rect[]; prev: Rect; next: Rect } | null =
      null;
    if (this.bookOpen) {
      const bookX = BOOK_PANEL_X;
      bookRects = this.logicalBookRects(bookX, 0, scale, originX, base.originY);
      const bookBase = this.screen === 'inventory' ? RECIPE_BASE_INVENTORY : RECIPE_BASE_CRAFTING;
      for (let i = 0; i < BOOK_ROWS; i++) {
        const rect = bookRects.rows[i]!;
        const slot = bookBase + i;
        this.recipeSlotRects.push(rect);
        this.screenSlots[slot] = rect;
        if (visibleRows[i]) this.clickTargets.push({ slot, rect });
      }
      this.controls.search = bookRects.search;
      this.controls.bookFilter = bookRects.filter;
      this.controls.previous = bookRects.prev;
      this.controls.next = bookRects.next;
    }
    this.controls.book = this.toCanvasRect(
      CRAFT_BOOK_BUTTON,
      craftX,
      craftY,
      scale,
      originX,
      base.originY,
    );
    this.controls.craftFilter = this.toCanvasRect(
      CRAFT_FILTER_BUTTON,
      craftX,
      craftY,
      scale,
      originX,
      base.originY,
    );

    const output = this.outputStack();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawInventoryScreen(
      this.ctx,
      {
        layout: this.layout,
        inventory: player.inventory,
        hoverSlot:
          this.screen === 'inventory' ? this.hoverSlot : this.inventorySlot(this.hoverSlot),
        hoverClose: this.hoverClose,
        mouse: this.mouse,
        width: this.canvas.width,
        height: this.canvas.height,
      },
      this.icons,
      this.sheet,
    );
    this.ctx.save();
    this.ctx.translate(originX, base.originY);
    const craftResult = drawCraftPanel(
      this.ctx,
      {
        x: craftX,
        y: craftY,
        scale,
        dimension: this.dimension,
        grid: this.grid,
        output,
        title: this.screen === 'inventory' ? 'CRAFT' : 'WORKBENCH',
        hoverSlots: this.hoveredCraftSlots(),
        hoverBook: this.hoverButton(this.controls.book),
        hoverFilter: this.hoverButton(this.controls.craftFilter),
      },
      this.icons,
      this.sheet,
    );
    this.controls.book = this.logicalRectToCanvas(craftResult.book, scale, originX, base.originY);
    this.controls.craftFilter = this.logicalRectToCanvas(
      craftResult.filter,
      scale,
      originX,
      base.originY,
    );
    if (bookRects) {
      const view = drawRecipeBookPanel(
        this.ctx,
        {
          x: BOOK_PANEL_X,
          y: 0,
          scale,
          searchText: this.searchText,
          searchFocused: this.searchFocused,
          craftableOnly: this.craftableOnly,
          page: this.bookPage,
          pageCount,
          rows: visibleRows,
          hoveredRow: this.hoverRecipeRow,
          hoverSearch: this.hoverSearch,
          hoverFilter: this.hoverBookFilter,
          hoverPrev: this.hoverPrevious,
          hoverNext: this.hoverNext,
        },
        this.icons,
        this.sheet,
      );
      this.controls.search = this.logicalRectToCanvas(view.search, scale, originX, base.originY);
      this.controls.bookFilter = this.logicalRectToCanvas(
        view.filter,
        scale,
        originX,
        base.originY,
      );
      this.controls.previous = this.logicalRectToCanvas(view.prev, scale, originX, base.originY);
      this.controls.next = this.logicalRectToCanvas(view.next, scale, originX, base.originY);
    }
    this.ctx.restore();
    this.setBookTargetsVisible(visibleRows.length);
    this.closeRect = this.layout.closeButton;
  }

  private renderDeath(): void {
    if (!this.canvas || !this.ctx) return;
    const scale = uiScaleFor(this.canvas.width, this.canvas.height);
    const width = Math.floor(this.canvas.width / scale);
    const height = Math.floor(this.canvas.height / scale);
    const panel = {
      x: Math.floor((width - 188) / 2),
      y: Math.floor((height - 112) / 2),
      w: 188,
      h: 112,
    };
    const button = { x: panel.x + 42, y: panel.y + 82, w: 104, h: 20 };
    this.panelRect = {
      x: panel.x * scale,
      y: panel.y * scale,
      w: panel.w * scale,
      h: panel.h * scale,
    };
    this.respawnRect = {
      x: button.x * scale,
      y: button.y * scale,
      w: button.w * scale,
      h: button.h * scale,
    };
    this.closeRect = null;
    this.controls.close = null;
    this.screenSlots = [];
    this.clickTargets = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(35, 12, 24, 0.82)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    drawPanel(this.ctx, panel, scale);
    const title = 'YOU DIED';
    drawText(
      this.ctx,
      title,
      (panel.x + Math.floor((panel.w - textWidth(title)) / 2)) * scale,
      (panel.y + 19) * scale,
      scale,
      '#ff6570',
      UI.outline,
    );
    const cause = this.deathCause ?? 'Killed';
    drawText(
      this.ctx,
      cause,
      (panel.x + Math.floor((panel.w - textWidth(cause)) / 2)) * scale,
      (panel.y + 49) * scale,
      scale,
      UI.text,
      UI.outline,
    );
    drawButton(this.ctx, button, 'RESPAWN', scale, this.hoverButton(this.respawnRect));
  }

  private renderPause(): void {
    if (!this.canvas || !this.ctx) return;
    const scale = uiScaleFor(this.canvas.width, this.canvas.height);
    const width = Math.floor(this.canvas.width / scale);
    const height = Math.floor(this.canvas.height / scale);
    const panel = {
      x: Math.floor((width - 188) / 2),
      y: Math.floor((height - 100) / 2),
      w: 188,
      h: 112,
    };
    const resume = { x: panel.x + 34, y: panel.y + 36, w: 120, h: 20 };
    const saveQuit = { x: panel.x + 34, y: panel.y + 62, w: 120, h: 20 };
    const settingsButton = { x: panel.x + 34, y: panel.y + 88, w: 120, h: 20 };
    const toCanvas = (rect: Rect): Rect => ({
      x: rect.x * scale,
      y: rect.y * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    });
    this.panelRect = toCanvas(panel);
    this.resumeRect = toCanvas(resume);
    this.saveQuitRect = toCanvas(saveQuit);
    this.settingsRect = toCanvas(settingsButton);
    if (this.pauseSettingsButton) {
      Object.assign(this.pauseSettingsButton.style, {
        display: 'block',
        left: `${this.settingsRect.x / this.dpr}px`,
        top: `${this.settingsRect.y / this.dpr}px`,
        width: `${this.settingsRect.w / this.dpr}px`,
        height: `${this.settingsRect.h / this.dpr}px`,
      });
    }
    this.closeRect = null;
    this.controls.close = null;
    this.screenSlots = [];
    this.clickTargets = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(9, 11, 20, 0.6)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    drawPanel(this.ctx, panel, scale);
    const title = this.quitting ? 'SAVING WORLD...' : 'GAME PAUSED';
    drawText(
      this.ctx,
      title,
      (panel.x + Math.floor((panel.w - textWidth(title)) / 2)) * scale,
      (panel.y + 14) * scale,
      scale,
      UI.text,
      UI.outline,
    );
    drawButton(
      this.ctx,
      resume,
      'RESUME',
      scale,
      !this.quitting && this.hoverButton(this.resumeRect),
    );
    drawButton(
      this.ctx,
      saveQuit,
      'SAVE & QUIT',
      scale,
      !this.quitting && this.hoverButton(this.saveQuitRect),
    );
    drawButton(
      this.ctx,
      settingsButton,
      'SETTINGS',
      scale,
      !this.quitting && this.hoverButton(this.settingsRect),
    );
  }

  private renderSleeping(): void {
    if (!this.canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, this.sleepFade))})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private renderKiln(player: Player): void {
    const kiln = this.activeKiln;
    if (!kiln) return;
    const layout = computeKilnLayout(this.canvas.width, this.canvas.height);
    this.kilnLayout = layout;
    this.panelRect = layout.panel;
    this.closeRect = layout.closeButton;
    this.controls.close = layout.closeButton;
    layout.slots.forEach((rect, slot) => {
      this.screenSlots[slot] = rect;
      this.clickTargets.push({ slot, rect });
    });
    drawKilnScreen(
      this.ctx,
      {
        layout,
        inventory: player.inventory,
        kiln: kiln.state,
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

  private renderChest(player: Player): void {
    const storage = this.chestStorage;
    if (!storage) return;
    const fitScale = Math.min(
      Math.floor(this.canvas.width / CHEST_PANEL_W),
      Math.floor(this.canvas.height / CHEST_PANEL_H),
    );
    const scale = Math.max(1, fitScale - 1);
    const originX = Math.floor((this.canvas.width - CHEST_PANEL_W * scale) / 2);
    const originY = Math.floor((this.canvas.height - CHEST_PANEL_H * scale) / 2);
    const chestSlots = storage.halves.flatMap((half) => half.slots);
    this.screenSlots = [];
    this.clickTargets = [];
    this.craftingSlotRects = [];
    this.outputRect = null;
    this.recipeSlotRects = [];
    this.layout = {
      ...computeLayout(this.canvas.width, this.canvas.height),
      scale,
      originX,
      originY,
    };
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalAlpha = 0.55;
    this.ctx.fillStyle = UI.outline;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalAlpha = 1;
    const drawn = drawChestScreen(this.ctx, {
      scale,
      originX,
      originY,
      inventory: player.inventory.slots,
      chestSlots,
      double: storage.double,
      hoverSlot: this.hoverSlot,
      hoverClose: this.hoverClose,
      cursor: player.inventory.cursor,
      mouse: this.mouse,
      icons: this.icons,
      sheet: this.sheet,
    });
    this.panelRect = drawn.panel;
    this.closeRect = drawn.close;
    this.controls.close = drawn.close;
    for (let slot = 0; slot < drawn.chest.length; slot++) {
      this.screenSlots[slot] = drawn.chest[slot]!;
      this.clickTargets.push({ slot, rect: drawn.chest[slot]! });
    }
    const offset = drawn.chest.length;
    for (let slot = 0; slot < drawn.inventory.length; slot++) {
      const id = offset + slot;
      this.screenSlots[id] = drawn.inventory[slot]!;
      this.clickTargets.push({ slot: id, rect: drawn.inventory[slot]! });
    }
  }

  private setBookTargetsVisible(count: number): void {
    const base = this.screen === 'inventory' ? RECIPE_BASE_INVENTORY : RECIPE_BASE_CRAFTING;
    this.clickTargets = this.clickTargets.filter(
      (target) => target.slot < base || target.slot >= base + BOOK_ROWS,
    );
    for (let row = 0; row < count; row++) {
      const slot = base + row;
      const rect = this.screenSlots[slot];
      if (rect) this.clickTargets.push({ slot, rect });
    }
  }

  private hoveredCraftSlots(): Set<number> {
    const result = new Set<number>();
    const base = this.screen === 'inventory' ? INVENTORY_CRAFT_BASE : 0;
    if (this.hoverSlot !== null) {
      const index = this.hoverSlot - base;
      if (index >= 0 && index < this.grid.length) result.add(index);
      if (
        this.hoverSlot ===
        (this.screen === 'inventory' ? INVENTORY_OUTPUT_SLOT : CRAFTING_OUTPUT_SLOT)
      )
        result.add(this.dimension * this.dimension);
    }
    return result;
  }

  private inventorySlot(slot: number | null): number | null {
    if (slot === null) return null;
    if (this.screen === 'inventory') return slot < 41 ? slot : null;
    if (this.screen === 'crafting') return slot >= 10 && slot < 51 ? slot - 10 : null;
    if (this.screen === 'kiln') {
      if (slot >= 3 && slot <= 11) return slot - 3;
      return slot >= 12 && slot <= 38 ? slot - 3 : null;
    }
    if (this.screen === 'chest')
      return slot >= this.chestSlotCount ? slot - this.chestSlotCount : null;
    return null;
  }

  private toCanvasRect(
    rect: Rect,
    x: number,
    y: number,
    scale: number,
    originX: number,
    originY: number,
  ): Rect {
    return {
      x: originX + (x + rect.x) * scale,
      y: originY + (y + rect.y) * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
  }

  private logicalRectToCanvas(rect: Rect, scale: number, originX: number, originY: number): Rect {
    return {
      x: originX + rect.x * scale,
      y: originY + rect.y * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
  }

  private logicalBookRects(
    x: number,
    y: number,
    scale: number,
    originX: number,
    originY: number,
  ): { search: Rect; filter: Rect; rows: Rect[]; prev: Rect; next: Rect } {
    const convert = (rect: Rect) => this.toCanvasRect(rect, x, y, scale, originX, originY);
    return {
      search: convert(BOOK_SEARCH),
      filter: convert(BOOK_FILTER),
      rows: bookRowRects().map(convert),
      prev: convert(BOOK_PREV),
      next: convert(BOOK_NEXT),
    };
  }

  private hoverButton(rect: Rect | null): boolean {
    return !!rect && contains(rect, this.mouse.x, this.mouse.y);
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

  private updateMouse(event: MouseEvent): void {
    this.mouse = { x: event.clientX * this.dpr, y: event.clientY * this.dpr };
    this.hoverSlot = this.slotAt(this.mouse.x, this.mouse.y);
    this.hoverClose = this.hoverButton(this.controls.close);
    this.hoverBook = this.hoverButton(this.controls.book);
    this.hoverCraftFilter = this.hoverButton(this.controls.craftFilter);
    this.hoverSearch = this.hoverButton(this.controls.search);
    this.hoverBookFilter = this.hoverButton(this.controls.bookFilter);
    this.hoverPrevious = this.hoverButton(this.controls.previous);
    this.hoverNext = this.hoverButton(this.controls.next);
    const row = this.recipeSlotRects.findIndex((rect) =>
      contains(rect, this.mouse.x, this.mouse.y),
    );
    this.hoverRecipeRow = row >= 0 ? row : null;
  }

  private slotAt(x: number, y: number): number | null {
    const target = this.clickTargets.find(({ rect }) => contains(rect, x, y));
    return target?.slot ?? null;
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.updateMouse(event);
    const slot = this.hoverSlot;
    if (this.drag && slot !== null && !this.drag.slots.includes(slot)) this.drag.slots.push(slot);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    if (!this.screen) return;
    this.updateMouse(event);
    if (this.screen === 'death') {
      if (event.button === 0 && this.hoverButton(this.respawnRect)) {
        this.onRespawn();
        if (!this.player?.dead) this.finishOverlay();
      }
      return;
    }
    if (this.screen === 'sleeping') return;
    if (this.screen === 'pause') {
      if (event.button !== 0 || this.quitting) return;
      if (this.hoverButton(this.resumeRect)) this.close();
      else if (this.hoverButton(this.saveQuitRect)) void this.saveAndQuit();
      else if (this.hoverButton(this.settingsRect)) this.onOpenSettings();
      return;
    }
    const button: ClickButton | null =
      event.button === 0 ? 'left' : event.button === 2 ? 'right' : null;
    const player = this.player;
    if (!button || !player) return;
    if (this.hoverClose && button === 'left') return this.close();
    if (this.hoverSearch && button === 'left') {
      this.searchFocused = true;
      return this.render();
    }
    if (this.hoverBook && button === 'left') {
      this.bookOpen = !this.bookOpen;
      this.searchFocused = false;
      this.bookPage = 0;
      return this.render();
    }
    if ((this.hoverBookFilter || this.hoverCraftFilter) && button === 'left') {
      this.craftableOnly = !this.craftableOnly;
      this.bookPage = 0;
      return this.render();
    }
    if (this.hoverPrevious && button === 'left') {
      this.bookPage = Math.max(0, this.bookPage - 1);
      return this.render();
    }
    if (this.hoverNext && button === 'left') {
      const count = this.filteredRecipes().length;
      this.bookPage = Math.min(Math.max(0, Math.ceil(count / BOOK_ROWS) - 1), this.bookPage + 1);
      return this.render();
    }
    this.searchFocused = false;

    const slot = this.hoverSlot;
    if (slot === null) {
      if (
        player.inventory.cursor &&
        this.panelRect &&
        !contains(this.panelRect, this.mouse.x, this.mouse.y)
      )
        this.throwStack('cursor', button === 'left');
      return;
    }
    if (event.shiftKey) return this.clickSlot(slot, button, true);
    const now = performance.now();
    if (
      button === 'left' &&
      player.inventory.cursor &&
      this.lastPick.slot === slot &&
      (event.detail === 2 || now - this.lastPick.time < DOUBLE_CLICK_MS) &&
      this.inventorySlot(slot) !== null
    ) {
      this.lastPick.slot = -1;
      player.inventory.doubleClick();
      return this.render();
    }
    if (player.inventory.cursor) {
      this.drag = { button, slots: [slot] };
      return;
    }
    this.clickSlot(slot, button);
    this.lastPick = { slot: player.inventory.cursor ? slot : -1, time: now };
  };

  private readonly onMouseUp = (): void => {
    const drag = this.drag;
    this.drag = null;
    const player = this.player;
    if (!drag || !player) return;
    if (drag.slots.length === 1) return this.clickSlot(drag.slots[0]!, drag.button);
    const inventorySlots = drag.slots.map((slot) => this.inventorySlot(slot));
    if (inventorySlots.every((slot): slot is number => slot !== null)) {
      player.inventory.drag(inventorySlots, drag.button);
      return this.render();
    }
    this.dragExternal(drag.slots, drag.button);
    this.render();
  };

  private dragExternal(slots: readonly number[], button: ClickButton): void {
    const inventory = this.requirePlayer().inventory;
    const cursor = inventory.cursor;
    if (!cursor) return;
    const external: Array<{
      read: () => ExternalItemStack | null;
      write: (stack: ExternalItemStack | null) => void;
    }> = [];
    for (const slot of [...new Set(slots)]) {
      if (
        this.screen === 'inventory' &&
        slot >= INVENTORY_CRAFT_BASE &&
        slot < INVENTORY_OUTPUT_SLOT
      ) {
        const index = slot - INVENTORY_CRAFT_BASE;
        external.push({
          read: () => this.grid[index] ?? null,
          write: (stack) => (this.grid[index] = stack),
        });
      } else if (this.screen === 'crafting' && slot < CRAFTING_OUTPUT_SLOT) {
        external.push({
          read: () => this.grid[slot] ?? null,
          write: (stack) => (this.grid[slot] = stack),
        });
      } else if (this.screen === 'chest' && slot < this.chestSlotCount) {
        external.push({
          read: () => {
            const stack = this.getChestSlot(slot);
            return stack ? toExternalItemStack(stack) : null;
          },
          write: (stack) => this.setChestSlot(slot, stack),
        });
      }
    }
    const eligible = external.filter(({ read }) => {
      const stack = read();
      return (
        !stack || (sameItemStackKind(stack, cursor) && stack.count < items.get(stack.id).maxStack)
      );
    });
    if (!eligible.length) return;
    const each = button === 'left' ? Math.floor(cursor.count / eligible.length) : 1;
    for (const target of eligible) {
      if (!cursor.count) break;
      const stack = target.read();
      const moved = Math.min(
        each,
        cursor.count,
        items.get(cursor.id).maxStack - (stack?.count ?? 0),
      );
      if (!moved) continue;
      if (stack) stack.count += moved;
      else target.write({ ...cursor, count: moved });
      cursor.count -= moved;
    }
    if (!cursor.count) inventory.cursor = null;
    inventory.assertInvariant();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.screen || !this.bookOpen || !this.controls.search) return;
    const inBook = this.recipeSlotRects.some((row) =>
      contains(row, event.clientX * this.dpr, event.clientY * this.dpr),
    );
    if (!inBook) return;
    event.preventDefault();
    const count = this.filteredRecipes().length;
    const pageCount = Math.max(1, Math.ceil(count / BOOK_ROWS));
    this.bookPage = Math.max(
      0,
      Math.min(pageCount - 1, this.bookPage + (event.deltaY > 0 ? 1 : -1)),
    );
    this.render();
  };

  /** Losing pointer lock in a played world (the browser's own Esc) opens the pause menu. */
  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement || this.screen || this.input.captured) return;
    this.openPause();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.settingsOverlayOpen) return;
    if (event.repeat) return;
    if (this.input.captured && !this.screen) return;
    if (this.screen === 'death' || this.screen === 'sleeping') {
      event.preventDefault();
      return;
    }
    if (this.screen && this.bookOpen && this.searchFocused) {
      if (isActionCode(event.code, 'menuBack', settings.keyBindings)) {
        this.searchFocused = false;
        event.preventDefault();
        this.close();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        this.searchText = '';
      } else if (event.key === 'Backspace') {
        this.searchText = this.searchText.slice(0, -1);
      } else if (event.key.length === 1 && /^[a-z0-9 _-]$/i.test(event.key)) {
        this.searchText += event.key.toLowerCase();
      } else if (isActionCode(event.code, 'menuDown', settings.keyBindings)) {
        this.bookPage++;
      } else if (isActionCode(event.code, 'menuUp', settings.keyBindings)) {
        this.bookPage = Math.max(0, this.bookPage - 1);
      } else if (!isActionCode(event.code, 'menuConfirm', settings.keyBindings)) {
        return;
      }
      this.bookPage = Math.max(
        0,
        Math.min(
          Math.max(0, Math.ceil(this.filteredRecipes().length / BOOK_ROWS) - 1),
          this.bookPage,
        ),
      );
      event.preventDefault();
      if (isActionCode(event.code, 'menuConfirm', settings.keyBindings)) this.searchFocused = false;
      return this.render();
    }
    if (
      isActionCode(event.code, 'inventory', settings.keyBindings) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (this.screen) this.close();
      else if (this.player) this.open('inventory');
      event.preventDefault();
    } else if (isActionCode(event.code, 'menuBack', settings.keyBindings) && this.screen) {
      this.close();
    } else if (isActionCode(event.code, 'menuBack', settings.keyBindings) && this.player) {
      this.openPause();
      event.preventDefault();
    } else if (isActionCode(event.code, 'drop', settings.keyBindings) && this.player) {
      const target = this.screen ? this.inventorySlot(this.hoverSlot) : this.player.selectedSlot;
      if (target !== null) this.throwStack(target, event.ctrlKey);
      event.preventDefault();
    }
  };
}

/** Holder for the running UI, so the debug API can reach it. */
export const activeUi: { manager: UiManager | null } = { manager: null };

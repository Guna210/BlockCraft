import { Inventory } from '../../gameplay/inventory';
import {
  InventoryAction as A,
  MessageType as T,
  CURSOR_SLOT,
  type Messages,
  type WindowKind,
  type WireStack,
} from '../../net/protocol';
import type { Connection } from './connection';

/** One ordered transaction queue carries the authoritative revision for each open window. */
export class RemoteInventory {
  private requestId = 0;
  private inFlightId = 0;
  private inFlightWindowId = 0;
  private pending = false;
  private initialized = false;
  private activeWindowId = 0;
  private activeWindowKind: WindowKind | null = null;
  private readonly revisions = new Uint32Array(256);
  private readonly queue: Array<{
    action: A;
    slot: number;
    slots: readonly number[];
    windowId: number;
  }> = [];
  onWindowOpen: (message: Messages[T.WindowOpen]) => void = () => {};
  onWindowClose: (windowId: number) => void = () => {};
  onWindowSnapshot: (windowId: number, slots: readonly (WireStack | null)[]) => void = () => {};
  onWindowSlot: (windowId: number, slot: number, stack: WireStack | null) => void = () => {};
  onWindowProperty: (message: Messages[T.WindowProperty]) => void = () => {};

  constructor(
    private readonly inventory: Inventory,
    private readonly connection: Pick<Connection, 'send'>,
  ) {
    inventory.leftClick = (slot) => this.enqueue(A.LeftClick, slot);
    inventory.rightClick = (slot) => this.enqueue(A.RightClick, slot);
    inventory.shiftClick = (slot) => this.enqueue(A.QuickMove, slot);
    inventory.drag = (slots, button) =>
      this.enqueue(button === 'left' ? A.DragEven : A.DragOne, 0, [...slots]);
    inventory.doubleClick = () => this.enqueue(A.CollectAll, CURSOR_SLOT);
    inventory.peekDrop = (slot, whole) => {
      this.enqueue(whole ? A.DropStack : A.DropOne, slot === 'cursor' ? CURSOR_SLOT : slot);
      return null;
    };
    // Terrain prediction does not own inventory counts, and the server returns the cursor on close.
    inventory.consumeSelected = () => {};
    inventory.returnCursor = () => {};
    const selection = Object.getOwnPropertyDescriptor(Inventory.prototype, 'selectedSlot')!;
    Object.defineProperty(inventory, 'selectedSlot', {
      get: () => selection.get!.call(inventory),
      set: (slot: number) => {
        selection.set!.call(inventory, slot);
        this.enqueue(A.SelectSlot, slot);
      },
    });
  }

  openWindow(message: Messages[T.WindowOpen]): void {
    this.activeWindowId = message.windowId;
    this.activeWindowKind = message.kind;
    this.revisions[message.windowId] = 0;
    this.onWindowOpen(message);
  }

  closeWindow(windowId: number): void {
    this.onWindowClose(windowId);
    this.revisions[windowId] = 0;
    if (windowId === this.activeWindowId) {
      this.activeWindowId = 0;
      this.activeWindowKind = null;
    }
  }

  property(message: Messages[T.WindowProperty]): void {
    if (message.windowId === this.activeWindowId) this.onWindowProperty(message);
  }

  enqueueWindowAction(action: A, slot: number, slots: readonly number[] = []): void {
    this.enqueue(action, slot, slots, this.activeWindowId);
  }

  sync(message: Messages[T.InventorySync] | Messages[T.InventorySlot]): void {
    const windowId = message.windowId;
    this.revisions[windowId] = message.revision;
    if (windowId !== 0 && windowId !== this.activeWindowId) return;
    if (message.type === T.InventorySync) {
      if (windowId === 0) {
        for (let i = 0; i < 41; i++) this.setInventorySlot(i, message.slots[i] ?? null);
      } else this.applyContainerSnapshot(message.slots);
      this.inventory.cursor = message.cursor ? { ...message.cursor } : null;
      this.onWindowSnapshot(windowId, message.slots);
      if (windowId === 0 && !this.initialized) {
        this.initialized = true;
        this.enqueue(A.SelectSlot, this.inventory.selectedSlot, [], 0);
      }
    } else if (message.slot === CURSOR_SLOT) {
      this.inventory.cursor = message.stack ? { ...message.stack } : null;
    } else if (windowId === 0) {
      if (message.slot < 41) this.setInventorySlot(message.slot, message.stack);
      this.onWindowSlot(windowId, message.slot, message.stack);
    } else {
      this.applyContainerSlot(message.slot, message.stack);
      this.onWindowSlot(windowId, message.slot, message.stack);
    }
  }

  result(message: Messages[T.InventoryResult]): void {
    if (!this.pending || message.requestId !== this.inFlightId) return;
    this.revisions[this.inFlightWindowId] = message.revision;
    this.pending = false;
    // A rejection's authoritative snapshot precedes its result on the socket.
    this.flush();
  }

  resume(): void {
    if (!this.pending) this.flush();
  }

  private enqueue(
    action: A,
    slot: number,
    slots: readonly number[] = [],
    windowId = this.activeWindowId,
  ): void {
    this.queue.push({ action, slot, slots, windowId });
    this.flush();
  }

  private flush(): void {
    if (this.pending || !this.queue.length) return;
    const next = this.queue.shift()!;
    this.pending = true;
    this.inFlightWindowId = next.windowId;
    this.inFlightId = ++this.requestId;
    this.connection.send({
      type: T.InventoryTransaction,
      requestId: this.inFlightId,
      windowId: next.windowId,
      revision: this.revisions[next.windowId]!,
      action: next.action,
      slot: next.slot,
      slots: next.slots,
    });
  }

  private setInventorySlot(slot: number, stack: WireStack | null): void {
    this.inventory.slots[slot] = stack ? { ...stack, slot } : null;
  }

  private applyContainerSnapshot(slots: readonly (WireStack | null)[]): void {
    for (let slot = 0; slot < slots.length; slot++)
      this.applyContainerSlot(slot, slots[slot] ?? null);
  }

  private applyContainerSlot(slot: number, stack: WireStack | null): void {
    if (this.activeWindowKind === 'chest' || this.activeWindowKind === 'large_chest') {
      const chestSlots = this.activeWindowKind === 'large_chest' ? 54 : 27;
      if (slot >= chestSlots) this.setInventorySlot(slot - chestSlots, stack);
    } else if (this.activeWindowKind === 'kiln') {
      if (slot >= 3) this.setInventorySlot(slot <= 11 ? slot - 3 : slot - 12 + 9, stack);
    } else if (this.activeWindowKind === 'crafting' && slot >= 10) {
      this.setInventorySlot(slot - 10, stack);
    }
  }
}

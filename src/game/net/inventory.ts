import { Inventory } from '../../gameplay/inventory';
import {
  InventoryAction as A,
  MessageType as T,
  CURSOR_SLOT,
  type Messages,
} from '../../net/protocol';
import type { Connection } from './connection';
/** Window zero operations are serialized by authoritative revision, including rapid clicks. */
export class RemoteInventory {
  private revision = 0;
  private requestId = 0;
  private pending = false;
  private readonly queue: Array<{ action: A; slot: number; slots: readonly number[] }> = [];
  constructor(
    private readonly inventory: Inventory,
    private readonly connection: Connection,
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
    // Cursor remains server-owned when the panel closes.
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
  sync(message: Messages[T.InventorySync] | Messages[T.InventorySlot]): void {
    if (message.windowId !== 0) return;
    this.revision = message.revision;
    if (message.type === T.InventorySync) {
      for (let i = 0; i < 41; i++)
        this.inventory.slots[i] = message.slots[i] ? { ...message.slots[i]! } : null;
      this.inventory.cursor = message.cursor ? { ...message.cursor } : null;
    } else if (message.slot === CURSOR_SLOT) this.inventory.cursor = message.stack;
    else this.inventory.slots[message.slot] = message.stack;
  }
  result(message: Messages[T.InventoryResult]): void {
    if (message.requestId !== this.requestId) return;
    this.revision = message.revision;
    this.pending = false;
    // A rejected operation is followed by InventorySync. Defer the next operation to that frame.
    if (message.accepted) this.flush();
  }
  resume(): void {
    if (!this.pending) this.flush();
  }
  private enqueue(action: A, slot: number, slots: readonly number[] = []): void {
    this.queue.push({ action, slot, slots });
    this.flush();
  }
  private flush(): void {
    if (this.pending || !this.queue.length) return;
    const next = this.queue.shift()!;
    this.pending = true;
    this.connection.send({
      type: T.InventoryTransaction,
      requestId: ++this.requestId,
      windowId: 0,
      revision: this.revision,
      ...next,
    });
  }
}

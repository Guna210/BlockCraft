import { items } from './items';

export interface ItemStack {
  slot: number;
  id: string;
  count: number;
}

/** Storage only. Slot interactions and extra equipment slots belong to M09a. */
export class Inventory {
  readonly slots: Array<ItemStack | null> = Array.from({ length: 36 }, () => null);
  private readonly records: ItemStack[] = Array.from({ length: 36 }, (_, slot) => ({
    slot,
    id: '',
    count: 0,
  }));
  private selected = 0;
  get selectedSlot(): number {
    return this.selected;
  }
  set selectedSlot(slot: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) throw new Error('Hotbar slot must be 0–8');
    this.selected = slot;
  }
  get held(): ItemStack | null {
    return this.slots[this.selected]!;
  }
  capacity(id: string): number {
    const max = items.get(id).maxStack;
    let room = 0;
    for (let slot = 0; slot < 36; slot++) {
      const stack = this.slots[slot];
      if (!stack) room += max;
      else if (stack.id === id) room += max - stack.count;
    }
    return room;
  }
  /** Atomic insertion: a pickup stays in the world unless the entire stack fits. */
  insert(id: string, count: number): boolean {
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Item count must be positive');
    const max = items.get(id).maxStack;
    if (this.capacity(id) < count) return false;
    for (let slot = 0; slot < 36 && count > 0; slot++) {
      const stack = this.slots[slot];
      if (stack?.id === id) {
        const moved = Math.min(count, max - stack.count);
        stack.count += moved;
        count -= moved;
      }
    }
    for (let slot = 0; slot < 36 && count > 0; slot++)
      if (!this.slots[slot]) {
        const moved = Math.min(count, max);
        const record = this.records[slot]!;
        record.id = id;
        record.count = moved;
        this.slots[slot] = record;
        count -= moved;
      }
    return true;
  }
  consumeSelected(): void {
    const stack = this.held;
    if (stack && --stack.count === 0) this.slots[this.selected] = null;
  }
  /** Creative pick replaces an occupied selection; an empty selection keeps the held-block fallback. */
  pickBlock(id: string): void {
    if (!this.held) return;
    const item = items.get(id);
    if (!item.block) throw new Error('Creative pick requires a block item');
    const record = this.records[this.selected]!;
    record.id = id;
    record.count = 1;
    this.slots[this.selected] = record;
  }
  snapshot(): Array<ItemStack | null> {
    return this.slots.map((stack) => (stack ? { ...stack } : null));
  }
}

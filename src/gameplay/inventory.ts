import { items } from './items';

export interface ItemStack {
  slot: number;
  id: string;
  count: number;
  damage?: number | null;
}

export interface CursorStack {
  id: string;
  count: number;
  damage?: number | null;
}

export type InventoryTarget = number | 'cursor';
const ARMOR = ['head', 'chest', 'legs', 'feet'] as const;
const HOTBAR = Array.from({ length: 9 }, (_, i) => i);
const MAIN = Array.from({ length: 27 }, (_, i) => i + 9);
/** Slot operations are synchronous model changes; no input, DOM or rendering. */
export class Inventory {
  readonly slots: Array<ItemStack | null> = Array.from({ length: 41 }, () => null);
  private readonly records: ItemStack[] = Array.from({ length: 41 }, (_, slot) => ({
    slot,
    id: '',
    count: 0,
  }));
  cursor: CursorStack | null = null;
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
  snapshot(includeEquipment = false): Array<ItemStack | null> {
    return this.slots
      .slice(0, includeEquipment ? 41 : 36)
      .map((stack) => (stack ? { ...stack } : null));
  }
  cursorSnapshot(): CursorStack | null {
    return this.cursor
      ? {
          id: this.cursor.id,
          count: this.cursor.count,
          ...(this.cursor.damage !== undefined ? { damage: this.cursor.damage } : {}),
        }
      : null;
  }
  private checkSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 41)
      throw new Error('Invalid inventory slot');
  }
  accepts(slot: number, id: string): boolean {
    this.checkSlot(slot);
    const item = items.get(id);
    return slot < 36 || slot === 40 || item.armorSlot === ARMOR[slot - 36];
  }
  /** Per-item conservation includes the cursor and all equipment. */
  counts(): Map<string, number> {
    const result = new Map<string, number>();
    for (const stack of [...this.slots, this.cursor])
      if (stack) result.set(stack.id, (result.get(stack.id) ?? 0) + stack.count);
    return result;
  }
  assertInvariant(before: ReadonlyMap<string, number> = this.counts()): void {
    for (let slot = 0; slot < 41; slot++) {
      const stack = this.slots[slot];
      if (stack && (stack.slot !== slot || !this.accepts(slot, stack.id)))
        throw new Error('Invalid slot contents');
    }
    for (const stack of [...this.slots, this.cursor])
      if (
        stack &&
        (!Number.isSafeInteger(stack.count) ||
          stack.count <= 0 ||
          stack.count > items.get(stack.id).maxStack)
      )
        throw new Error('Invalid stack count');
    const after = this.counts();
    if (before.size !== after.size || [...before].some(([id, count]) => after.get(id) !== count))
      throw new Error('Inventory count invariant violated');
  }
  private operation(change: () => void): void {
    const before = this.counts();
    change();
    this.assertInvariant(before);
  }
  private put(slot: number, stack: CursorStack | null): void {
    this.slots[slot] = stack ? { ...stack, slot } : null;
  }
  private cleanCursor(): void {
    if (this.cursor?.count === 0) this.cursor = null;
  }
  leftClick(slot: number): void {
    this.checkSlot(slot);
    this.operation(() => {
      const stack = this.slots[slot];
      if (!this.cursor) {
        this.cursor = stack
          ? {
              id: stack.id,
              count: stack.count,
              ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
            }
          : null;
        this.put(slot, null);
      } else if (this.accepts(slot, this.cursor.id)) {
        // Unstackable items never merge, so the same tool or armor piece swaps like any other item.
        if (stack?.id === this.cursor.id && items.get(stack.id).maxStack > 1) {
          const moved = Math.min(this.cursor.count, items.get(stack.id).maxStack - stack.count);
          stack.count += moved;
          this.cursor.count -= moved;
          this.cleanCursor();
        } else {
          const held = this.cursor;
          this.cursor = stack
            ? {
                id: stack.id,
                count: stack.count,
                ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
              }
            : null;
          this.put(slot, held);
        }
      }
    });
  }
  rightClick(slot: number): void {
    this.checkSlot(slot);
    this.operation(() => {
      const stack = this.slots[slot];
      if (!this.cursor && stack) {
        const count = Math.ceil(stack.count / 2);
        this.cursor = {
          id: stack.id,
          count,
          ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
        };
        stack.count -= count;
        if (!stack.count) this.put(slot, null);
      } else if (
        this.cursor &&
        this.accepts(slot, this.cursor.id) &&
        (!stack || (stack.id === this.cursor.id && stack.count < items.get(stack.id).maxStack))
      ) {
        if (stack) stack.count++;
        else
          this.put(slot, {
            id: this.cursor.id,
            count: 1,
            ...(this.cursor.damage !== undefined ? { damage: this.cursor.damage } : {}),
          });
        this.cursor.count--;
        this.cleanCursor();
      }
    });
  }

  /** Merge first, then fill empty targets, leaving any overflow at source. */
  public route(
    source: { id: string; count: number; damage?: number | null },
    targets: readonly number[] = [...MAIN, ...HOTBAR],
  ): void {
    for (const empty of [false, true])
      for (const slot of targets) {
        const target = this.slots[slot];
        if (
          !source.count ||
          !this.accepts(slot, source.id) ||
          (empty ? !!target : target?.id !== source.id)
        )
          continue;
        const moved = Math.min(source.count, items.get(source.id).maxStack - (target?.count ?? 0));
        if (target) target.count += moved;
        else
          this.put(slot, {
            id: source.id,
            count: moved,
            ...(source.damage !== undefined ? { damage: source.damage } : {}),
          });
        source.count -= moved;
      }
  }
  shiftClick(slot: number): void {
    this.checkSlot(slot);
    this.operation(() => {
      const source = this.slots[slot];
      if (!source) return;
      if (slot < 36) {
        const armorSlot = items.get(source.id).armorSlot;
        if (armorSlot) this.route(source, [36 + ARMOR.indexOf(armorSlot)]);
        this.route(source, slot < 9 ? MAIN : HOTBAR);
      } else {
        this.route(source, MAIN);
        this.route(source, HOTBAR);
      }
      if (!source.count) this.put(slot, null);
    });
  }
  drag(slots: readonly number[], button: 'left' | 'right'): void {
    // Validate the entire request before any mutation, and count each target once.
    for (const slot of slots) this.checkSlot(slot);
    this.operation(() => {
      if (!this.cursor) return;
      const cursor = this.cursor;
      const max = items.get(cursor.id).maxStack;
      const targets = [...new Set(slots)].filter((slot) => {
        const stack = this.slots[slot];
        return (
          this.accepts(slot, cursor.id) && (!stack || (stack.id === cursor.id && stack.count < max))
        );
      });
      if (!targets.length) return;
      const each = button === 'left' ? Math.floor(cursor.count / targets.length) : 1;
      for (const slot of targets) {
        const stack = this.slots[slot];
        const moved = Math.min(each, cursor.count, max - (stack?.count ?? 0));
        if (!moved) continue;
        if (stack) stack.count += moved;
        else
          this.put(slot, {
            id: cursor.id,
            count: moved,
            ...(cursor.damage !== undefined ? { damage: cursor.damage } : {}),
          });
        cursor.count -= moved;
      }
      this.cleanCursor();
    });
  }

  doubleClick(): void {
    this.operation(() => {
      if (!this.cursor) return;
      const max = items.get(this.cursor.id).maxStack;
      for (const full of [false, true])
        for (let slot = 0; slot < 41; slot++) {
          const stack = this.slots[slot];
          if (!stack || stack.id !== this.cursor.id || (stack.count === max) !== full) continue;
          const moved = Math.min(stack.count, max - this.cursor.count);
          this.cursor.count += moved;
          stack.count -= moved;
          if (!stack.count) this.put(slot, null);
        }
    });
  }
  /** Moves the cursor into storage slots 0–35 as far as it fits; the rest stays on the cursor. */
  returnCursor(): void {
    this.operation(() => {
      const cursor = this.cursor;
      if (!cursor) return;
      const moved = Math.min(cursor.count, this.capacity(cursor.id));
      if (!moved) return;
      this.insert(cursor.id, moved);
      cursor.count -= moved;
      this.cleanCursor();
    });
  }
  peekDrop(target: InventoryTarget, whole = false): CursorStack | null {
    if (target !== 'cursor') this.checkSlot(target);
    const stack = target === 'cursor' ? this.cursor : this.slots[target];
    return stack ? { id: stack.id, count: whole ? stack.count : 1 } : null;
  }
  /** Pure removal. The world adapter spawns successfully before calling this. */
  drop(target: InventoryTarget, whole = false): CursorStack | null {
    const dropped = this.peekDrop(target, whole);
    if (!dropped) return null;
    const before = this.counts();
    const stack = (target === 'cursor' ? this.cursor : this.slots[target])!;
    stack.count -= dropped.count;
    if (!stack.count) {
      if (target === 'cursor') this.cursor = null;
      else this.put(target, null);
    }
    const remaining = before.get(dropped.id)! - dropped.count;
    if (remaining) before.set(dropped.id, remaining);
    else before.delete(dropped.id);
    this.assertInvariant(before);
    return dropped;
  }
}

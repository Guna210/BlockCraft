import type { Inventory } from '../src/gameplay/inventory';
/** Compare mutable shared stacks without serializing or allocating on a steady tick. */
export class InventoryState {
  private readonly ids: Array<string | undefined> = new Array(42).fill(undefined);
  private readonly counts = new Uint16Array(42);
  private readonly damages = new Float64Array(42).fill(-1);
  private readonly affixes: Array<string | undefined> = new Array(42).fill(undefined);
  private selected = -1;
  capture(inventory: Inventory): boolean {
    let changed = this.selected !== inventory.selectedSlot;
    this.selected = inventory.selectedSlot;
    for (let i = 0; i < 42; i++) {
      const stack = i === 41 ? inventory.cursor : inventory.slots[i];
      const id = stack?.id,
        count = stack?.count ?? 0,
        damage = stack?.damage ?? -1,
        affix = stack?.affix;
      if (
        this.ids[i] !== id ||
        this.counts[i] !== count ||
        this.damages[i] !== damage ||
        this.affixes[i] !== affix
      )
        changed = true;
      this.ids[i] = id;
      this.counts[i] = count;
      this.damages[i] = damage;
      this.affixes[i] = affix;
    }
    return changed;
  }
}

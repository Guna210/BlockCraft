import type { Inventory } from '../src/gameplay/inventory';
import type { CraftingSlot } from '../src/gameplay/crafting-session';
/** Compare mutable shared stacks without serializing or allocating on a steady tick. */
export class InventoryState {
  private readonly ids: Array<string | undefined> = new Array(42).fill(undefined);
  private readonly counts = new Uint16Array(42);
  private readonly damages = new Float64Array(42).fill(-1);
  private readonly affixes: Array<string | undefined> = new Array(42).fill(undefined);
  private selected = -1;
  private readonly gridIds: Array<string | undefined> = new Array(9).fill(undefined);
  private readonly gridCounts = new Uint16Array(9);
  private readonly gridDamages = new Float64Array(9).fill(-1);
  private readonly gridAffixes: Array<string | undefined> = new Array(9).fill(undefined);
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
  captureCrafting(grid: readonly CraftingSlot[]): boolean {
    let changed = false;
    for (let i = 0; i < this.gridIds.length; i++) {
      const stack = grid[i];
      const id = stack?.id,
        count = stack?.count ?? 0,
        damage = stack?.damage ?? -1,
        affix = stack?.affix;
      if (
        this.gridIds[i] !== id ||
        this.gridCounts[i] !== count ||
        this.gridDamages[i] !== damage ||
        this.gridAffixes[i] !== affix
      )
        changed = true;
      this.gridIds[i] = id;
      this.gridCounts[i] = count;
      this.gridDamages[i] = damage;
      this.gridAffixes[i] = affix;
    }
    return changed;
  }
}

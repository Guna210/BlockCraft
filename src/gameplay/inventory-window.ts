import type { Player } from '../entity/player';
import type { CraftingSlot } from './crafting-session';
import { addXp } from './xp';
import { items } from './items';
import { smelting } from './smelting';
import type { CursorStack, Inventory, ItemStack } from './inventory';
import type { KilnState } from './kiln';

export type WindowClickButton = 'left' | 'right';

/** Mutable external slots (chests, kiln or crafting grid) used by UI and server alike. */
export interface WindowSlotAccess {
  readonly length: number;
  get(slot: number): CursorStack | null;
  set(slot: number, stack: CursorStack | null): void;
}

export function sameWindowStackKind(a: CursorStack, b: CursorStack): boolean {
  return a.id === b.id && (a.damage ?? null) === (b.damage ?? null) && a.affix === b.affix;
}

function copyStack(stack: CursorStack): CursorStack {
  return {
    id: stack.id,
    count: stack.count,
    ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
    ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
  };
}

export function clickWindowSlot(
  inventory: Inventory,
  access: WindowSlotAccess,
  slot: number,
  button: WindowClickButton,
): void {
  if (slot < 0 || slot >= access.length) return;
  const stored = access.get(slot);
  const current = stored ? copyStack(stored) : null;
  const cursor = inventory.cursor;
  if (button === 'left') {
    if (!cursor) {
      inventory.cursor = current;
      access.set(slot, null);
    } else if (
      current &&
      sameWindowStackKind(current, cursor) &&
      items.get(cursor.id).maxStack > 1 &&
      current.count < items.get(cursor.id).maxStack
    ) {
      const moved = Math.min(cursor.count, items.get(cursor.id).maxStack - current.count);
      current.count += moved;
      cursor.count -= moved;
      access.set(slot, current);
      if (!cursor.count) inventory.cursor = null;
    } else {
      access.set(slot, cursor);
      inventory.cursor = current;
    }
  } else if (!cursor && current) {
    const half = Math.ceil(current.count / 2);
    inventory.cursor = { ...current, count: half };
    current.count -= half;
    access.set(slot, current.count ? current : null);
  } else if (
    cursor &&
    (!current ||
      (sameWindowStackKind(current, cursor) && current.count < items.get(cursor.id).maxStack))
  ) {
    if (current) current.count++;
    else access.set(slot, { ...cursor, count: 1 });
    cursor.count--;
    if (!cursor.count) inventory.cursor = null;
  }
  inventory.assertInvariant();
}

export function quickMoveWindowToInventory(
  inventory: Inventory,
  access: WindowSlotAccess,
  slot: number,
): void {
  const stored = access.get(slot);
  if (!stored) return;
  const stack = copyStack(stored);
  const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
  if (!moved || !inventory.insert(stack.id, moved, stack)) return;
  stack.count -= moved;
  access.set(slot, stack.count ? stack : null);
}

export function quickMoveInventoryToWindow(
  inventory: Inventory,
  access: WindowSlotAccess,
  slot: number,
): void {
  const source = inventory.slots[slot];
  if (!source || slot < 0 || slot >= 41) return;
  let count = source.count;
  const max = items.get(source.id).maxStack;
  for (let target = 0; target < access.length && count > 0; target++) {
    const stored = access.get(target);
    if (!stored || !sameWindowStackKind(stored, source)) continue;
    const moved = Math.min(count, max - stored.count);
    stored.count += moved;
    count -= moved;
  }
  for (let target = 0; target < access.length && count > 0; target++) {
    if (access.get(target)) continue;
    const moved = Math.min(count, max);
    access.set(target, { ...source, count: moved });
    count -= moved;
  }
  source.count = count;
  if (!count) inventory.slots[slot] = null;
  inventory.assertInvariant();
}

/** The shared recipe-grid drag rule used by inventory, workbench and chest windows. */
export function dragWindowSlots(
  inventory: Inventory,
  slots: readonly number[],
  button: WindowClickButton,
  access: WindowSlotAccess,
): void {
  const cursor = inventory.cursor;
  if (!cursor) return;
  const unique: number[] = [];
  for (const slot of slots)
    if (slot >= 0 && slot < access.length && !unique.includes(slot)) unique.push(slot);
  const eligible: number[] = [];
  for (const slot of unique) {
    const stack = access.get(slot);
    if (
      !stack ||
      (sameWindowStackKind(stack, cursor) && stack.count < items.get(stack.id).maxStack)
    )
      eligible.push(slot);
  }
  if (!eligible.length) return;
  const each = button === 'left' ? Math.floor(cursor.count / eligible.length) : 1;
  for (const slot of eligible) {
    if (!cursor.count) break;
    const stack = access.get(slot);
    const moved = Math.min(each, cursor.count, items.get(cursor.id).maxStack - (stack?.count ?? 0));
    if (!moved) continue;
    if (stack) stack.count += moved;
    else access.set(slot, { ...cursor, count: moved });
    cursor.count -= moved;
  }
  if (!cursor.count) inventory.cursor = null;
  inventory.assertInvariant();
}

/** Shared kiln screen transaction, including output XP and input/fuel quick routing. */
export function clickKilnSlot(
  player: Player,
  kiln: KilnState,
  slot: number,
  button: WindowClickButton,
  shift: boolean,
): void {
  const inventory = player.inventory;
  if (slot === 0 || slot === 1) {
    const slotKey = slot === 0 ? 'input' : 'fuel';
    const current = kiln[slotKey];
    if (shift) {
      if (current) {
        const source = copyStack(current);
        inventory.route(source);
        current.count = source.count;
        if (current.count <= 0) kiln[slotKey] = null;
      }
      return;
    }
    if (button === 'left') {
      if (!inventory.cursor) {
        if (current) {
          inventory.cursor = copyStack(current);
          kiln[slotKey] = null;
        }
      } else {
        const cursor = inventory.cursor;
        if (!current) {
          kiln[slotKey] = { ...copyStack(cursor), damage: cursor.damage ?? null };
          inventory.cursor = null;
        } else if (sameWindowStackKind(current, cursor)) {
          const moved = Math.min(cursor.count, items.get(current.id).maxStack - current.count);
          current.count += moved;
          cursor.count -= moved;
          if (cursor.count <= 0) inventory.cursor = null;
        } else {
          kiln[slotKey] = { ...copyStack(cursor), damage: cursor.damage ?? null };
          inventory.cursor = copyStack(current);
        }
      }
    } else if (!inventory.cursor) {
      if (current) {
        const take = Math.ceil(current.count / 2);
        inventory.cursor = { ...copyStack(current), count: take };
        current.count -= take;
        if (current.count <= 0) kiln[slotKey] = null;
      }
    } else {
      const cursor = inventory.cursor;
      if (!current) {
        kiln[slotKey] = { ...copyStack(cursor), count: 1, damage: cursor.damage ?? null };
        cursor.count--;
        if (cursor.count <= 0) inventory.cursor = null;
      } else if (
        sameWindowStackKind(current, cursor) &&
        current.count < items.get(current.id).maxStack
      ) {
        current.count++;
        cursor.count--;
        if (cursor.count <= 0) inventory.cursor = null;
      }
    }
    return;
  }
  if (slot === 2) {
    const output = kiln.output;
    if (!output) return;
    if (shift) {
      const before = output.count;
      const routed = copyStack(output);
      inventory.route(routed);
      output.count = routed.count;
      if (before > routed.count) {
        addXp(player, kiln.storedXp);
        kiln.storedXp = 0;
      }
      if (output.count <= 0) kiln.output = null;
      return;
    }
    if (button === 'left') {
      if (!inventory.cursor) {
        inventory.cursor = copyStack(output);
        addXp(player, kiln.storedXp);
        kiln.storedXp = 0;
        kiln.output = null;
      } else if (sameWindowStackKind(inventory.cursor, output)) {
        const moved = Math.min(
          output.count,
          items.get(output.id).maxStack - inventory.cursor.count,
        );
        if (moved > 0) {
          inventory.cursor.count += moved;
          output.count -= moved;
          addXp(player, kiln.storedXp);
          kiln.storedXp = 0;
          if (output.count <= 0) kiln.output = null;
        }
      }
    } else if (!inventory.cursor) {
      const take = Math.ceil(output.count / 2);
      inventory.cursor = { ...copyStack(output), count: take };
      output.count -= take;
      addXp(player, kiln.storedXp);
      kiln.storedXp = 0;
      if (output.count <= 0) kiln.output = null;
    } else if (
      sameWindowStackKind(inventory.cursor, output) &&
      inventory.cursor.count < items.get(output.id).maxStack
    ) {
      inventory.cursor.count++;
      output.count--;
      addXp(player, kiln.storedXp);
      kiln.storedXp = 0;
      if (output.count <= 0) kiln.output = null;
    }
    return;
  }
  const inventorySlot = slot <= 11 ? slot - 3 : slot - 12 + 9;
  const stack = inventory.slots[inventorySlot];
  if (!shift) {
    if (button === 'left') inventory.leftClick(inventorySlot);
    else inventory.rightClick(inventorySlot);
    return;
  }
  if (!stack) return;
  const isFuel = smelting.isFuel(stack.id);
  const isSmeltable = smelting.getByInput(stack.id) !== undefined;
  if (
    isFuel &&
    (!kiln.fuel ||
      (sameWindowStackKind(kiln.fuel, stack) && kiln.fuel.count < items.get(stack.id).maxStack))
  ) {
    if (!kiln.fuel) {
      kiln.fuel = { ...copyStack(stack), damage: stack.damage ?? null };
      inventory.slots[inventorySlot] = null;
    } else {
      const add = Math.min(stack.count, items.get(stack.id).maxStack - kiln.fuel.count);
      kiln.fuel.count += add;
      stack.count -= add;
      if (stack.count <= 0) inventory.slots[inventorySlot] = null;
    }
  } else if (
    isSmeltable &&
    (!kiln.input ||
      (sameWindowStackKind(kiln.input, stack) && kiln.input.count < items.get(stack.id).maxStack))
  ) {
    if (!kiln.input) {
      kiln.input = { ...copyStack(stack), damage: stack.damage ?? null };
      inventory.slots[inventorySlot] = null;
    } else {
      const add = Math.min(stack.count, items.get(stack.id).maxStack - kiln.input.count);
      kiln.input.count += add;
      stack.count -= add;
      if (stack.count <= 0) inventory.slots[inventorySlot] = null;
    }
  } else inventory.shiftClick(inventorySlot);
}

export function clickCraftGrid(
  inventory: Inventory,
  grid: CraftingSlot[],
  slot: number,
  button: WindowClickButton,
  shift: boolean,
): void {
  if (slot < 0 || slot >= grid.length) return;
  const access: WindowSlotAccess = {
    length: grid.length,
    get: (index) => grid[index] ?? null,
    set: (index, stack) => {
      grid[index] = stack;
    },
  };
  if (shift) {
    const stack = grid[slot];
    if (!stack) return;
    const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
    if (moved) inventory.insert(stack.id, moved, stack);
    stack.count -= moved;
    if (!stack.count) grid[slot] = null;
  } else clickWindowSlot(inventory, access, slot, button);
}

export function inventoryStack(stack: CursorStack | null, slot: number): ItemStack | null {
  return stack ? { ...stack, slot } : null;
}

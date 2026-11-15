import type { Player } from '../entity/player';
import type { CraftingSlot } from './crafting-session';
import { addXp } from './xp';
import { items } from './items';
import { smelting } from './smelting';
import type { CursorStack, Inventory, ItemStack } from './inventory';
import type { KilnState } from './kiln';

export type WindowClickButton = 'left' | 'right';

/**
 * External slots (chests, kiln or crafting grid) used by UI and server alike.
 * `get` may return a detached copy; helpers must publish every slot change with `set`.
 */
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
    if (current) access.set(slot, current);
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
    const current = copyStack(stored);
    const moved = Math.min(count, max - current.count);
    if (!moved) continue;
    current.count += moved;
    access.set(target, current);
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
    if (stack) {
      stack.count += moved;
      access.set(slot, stack);
    } else access.set(slot, { ...cursor, count: moved });
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
    const current = readKilnSlot(kiln, slot);
    if (shift) {
      if (current) {
        inventory.route(current);
        writeKilnSlot(kiln, slot, current.count > 0 ? current : null);
      }
      return;
    }
    if (button === 'left') {
      if (!inventory.cursor) {
        if (current) {
          inventory.cursor = copyStack(current);
          writeKilnSlot(kiln, slot, null);
        }
      } else {
        const cursor = inventory.cursor;
        if (!current) {
          writeKilnSlot(kiln, slot, cursor);
          inventory.cursor = null;
        } else if (sameWindowStackKind(current, cursor)) {
          const moved = Math.min(cursor.count, items.get(current.id).maxStack - current.count);
          current.count += moved;
          cursor.count -= moved;
          if (moved) writeKilnSlot(kiln, slot, current);
          if (cursor.count <= 0) inventory.cursor = null;
        } else {
          writeKilnSlot(kiln, slot, cursor);
          inventory.cursor = copyStack(current);
        }
      }
    } else if (!inventory.cursor) {
      if (current) {
        const take = Math.ceil(current.count / 2);
        inventory.cursor = { ...copyStack(current), count: take };
        current.count -= take;
        writeKilnSlot(kiln, slot, current.count > 0 ? current : null);
      }
    } else {
      const cursor = inventory.cursor;
      if (!current) {
        writeKilnSlot(kiln, slot, { ...cursor, count: 1 });
        cursor.count--;
        if (cursor.count <= 0) inventory.cursor = null;
      } else if (
        sameWindowStackKind(current, cursor) &&
        current.count < items.get(current.id).maxStack
      ) {
        current.count++;
        writeKilnSlot(kiln, slot, current);
        cursor.count--;
        if (cursor.count <= 0) inventory.cursor = null;
      }
    }
    return;
  }
  if (slot === 2) {
    const output = readKilnSlot(kiln, 2);
    if (!output) return;
    if (shift) {
      const before = output.count;
      inventory.route(output);
      if (before > output.count) {
        addXp(player, kiln.storedXp);
        kiln.storedXp = 0;
      }
      writeKilnSlot(kiln, 2, output.count > 0 ? output : null);
      return;
    }
    if (button === 'left') {
      if (!inventory.cursor) {
        inventory.cursor = copyStack(output);
        addXp(player, kiln.storedXp);
        kiln.storedXp = 0;
        writeKilnSlot(kiln, 2, null);
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
          writeKilnSlot(kiln, 2, output.count > 0 ? output : null);
        }
      }
    } else if (!inventory.cursor) {
      const take = Math.ceil(output.count / 2);
      inventory.cursor = { ...copyStack(output), count: take };
      output.count -= take;
      addXp(player, kiln.storedXp);
      kiln.storedXp = 0;
      writeKilnSlot(kiln, 2, output.count > 0 ? output : null);
    } else if (
      sameWindowStackKind(inventory.cursor, output) &&
      inventory.cursor.count < items.get(output.id).maxStack
    ) {
      inventory.cursor.count++;
      output.count--;
      addXp(player, kiln.storedXp);
      kiln.storedXp = 0;
      writeKilnSlot(kiln, 2, output.count > 0 ? output : null);
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
  const fuel = readKilnSlot(kiln, 1);
  const input = readKilnSlot(kiln, 0);
  if (
    isFuel &&
    (!fuel || (sameWindowStackKind(fuel, stack) && fuel.count < items.get(stack.id).maxStack))
  ) {
    if (!fuel) {
      writeKilnSlot(kiln, 1, stack);
      inventory.slots[inventorySlot] = null;
    } else {
      const add = Math.min(stack.count, items.get(stack.id).maxStack - fuel.count);
      fuel.count += add;
      stack.count -= add;
      if (add) writeKilnSlot(kiln, 1, fuel);
      if (stack.count <= 0) inventory.slots[inventorySlot] = null;
    }
  } else if (
    isSmeltable &&
    (!input || (sameWindowStackKind(input, stack) && input.count < items.get(stack.id).maxStack))
  ) {
    if (!input) {
      writeKilnSlot(kiln, 0, stack);
      inventory.slots[inventorySlot] = null;
    } else {
      const add = Math.min(stack.count, items.get(stack.id).maxStack - input.count);
      input.count += add;
      stack.count -= add;
      if (add) writeKilnSlot(kiln, 0, input);
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
    get: (index) => {
      const stack = grid[index];
      return stack ? copyStack(stack) : null;
    },
    set: (index, stack) => {
      grid[index] = stack ? copyStack(stack) : null;
    },
  };
  if (shift) {
    const stack = access.get(slot);
    if (!stack) return;
    const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
    if (moved) inventory.insert(stack.id, moved, stack);
    stack.count -= moved;
    access.set(slot, stack.count > 0 ? stack : null);
  } else clickWindowSlot(inventory, access, slot, button);
}

function readKilnSlot(kiln: KilnState, slot: number): CursorStack | null {
  const stack = slot === 0 ? kiln.input : slot === 1 ? kiln.fuel : slot === 2 ? kiln.output : null;
  return stack ? copyStack(stack) : null;
}

function writeKilnSlot(kiln: KilnState, slot: number, stack: CursorStack | null): void {
  const value = stack ? { ...copyStack(stack), damage: stack.damage ?? null } : null;
  if (slot === 0) kiln.input = value;
  else if (slot === 1) kiln.fuel = value;
  else if (slot === 2) kiln.output = value;
}

export function inventoryStack(stack: CursorStack | null, slot: number): ItemStack | null {
  return stack ? { ...stack, slot } : null;
}

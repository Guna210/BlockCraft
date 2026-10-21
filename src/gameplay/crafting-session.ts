import { crafting, type CraftingRecipe } from './crafting';
import { items } from './items';
import type { CursorStack, Inventory, ItemStack } from './inventory';

export type CraftingSlot = Pick<CursorStack, 'id' | 'count' | 'damage' | 'affix'> | null;

interface RecipeCell {
  slot: number;
  spec: string;
}

export interface FilledRecipe {
  grid: CraftingSlot[];
  inventory: Array<ItemStack | null>;
  crafts: number;
}

function recipeCells(recipe: CraftingRecipe, dimension: 2 | 3): RecipeCell[] | null {
  if (recipe.type === 'shapeless') {
    if (recipe.ingredients.length > dimension * dimension) return null;
    return recipe.ingredients.map((spec, i) => ({ slot: i, spec }));
  }

  const rows = recipe.pattern;
  let minRow = rows.length;
  let maxRow = -1;
  let minCol = Infinity;
  let maxCol = -1;
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y]!.length; x++)
      if (rows[y]![x] !== ' ') {
        minRow = Math.min(minRow, y);
        maxRow = Math.max(maxRow, y);
        minCol = Math.min(minCol, x);
        maxCol = Math.max(maxCol, x);
      }
  if (maxRow < minRow || maxCol < minCol) return null;
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  if (width > dimension || height > dimension) return null;

  const result: RecipeCell[] = [];
  for (let y = minRow; y <= maxRow; y++)
    for (let x = minCol; x <= maxCol; x++) {
      const symbol = rows[y]![x] ?? ' ';
      if (symbol !== ' ')
        result.push({
          slot: (y - minRow) * dimension + x - minCol,
          spec: recipe.key[symbol]!,
        });
    }
  return result;
}

function countsFromSources(
  grid: readonly CraftingSlot[],
  inventory: readonly (ItemStack | null)[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const stack of grid)
    if (stack) result.set(stack.id, (result.get(stack.id) ?? 0) + stack.count);
  for (let slot = 0; slot < 36; slot++) {
    const stack = inventory[slot];
    if (stack) result.set(stack.id, (result.get(stack.id) ?? 0) + stack.count);
  }
  return result;
}

function assignIngredients(
  cells: readonly RecipeCell[],
  available: ReadonlyMap<string, number>,
  crafts: number,
): string[] | null {
  const choices = cells.map((cell) =>
    crafting
      .expandIngredient(cell.spec)
      .filter((id) => (available.get(id) ?? 0) >= crafts)
      .sort((a, b) => (available.get(b) ?? 0) - (available.get(a) ?? 0) || a.localeCompare(b)),
  );
  if (choices.some((list) => list.length === 0)) return null;

  const order = cells.map((_, i) => i).sort((a, b) => choices[a]!.length - choices[b]!.length);
  const assigned = new Map<string, number>();
  const result = new Array<string>(cells.length);
  const visit = (depth: number): boolean => {
    if (depth === order.length) return true;
    const cellIndex = order[depth]!;
    for (const id of choices[cellIndex]!) {
      const used = assigned.get(id) ?? 0;
      if (used + crafts > (available.get(id) ?? 0)) continue;
      assigned.set(id, used + crafts);
      result[cellIndex] = id;
      if (visit(depth + 1)) return true;
      if (used) assigned.set(id, used);
      else assigned.delete(id);
    }
    return false;
  };
  return visit(0) ? result : null;
}

/** Whether one instance of a recipe can be filled from the open grid and storage inventory. */
export function canFillRecipe(
  recipe: CraftingRecipe,
  dimension: 2 | 3,
  grid: readonly CraftingSlot[],
  inventory: readonly (ItemStack | null)[],
): boolean {
  const cells = recipeCells(recipe, dimension);
  return !!cells && !!assignIngredients(cells, countsFromSources(grid, inventory), 1);
}

/** Fills a recipe and returns updated copies; null means no complete, lossless fill is possible. */
export function fillRecipe(
  recipe: CraftingRecipe,
  dimension: 2 | 3,
  grid: readonly CraftingSlot[],
  inventory: readonly (ItemStack | null)[],
): FilledRecipe | null {
  const cells = recipeCells(recipe, dimension);
  if (!cells?.length) return null;
  const available = countsFromSources(grid, inventory);
  const total = [...available.values()].reduce((sum, count) => sum + count, 0);
  let low = 0;
  let high = Math.min(64, Math.floor(total / cells.length));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (assignIngredients(cells, available, mid)) low = mid;
    else high = mid - 1;
  }
  if (low === 0) return null;
  const assigned = assignIngredients(cells, available, low);
  if (!assigned) return null;

  const nextInventory = inventory.map((stack, slot) => (stack ? { ...stack, slot } : null));
  const remainingGrid = grid.map((stack) => (stack ? { ...stack } : null));
  const required = new Map<string, number>();
  for (const id of assigned) required.set(id, (required.get(id) ?? 0) + low);

  for (const [id, needed] of required) {
    let count = needed;
    for (let slot = 0; slot < remainingGrid.length && count > 0; slot++) {
      const stack = remainingGrid[slot];
      if (!stack || stack.id !== id) continue;
      const used = Math.min(stack.count, count);
      stack.count -= used;
      count -= used;
      if (stack.count === 0) remainingGrid[slot] = null;
    }
    for (let slot = 0; slot < 36 && count > 0; slot++) {
      const stack = nextInventory[slot];
      if (!stack || stack.id !== id) continue;
      const used = Math.min(stack.count, count);
      stack.count -= used;
      count -= used;
      if (stack.count === 0) nextInventory[slot] = null;
    }
    if (count > 0) return null;
  }

  for (const stack of remainingGrid) {
    if (!stack) continue;
    let count = stack.count;
    const max = items.get(stack.id).maxStack;
    for (let slot = 0; slot < 36 && count > 0; slot++) {
      const target = nextInventory[slot];
      if (!target || target.id !== stack.id) continue;
      const moved = Math.min(count, max - target.count);
      target.count += moved;
      count -= moved;
    }
    for (let slot = 0; slot < 36 && count > 0; slot++) {
      if (nextInventory[slot]) continue;
      const moved = Math.min(count, max);
      nextInventory[slot] = { slot, id: stack.id, count: moved };
      count -= moved;
    }
    if (count > 0) return null;
  }

  const nextGrid: CraftingSlot[] = Array.from({ length: dimension * dimension }, () => null);
  cells.forEach((cell, index) => {
    nextGrid[cell.slot] = { id: assigned[index]!, count: low };
  });
  return { grid: nextGrid, inventory: nextInventory, crafts: low };
}

/** Crafts one recipe, or as many as fit when shift-clicked; normal output goes to the cursor. */
export function takeCraftingOutput(
  grid: CraftingSlot[],
  inventory: Inventory,
  shift = false,
): number {
  const recipe = crafting.match(grid);
  if (!recipe) return 0;
  const max = crafting.maxCrafts(grid);
  if (!max) return 0;

  let crafts = 1;
  if (shift) {
    crafts = Math.min(max, Math.floor(inventory.capacity(recipe.result.id) / recipe.result.count));
    if (crafts <= 0) return 0;
    if (!inventory.insert(recipe.result.id, crafts * recipe.result.count)) return 0;
  } else {
    const resultCount = recipe.result.count;
    const cursor = inventory.cursor;
    if (
      cursor &&
      (cursor.id !== recipe.result.id ||
        cursor.count + resultCount > items.get(recipe.result.id).maxStack)
    )
      return 0;
    if (cursor) cursor.count += resultCount;
    else inventory.cursor = { id: recipe.result.id, count: resultCount };
  }

  for (const stack of grid) {
    if (!stack) continue;
    stack.count -= crafts;
    if (stack.count <= 0) {
      const index = grid.indexOf(stack);
      grid[index] = null;
    }
  }
  return crafts;
}

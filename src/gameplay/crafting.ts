import rawTags from '../../data/tags/items.json';
import { items } from './items';

export interface RecipeResult {
  id: string;
  count: number;
}

export interface ShapedRecipeDefinition {
  id: string;
  category: string;
  type: 'shaped';
  pattern: readonly string[];
  key: Readonly<Record<string, string>>;
  result: RecipeResult;
}

export interface ShapelessRecipeDefinition {
  id: string;
  category: string;
  type: 'shapeless';
  ingredients: readonly string[];
  result: RecipeResult;
}

export type CraftingRecipe = ShapedRecipeDefinition | ShapelessRecipeDefinition;

export type GridSlot = string | { id: string; count?: number } | null | undefined;
export type CraftingGridInput = ReadonlyArray<ReadonlyArray<GridSlot>> | ReadonlyArray<GridSlot>;

interface NormalizedCell {
  id: string;
  count: number;
}

interface TrimmedPattern {
  width: number;
  height: number;
  shapeKey: string;
  cells: readonly (string | null)[];
  mirrored: boolean;
}

interface ShapedCandidate {
  recipe: ShapedRecipeDefinition;
  variant: TrimmedPattern;
}

function trimPatternRows(rows: readonly string[]): {
  width: number;
  height: number;
  cells: (string | null)[];
  shapeKey: string;
} {
  let minR = rows.length;
  let maxR = -1;
  let minC = Infinity;
  let maxC = -1;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== ' ') {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }

  if (maxR < minR || maxC < minC) {
    throw new Error('Recipe pattern cannot be empty');
  }

  const width = maxC - minC + 1;
  const height = maxR - minR + 1;
  const cells: (string | null)[] = [];
  const maskChars: string[] = [];

  for (let r = minR; r <= maxR; r++) {
    const row = rows[r]!;
    for (let c = minC; c <= maxC; c++) {
      const ch = c < row.length ? row[c]! : ' ';
      if (ch === ' ') {
        cells.push(null);
        maskChars.push('.');
      } else {
        cells.push(ch);
        maskChars.push('#');
      }
    }
  }

  return {
    width,
    height,
    cells,
    shapeKey: `${width}x${height}:${maskChars.join('')}`,
  };
}

function mirrorRowsHorizontally(rows: readonly string[]): string[] {
  const maxWidth = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(maxWidth, ' ').split('').reverse().join(''));
}

export class CraftingRegistry {
  readonly tags = new Map<string, ReadonlySet<string>>();
  readonly tagLists = new Map<string, readonly string[]>();
  readonly recipes = new Map<string, CraftingRecipe>();
  readonly byCategory = new Map<string, readonly CraftingRecipe[]>();

  private readonly shapedByKey = new Map<string, ShapedCandidate[]>();
  private readonly shapelessByExactKey = new Map<string, ShapelessRecipeDefinition[]>();
  private readonly shapelessWithTagsByCount = new Map<number, ShapelessRecipeDefinition[]>();

  constructor() {
    for (const [tag, list] of Object.entries(rawTags as Record<string, string[]>)) {
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Invalid item tag: ${tag}`);
      }
      for (const itemId of list) {
        items.get(itemId);
      }
      this.tagLists.set(tag, [...list]);
      this.tags.set(tag, new Set(list));
    }

    const files = import.meta.glob<Record<string, Omit<CraftingRecipe, 'id' | 'category'>>>(
      '../../data/recipes/*.json',
      { eager: true, import: 'default' },
    );

    for (const path of Object.keys(files).sort()) {
      const fileName = path.split('/').pop()!;
      if (fileName === 'smelting.json') continue;
      const category = fileName.replace(/\.json$/, '');
      const categoryRecipes: CraftingRecipe[] = [];

      for (const [id, raw] of Object.entries(files[path]!)) {
        if (this.recipes.has(id)) {
          throw new Error(`Duplicate recipe ID: ${id}`);
        }
        items.get(raw.result.id);
        if (!Number.isSafeInteger(raw.result.count) || raw.result.count <= 0) {
          throw new Error(`Invalid recipe result count for ${id}`);
        }

        if (raw.type === 'shaped') {
          const shaped = raw as Omit<ShapedRecipeDefinition, 'id' | 'category'>;
          if (
            !Array.isArray(shaped.pattern) ||
            shaped.pattern.length < 1 ||
            shaped.pattern.length > 3
          ) {
            throw new Error(`Invalid pattern rows for recipe ${id}`);
          }
          const usedSymbols = new Set<string>();
          for (const row of shaped.pattern) {
            if (typeof row !== 'string' || row.length < 1 || row.length > 3) {
              throw new Error(`Invalid pattern row width for recipe ${id}`);
            }
            for (const ch of row) {
              if (ch !== ' ') usedSymbols.add(ch);
            }
          }
          for (const sym of usedSymbols) {
            const spec = shaped.key[sym];
            if (!spec) throw new Error(`Missing key symbol '${sym}' in recipe ${id}`);
            this.validateIngredientSpec(spec, id);
          }
          for (const sym of Object.keys(shaped.key)) {
            if (!usedSymbols.has(sym)) {
              throw new Error(`Unused key symbol '${sym}' in recipe ${id}`);
            }
          }

          const recipe: ShapedRecipeDefinition = {
            id,
            category,
            type: 'shaped',
            pattern: [...shaped.pattern],
            key: { ...shaped.key },
            result: { ...shaped.result },
          };
          this.recipes.set(id, recipe);
          categoryRecipes.push(recipe);
          this.indexShapedRecipe(recipe);
        } else if (raw.type === 'shapeless') {
          const shapeless = raw as Omit<ShapelessRecipeDefinition, 'id' | 'category'>;
          if (
            !Array.isArray(shapeless.ingredients) ||
            shapeless.ingredients.length < 1 ||
            shapeless.ingredients.length > 9
          ) {
            throw new Error(`Invalid shapeless ingredients for recipe ${id}`);
          }
          for (const spec of shapeless.ingredients) {
            this.validateIngredientSpec(spec, id);
          }
          const recipe: ShapelessRecipeDefinition = {
            id,
            category,
            type: 'shapeless',
            ingredients: [...shapeless.ingredients],
            result: { ...shapeless.result },
          };
          this.recipes.set(id, recipe);
          categoryRecipes.push(recipe);
          this.indexShapelessRecipe(recipe);
        } else {
          throw new Error(`Unknown recipe type in ${id}`);
        }
      }

      this.byCategory.set(category, categoryRecipes);
    }
  }

  private validateIngredientSpec(spec: string, recipeId: string): void {
    if (spec.startsWith('#')) {
      const tag = spec.slice(1);
      if (!this.tags.has(tag)) {
        throw new Error(`Unknown tag '${spec}' in recipe ${recipeId}`);
      }
    } else {
      items.get(spec);
    }
  }

  public matchesIngredient(spec: string, itemId: string): boolean {
    if (spec.startsWith('#')) {
      const set = this.tags.get(spec.slice(1));
      return set ? set.has(itemId) : false;
    }
    return spec === itemId;
  }

  public expandIngredient(spec: string): readonly string[] {
    if (spec.startsWith('#')) {
      return this.tagLists.get(spec.slice(1)) ?? [];
    }
    return [spec];
  }

  private indexShapedRecipe(recipe: ShapedRecipeDefinition): void {
    const primaryTrimmed = trimPatternRows(recipe.pattern);
    const primaryCells = primaryTrimmed.cells.map((sym) => (sym ? recipe.key[sym]! : null));
    const primaryVariant: TrimmedPattern = {
      width: primaryTrimmed.width,
      height: primaryTrimmed.height,
      shapeKey: primaryTrimmed.shapeKey,
      cells: primaryCells,
      mirrored: false,
    };
    this.addShapedCandidate(primaryVariant.shapeKey, { recipe, variant: primaryVariant });

    const mirroredRows = mirrorRowsHorizontally(recipe.pattern);
    const mirroredTrimmed = trimPatternRows(mirroredRows);
    const mirroredCells = mirroredTrimmed.cells.map((sym) => (sym ? recipe.key[sym]! : null));
    const sameAsPrimary =
      mirroredTrimmed.shapeKey === primaryTrimmed.shapeKey &&
      mirroredCells.every((spec, idx) => spec === primaryCells[idx]);

    if (!sameAsPrimary) {
      const mirroredVariant: TrimmedPattern = {
        width: mirroredTrimmed.width,
        height: mirroredTrimmed.height,
        shapeKey: mirroredTrimmed.shapeKey,
        cells: mirroredCells,
        mirrored: true,
      };
      this.addShapedCandidate(mirroredVariant.shapeKey, { recipe, variant: mirroredVariant });
    }
  }

  private addShapedCandidate(shapeKey: string, candidate: ShapedCandidate): void {
    const bucket = this.shapedByKey.get(shapeKey);
    if (bucket) {
      bucket.push(candidate);
    } else {
      this.shapedByKey.set(shapeKey, [candidate]);
    }
  }

  private indexShapelessRecipe(recipe: ShapelessRecipeDefinition): void {
    const hasTag = recipe.ingredients.some((spec) => spec.startsWith('#'));
    if (!hasTag) {
      const sortedKey = [...recipe.ingredients].sort().join(',');
      const bucket = this.shapelessByExactKey.get(sortedKey);
      if (bucket) bucket.push(recipe);
      else this.shapelessByExactKey.set(sortedKey, [recipe]);
    } else {
      const count = recipe.ingredients.length;
      const bucket = this.shapelessWithTagsByCount.get(count);
      if (bucket) bucket.push(recipe);
      else this.shapelessWithTagsByCount.set(count, [recipe]);
    }
  }

  private normalizeGrid(grid: CraftingGridInput): (NormalizedCell | null)[][] {
    if (grid.length === 0) return [];
    if (Array.isArray(grid[0])) {
      const rows = grid as ReadonlyArray<ReadonlyArray<GridSlot>>;
      if (rows.length > 3) throw new Error('Crafting grid height cannot exceed 3');
      return rows.map((row) => {
        if (row.length > 3) throw new Error('Crafting grid width cannot exceed 3');
        return row.map((slot) => this.normalizeSlot(slot));
      });
    }

    const flat = grid as ReadonlyArray<GridSlot>;
    if (flat.length === 4) {
      return [
        [this.normalizeSlot(flat[0]), this.normalizeSlot(flat[1])],
        [this.normalizeSlot(flat[2]), this.normalizeSlot(flat[3])],
      ];
    }
    if (flat.length === 9) {
      return [
        [this.normalizeSlot(flat[0]), this.normalizeSlot(flat[1]), this.normalizeSlot(flat[2])],
        [this.normalizeSlot(flat[3]), this.normalizeSlot(flat[4]), this.normalizeSlot(flat[5])],
        [this.normalizeSlot(flat[6]), this.normalizeSlot(flat[7]), this.normalizeSlot(flat[8])],
      ];
    }
    throw new Error('Flat crafting grid must have 4 (2x2) or 9 (3x3) slots');
  }

  private normalizeSlot(slot: GridSlot): NormalizedCell | null {
    if (!slot) return null;
    if (typeof slot === 'string') {
      const trimmed = slot.trim();
      if (!trimmed) return null;
      return { id: trimmed, count: 1 };
    }
    if (!slot.id) return null;
    const count = slot.count ?? 1;
    if (count <= 0) return null;
    return { id: slot.id, count };
  }

  public matchAll(grid: CraftingGridInput): CraftingRecipe[] {
    const matrix = this.normalizeGrid(grid);
    let minR = matrix.length;
    let maxR = -1;
    let minC = Infinity;
    let maxC = -1;
    const flatItems: string[] = [];

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r]!;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          flatItems.push(cell.id);
        }
      }
    }

    if (flatItems.length === 0) return [];

    const width = maxC - minC + 1;
    const height = maxR - minR + 1;
    const trimmedIds: (string | null)[] = [];
    const maskChars: string[] = [];

    for (let r = minR; r <= maxR; r++) {
      const row = matrix[r]!;
      for (let c = minC; c <= maxC; c++) {
        const cell = c < row.length ? row[c] : null;
        if (cell) {
          trimmedIds.push(cell.id);
          maskChars.push('#');
        } else {
          trimmedIds.push(null);
          maskChars.push('.');
        }
      }
    }

    const shapeKey = `${width}x${height}:${maskChars.join('')}`;
    const matched = new Map<string, CraftingRecipe>();

    const shapedCandidates = this.shapedByKey.get(shapeKey);
    if (shapedCandidates) {
      for (const { recipe, variant } of shapedCandidates) {
        if (matched.has(recipe.id)) continue;
        let ok = true;
        for (let i = 0; i < trimmedIds.length; i++) {
          const itemId = trimmedIds[i] ?? null;
          const spec = variant.cells[i] ?? null;
          if (itemId === null || spec === null) {
            if (itemId !== spec) {
              ok = false;
              break;
            }
          } else if (!this.matchesIngredient(spec, itemId)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matched.set(recipe.id, recipe);
        }
      }
    }

    const sortedKey = [...flatItems].sort().join(',');
    const exactShapeless = this.shapelessByExactKey.get(sortedKey);
    if (exactShapeless) {
      for (const recipe of exactShapeless) {
        matched.set(recipe.id, recipe);
      }
    }

    const tagShapeless = this.shapelessWithTagsByCount.get(flatItems.length);
    if (tagShapeless) {
      for (const recipe of tagShapeless) {
        if (matched.has(recipe.id)) continue;
        if (this.matchesShapelessIngredients(recipe.ingredients, flatItems)) {
          matched.set(recipe.id, recipe);
        }
      }
    }

    return [...matched.values()];
  }

  private matchesShapelessIngredients(
    specs: readonly string[],
    itemIds: readonly string[],
  ): boolean {
    if (specs.length !== itemIds.length) return false;
    const used = new Uint8Array(itemIds.length);
    const search = (specIdx: number): boolean => {
      if (specIdx === specs.length) return true;
      const spec = specs[specIdx]!;
      for (let i = 0; i < itemIds.length; i++) {
        if (used[i]) continue;
        if (this.matchesIngredient(spec, itemIds[i]!)) {
          used[i] = 1;
          if (search(specIdx + 1)) return true;
          used[i] = 0;
        }
      }
      return false;
    };
    return search(0);
  }

  public match(grid: CraftingGridInput): CraftingRecipe | null {
    const matches = this.matchAll(grid);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous crafting grid matches multiple recipes: ${matches.map((r) => r.id).join(', ')}`,
      );
    }
    return matches[0]!;
  }

  public maxCrafts(grid: CraftingGridInput): number {
    const recipe = this.match(grid);
    if (!recipe) return 0;
    const matrix = this.normalizeGrid(grid);
    let minCount = Infinity;
    for (const row of matrix) {
      for (const cell of row) {
        if (cell) {
          if (cell.count < minCount) minCount = cell.count;
        }
      }
    }
    return Number.isFinite(minCount) ? Math.max(0, Math.floor(minCount)) : 0;
  }
}

export const crafting = new CraftingRegistry();

export function match(grid: CraftingGridInput): CraftingRecipe | null {
  return crafting.match(grid);
}

export function maxCrafts(grid: CraftingGridInput): number {
  return crafting.maxCrafts(grid);
}

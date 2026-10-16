import { describe, expect, it } from 'vitest';
import {
  crafting,
  match,
  maxCrafts,
  type CraftingRecipe,
  type ShapedRecipeDefinition,
  type ShapelessRecipeDefinition,
} from '../../src/gameplay/crafting';
import { smelting } from '../../src/gameplay/smelting';
import { items } from '../../src/gameplay/items';

function expandSpecsCartesian(specs: readonly string[]): string[][] {
  let acc: string[][] = [[]];
  for (const spec of specs) {
    const options = crafting.expandIngredient(spec);
    const next: string[][] = [];
    for (const prefix of acc) {
      for (const opt of options) {
        next.push([...prefix, opt]);
      }
    }
    acc = next;
    // Cap combinatorial explosion if a recipe has many tag slots while keeping full representative coverage
    if (acc.length > 125) {
      acc = acc.slice(0, 125);
    }
  }
  return acc;
}

function buildShapedGrids(recipe: ShapedRecipeDefinition): (string | null)[][][] {
  const height = recipe.pattern.length;
  const width = Math.max(...recipe.pattern.map((r) => r.length));
  const symbols: string[] = [];
  for (let r = 0; r < height; r++) {
    const row = recipe.pattern[r]!;
    for (let c = 0; c < width; c++) {
      const ch = c < row.length ? row[c]! : ' ';
      if (ch !== ' ') symbols.push(recipe.key[ch]!);
    }
  }

  const assignments = expandSpecsCartesian(symbols);
  const grids: (string | null)[][][] = [];

  for (const assignment of assignments) {
    for (const mirror of [false, true]) {
      for (let offsetR = 0; offsetR <= 3 - height; offsetR++) {
        for (let offsetC = 0; offsetC <= 3 - width; offsetC++) {
          const grid: (string | null)[][] = [
            [null, null, null],
            [null, null, null],
            [null, null, null],
          ];
          let idx = 0;
          for (let r = 0; r < height; r++) {
            const row = recipe.pattern[r]!;
            for (let c = 0; c < width; c++) {
              const ch = c < row.length ? row[c]! : ' ';
              if (ch !== ' ') {
                const targetC = mirror ? width - 1 - c : c;
                grid[offsetR + r]![offsetC + targetC] = assignment[idx++]!;
              }
            }
          }
          grids.push(grid);
        }
      }
    }
  }

  return grids;
}

function buildShapelessGrids(recipe: ShapelessRecipeDefinition): (string | null)[][][] {
  const assignments = expandSpecsCartesian(recipe.ingredients);
  const grids: (string | null)[][][] = [];

  for (const assignment of assignments) {
    const forward: (string | null)[][] = [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ];
    for (let i = 0; i < assignment.length; i++) {
      forward[Math.floor(i / 3)]![i % 3] = assignment[i]!;
    }
    grids.push(forward);

    const reversed: (string | null)[][] = [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ];
    for (let i = 0; i < assignment.length; i++) {
      const pos = 8 - i;
      reversed[Math.floor(pos / 3)]![pos % 3] = assignment[i]!;
    }
    grids.push(reversed);
  }

  return grids;
}

describe('M10a crafting recipes & matcher', () => {
  it('loads all recipe categories and smelting data with valid registered items and tags', () => {
    expect(crafting.recipes.size).toBeGreaterThanOrEqual(85);
    expect(smelting.recipes.size).toBeGreaterThanOrEqual(15);
    expect(crafting.recipes.size + smelting.recipes.size).toBeGreaterThanOrEqual(105);

    for (const [tag, list] of crafting.tagLists.entries()) {
      expect(list.length, tag).toBeGreaterThan(0);
      for (const id of list) {
        expect(items.get(id).id).toBe(id);
      }
    }

    for (const recipe of crafting.recipes.values()) {
      expect(items.get(recipe.result.id).id).toBe(recipe.result.id);
      expect(recipe.result.count).toBeGreaterThan(0);
    }

    for (const smelt of smelting.recipes.values()) {
      expect(items.get(smelt.input).id).toBe(smelt.input);
      expect(items.get(smelt.output).id).toBe(smelt.output);
      expect(smelt.count).toBeGreaterThan(0);
      expect(smelt.xp).toBeGreaterThanOrEqual(0);
    }
  });

  it('every recipe in data/recipes/ is craftable from its listed ingredients and no two recipes are ambiguous for the same grid', () => {
    for (const recipe of crafting.recipes.values()) {
      const grids =
        recipe.type === 'shaped' ? buildShapedGrids(recipe) : buildShapelessGrids(recipe);
      expect(grids.length, recipe.id).toBeGreaterThan(0);

      for (const grid of grids) {
        const allMatches = crafting.matchAll(grid);
        expect(
          allMatches.map((r: CraftingRecipe) => r.id),
          `Ambiguous or unmatched grid for recipe ${recipe.id}`,
        ).toEqual([recipe.id]);

        const matched = match(grid);
        expect(matched?.id).toBe(recipe.id);
        expect(matched?.result).toEqual(recipe.result);
      }
    }
  });

  it('matches horizontally mirrored shaped recipes and 2x2 / 3x3 shifted placements', () => {
    // Asymmetric axe: canonical vs mirrored
    const leftAxe = [
      ['cobblestone', 'cobblestone', null],
      ['cobblestone', 'stick', null],
      [null, 'stick', null],
    ];
    const rightAxe = [
      [null, 'cobblestone', 'cobblestone'],
      [null, 'stick', 'cobblestone'],
      [null, 'stick', null],
    ];
    expect(match(leftAxe)?.id).toBe('stone_axe');
    expect(match(rightAxe)?.id).toBe('stone_axe');

    // Asymmetric hoe: canonical vs mirrored
    const leftHoe = [
      ['iron_ingot', 'iron_ingot'],
      [null, 'stick'],
      [null, 'stick'],
    ];
    const rightHoe = [
      ['iron_ingot', 'iron_ingot'],
      ['stick', null],
      ['stick', null],
    ];
    expect(match(leftHoe)?.id).toBe('iron_hoe');
    expect(match(rightHoe)?.id).toBe('iron_hoe');

    // Asymmetric bow: canonical vs mirrored
    const bowA = [
      [null, 'stick', 'silk'],
      ['stick', null, 'silk'],
      [null, 'stick', 'silk'],
    ];
    const bowB = [
      ['silk', 'stick', null],
      ['silk', null, 'stick'],
      ['silk', 'stick', null],
    ];
    expect(match(bowA)?.id).toBe('bow');
    expect(match(bowB)?.id).toBe('bow');

    // Asymmetric iron_shears in a 2x2 grid (both diagonals)
    expect(
      match([
        [null, 'iron_ingot'],
        ['iron_ingot', null],
      ])?.id,
    ).toBe('iron_shears');
    expect(
      match([
        ['iron_ingot', null],
        [null, 'iron_ingot'],
      ])?.id,
    ).toBe('iron_shears');

    // Coarse dirt 2x2 diagonal mirror
    expect(
      match([
        ['dirt', 'gravel'],
        ['gravel', 'dirt'],
      ])?.id,
    ).toBe('coarse_dirt');
    expect(
      match([
        ['gravel', 'dirt'],
        ['dirt', 'gravel'],
      ])?.id,
    ).toBe('coarse_dirt');

    // Mixed planks via #any_planks tag in 2x2 flat grid
    expect(match(['oak_planks', null, 'acacia_planks', null])?.id).toBe('stick');
  });

  it('computes maxCrafts(grid) from minimum occupied stack count and returns 0 for non-matching grids', () => {
    expect(
      maxCrafts([
        [null, null],
        [null, null],
      ]),
    ).toBe(0);
    expect(
      maxCrafts([
        ['dirt', 'dirt'],
        ['dirt', null],
      ]),
    ).toBe(0);

    expect(
      maxCrafts([
        [{ id: 'oak_planks', count: 7 }, null],
        [{ id: 'birch_planks', count: 3 }, null],
      ]),
    ).toBe(3);

    expect(
      maxCrafts([
        [
          { id: 'copper_ingot', count: 5 },
          { id: 'copper_ingot', count: 4 },
          { id: 'copper_ingot', count: 6 },
        ],
        [null, { id: 'stick', count: 9 }, null],
        [null, { id: 'stick', count: 2 }, null],
      ]),
    ).toBe(2);
  });
});

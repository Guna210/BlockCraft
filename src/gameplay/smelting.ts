import rawSmelting from '../../data/recipes/smelting.json';
import { items } from './items';
import { crafting } from './crafting';

export interface SmeltingRecipe {
  id: string;
  input: string;
  output: string;
  count: number;
  xp: number;
}

class SmeltingRegistry {
  readonly recipes = new Map<string, SmeltingRecipe>();
  readonly byInput = new Map<string, SmeltingRecipe>();

  constructor() {
    for (const [id, data] of Object.entries(
      rawSmelting as Record<string, Omit<SmeltingRecipe, 'id'>>,
    )) {
      if (this.recipes.has(id)) {
        throw new Error(`Duplicate smelting recipe ID: ${id}`);
      }
      items.get(data.input);
      items.get(data.output);
      if (!Number.isSafeInteger(data.count) || data.count <= 0) {
        throw new Error(`Invalid smelting output count for ${id}`);
      }
      if (!Number.isFinite(data.xp) || data.xp < 0) {
        throw new Error(`Invalid smelting XP for ${id}`);
      }
      if (this.byInput.has(data.input)) {
        throw new Error(`Ambiguous smelting input '${data.input}' in ${id}`);
      }
      const recipe: SmeltingRecipe = {
        id,
        input: data.input,
        output: data.output,
        count: data.count,
        xp: data.xp,
      };
      this.recipes.set(id, recipe);
      this.byInput.set(data.input, recipe);
    }
  }

  getByInput(inputId: string): SmeltingRecipe | null {
    return this.byInput.get(inputId) ?? null;
  }

  getBurnTime(itemId: string): number {
    if (itemId === 'coal') return 1600;
    if (crafting.matchesIngredient('#any_log', itemId)) return 300;
    if (crafting.matchesIngredient('#any_planks', itemId)) return 300;
    if (crafting.matchesIngredient('#any_wood_slab', itemId)) return 150;
    if (itemId === 'stick' || itemId === 'bowl' || itemId === 'ladder') return 100;
    if (itemId.startsWith('wooden_')) return 200;
    return 0;
  }

  isFuel(itemId: string): boolean {
    return this.getBurnTime(itemId) > 0;
  }
}

export function getBurnTime(itemId: string): number {
  return smelting.getBurnTime(itemId);
}

export const smelting = new SmeltingRegistry();

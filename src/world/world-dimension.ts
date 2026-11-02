import type { World } from './world';

/** Which dimension each World instance belongs to; set once when WorldManager builds it. */
const dimensions = new WeakMap<World, string>();

export function setWorldDimension(world: World, dimension: string): void {
  dimensions.set(world, dimension);
}

/** The dimension of a World; worlds built outside WorldManager (tests, menus) are Overworld. */
export function worldDimension(world: World): string {
  return dimensions.get(world) ?? 'overworld';
}

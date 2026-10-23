import type { EntityWorld } from '../ecs/world';
import { EntityKindC } from '../ecs/components';
import { entityState } from '../ecs/systems';

/** What a 'use' on a mob cost the player: one of the held item, or one point of tool durability. */
export type MobUse = 'consume' | 'wear';

/** Handles 'use' with an item on one mob type; null when the item does nothing to it. */
export type MobInteraction = (ecs: EntityWorld, id: number, itemId: string) => MobUse | null;

const interactions = new Map<string, MobInteraction>();

/** Registers what 'use' does on a mob type (shearing, feeding a baby); one handler per type. */
export function registerMobInteraction(type: string, handler: MobInteraction): void {
  if (interactions.has(type)) throw new Error(`Duplicate mob interaction: ${type}`);
  interactions.set(type, handler);
}

/** Runs the type's 'use' handler on a living mob. */
export function interactMob(ecs: EntityWorld, id: number, itemId: string): MobUse | null {
  const type = ecs.get(id, EntityKindC)?.type;
  if (type === undefined || entityState(ecs, id) === 'dying') return null;
  return interactions.get(type)?.(ecs, id, itemId) ?? null;
}

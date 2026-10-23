import type { WorldManager } from '../../world/world-manager';
import { items } from '../../gameplay/items';
import { BlockRegistry } from '../../world/blocks/registry';
import { spawnEntity, entityTypeIds } from '../../entity/ecs/entity-types';
import { setWeather } from '../../world/weather';
import { STRUCTURE_PLACEMENT_CONFIGS } from '../../gen/structures/placement';
import { OVERWORLD_ORE_IDS } from '../../gen/ores';
import { locateStructure } from './structure-locate';
import { locateOreSteps } from './ore-locate';
import type { CommandContext } from './index';
import type { CompletionCatalog, Position } from './parser';

const yieldTask = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export function completionCatalog(): CompletionCatalog {
  return {
    items: [...items.items.keys()],
    blocks: BlockRegistry.getInstance().getAllBlockIds(),
    // Read a snapshot; summoning itself delegates every type to the live registry.
    entities: [...entityTypeIds(), ...[...items.items.keys()].map((id) => `item:${id}`)],
    structures: STRUCTURE_PLACEMENT_CONFIGS.map((config) => config.id),
    ores: OVERWORLD_ORE_IDS,
  };
}

export function commandContext(manager: WorldManager): CommandContext {
  const controller = manager.playerController,
    player = controller?.player,
    world = manager.world;
  if (!controller || !player || !world) throw new Error('Open a world before using commands');
  const current = () => {
    if (manager.world !== world || controller.player !== player)
      throw new Error('World changed; command cancelled');
  };
  return {
    position: () => [...player.pos] as Position,
    teleport: ([x, y, z]) => controller.teleport(x, y, z),
    give: (id, count) => player.inventory.insert(id, count),
    setTime: (ticks) => manager.setTimeOfDay(ticks),
    setWeather,
    setMode: (mode) => player.setGameMode(mode),
    seed: () => manager.worldSeedStr,
    hasItem: (id) => items.items.has(id),
    hasBlock: (id) => BlockRegistry.getInstance().getDefaultStateId(id) !== undefined,
    fill: async (min, max, id) => {
      let count = 0;
      let batchStart = performance.now();
      for (let x = min[0]; x <= max[0]; x++)
        for (let z = min[2]; z <= max[2]; z++)
          for (let y = min[1]; y <= max[1]; y++) {
            current();
            world.setBlock(x, y, z, id);
            if (++count % 128 === 0 || performance.now() - batchStart >= 4) {
              await yieldTask();
              batchStart = performance.now();
            }
          }
    },
    locate: async (kind, id) => {
      if (kind === 'structure') {
        if (!STRUCTURE_PLACEMENT_CONFIGS.some((config) => config.id === id))
          throw new Error(`Unknown structure: ${id}`);
        return locateStructure(id, [...player.pos] as Position);
      }
      if (!OVERWORLD_ORE_IDS.includes(id)) throw new Error(`Unknown ore: ${id}`);
      const steps = locateOreSteps(id, [...player.pos] as Position);
      let result = steps.next();
      while (!result.done) {
        await yieldTask();
        current();
        result = steps.next();
      }
      return result.value;
    },
    summon: (type, [x, y, z]) => {
      if (!controller.ecs || !controller.itemEntities) throw new Error('Entities are not ready');
      spawnEntity({ ecs: controller.ecs, items: controller.itemEntities }, type, x, y, z);
    },
  };
}

import type { Player } from '../entity/player';
import type { ItemEntityManager } from '../entity/item-entity';
import type { ParticleSink } from './particle-sink';
import { BlockRegistry } from '../world/blocks/registry';
import { getToolDurability } from './tools';
import { canHarvest, type MiningTool } from './mining';
import { rollBlockLoot } from './loot';

/** Shared mining rewards, exhaustion and tool wear; presentation stays optional. */
export function finishBlockDrops(
  player: Player,
  drops: ItemEntityManager,
  state: number,
  x: number,
  y: number,
  z: number,
  tool: MiningTool,
  particles?: ParticleSink,
): void {
  const world = player.collision.world;
  const block = BlockRegistry.getInstance().getResolvedState(state)!;
  if (player.mode === 'survival') {
    player.survival.addExhaustion(0.005);
    const held = player.inventory.held;
    if (held) {
      const durability = getToolDurability(held);
      if (durability !== null && durability > 0) {
        held.damage = (held.damage ?? 0) + 1;
        if (held.damage >= durability) {
          particles?.spawn(state, player.pos[0], player.pos[1] + player.eye, player.pos[2]);
          player.inventory.slots[player.inventory.selectedSlot] = null;
        }
      }
    }
  }

  if (player.mode === 'creative' || !canHarvest(block.definition, tool)) return;
  const breakCount = world.breakCount++;
  const loot = rollBlockLoot(block.blockId, world.worldSeed, x, y, z, breakCount);
  for (let n = 0; n < loot.length; n++) {
    const entry = loot[n]!;
    drops.spawn(entry.id, entry.count, x + 0.5, y + 0.5, z + 0.5);
  }
}

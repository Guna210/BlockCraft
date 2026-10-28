import type { World } from '../world/world';
import type { StructureMarker } from '../gen/structures/stage';
import { rollChestLootById } from './chest-loot';
import type { ChestEntityState } from './chests';
import type { SpawnerState } from './spawners';

/**
 * Sets up the block entities of a freshly generated column's structure blocks: each chest gets its
 * structure's loot (only while it is still empty) and each spawner its creature. A marker whose block
 * is no longer there is skipped.
 */
export function applyStructureMarkers(world: World, markers: readonly StructureMarker[]): void {
  for (const marker of markers) {
    const { x, y, z } = marker;
    const block = world.getBlock(x, y, z);
    if (block.id !== marker.kind) continue;
    if (!world.getBlockEntity(x, y, z)) {
      world.blockEntities.onBlockChanged(x, y, z, 'air', block.id, world.getBlockStateId(x, y, z));
    }
    if (marker.kind === 'spawner') {
      const spawner = world.getBlockEntity<SpawnerState>(x, y, z);
      if (spawner) spawner.creature = marker.creature;
      continue;
    }
    const chest = world.getBlockEntity<ChestEntityState>(x, y, z);
    if (!chest || chest.slots.some((slot) => slot !== null)) continue;
    rollChestLootById(marker.table, world.worldSeed ?? 0, x, y, z).forEach((stack, index) => {
      chest.slots[index] = {
        id: stack.id,
        count: stack.count,
        ...(stack.damage !== undefined ? { damage: stack.damage } : {}),
        ...(stack.affix !== undefined ? { affix: stack.affix } : {}),
      };
    });
  }
}

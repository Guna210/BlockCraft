import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import type { SaveStats } from '../../persist/save-manager';
import { getWorldInstance } from '../../world/world-instance';
import { activeUi } from '../../ui/ui-manager';
import { activeWorldList } from '../../ui/world-list-screen';

/** Saves the open world and resolves when it is written (SPEC §4). */
api.save = () => WorldManager.getInstance().save();

/** Replaces the open world with a saved one (SPEC §4). */
api.loadWorld = (name) => WorldManager.getInstance().loadWorld(name);

/** Opens the world list without changing the debug createWorld boot flow. */
api.openWorldList = async () => {
  if (activeUi.manager?.screen) activeUi.manager.close();
  if (!activeWorldList.screen) throw new Error('The world list is not ready');
  await activeWorldList.screen.open();
};

/** The saved-world list in plain JSON form for debug inspection. */
api.listWorlds = async () => {
  const records = await WorldManager.getInstance().saves.listWorlds();
  return records
    .sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name))
    .map(({ name, lastPlayed, thumbnail }) => ({
      name,
      lastPlayed,
      hasThumbnail: Boolean(thumbnail),
    }));
};

/** Starts the incremental autosave now, spread across frames; resolves when it is written. */
api.autosaveNow = () => {
  const saves = WorldManager.getInstance().saves;
  if (!saves.session) return Promise.reject(new Error('Only a named world can be saved'));
  return saves.autosaveNow();
};

api.getSaveStats = async () => {
  const saves = WorldManager.getInstance().saves;
  const stats: SaveStats = { ...saves.stats };
  if (!saves.session) return { stats, usage: null };
  return { stats, usage: await saves.databaseUsage() };
};

/** The state of the block entity at a position (chest slots, kiln progress), or null. */
api.getBlockEntity = (x, y, z) => {
  const entity = getWorldInstance().blockEntities.get(x, y, z);
  return entity
    ? JSON.parse(JSON.stringify({ blockId: entity.blockId, state: entity.state }))
    : null;
};

api.spawnPoint = (set) => {
  const player = WorldManager.getInstance().playerController?.player;
  if (!player) throw new Error('Create a world first');
  if (set !== undefined) player.spawnPoint = set === null ? null : [set[0], set[1], set[2]];
  return player.spawnPoint ? [...player.spawnPoint] : null;
};

import { api } from './core';
import { activeUi } from '../../ui/ui-manager';
import { activeMenu } from '../../ui/main-menu';
import { WorldManager } from '../../world/world-manager';

function ui() {
  if (!activeUi.manager) throw new Error('The UI is not ready');
  return activeUi.manager;
}

api.openScreen = (name) => {
  if (name === 'none') ui().close();
  else ui().open(name);
  ui().render();
};
api.getScreen = () => ui().snapshot();
api.getMenuState = () => {
  const manager = WorldManager.getInstance();
  const columns = manager.chunkRenderer?.meshedColumns() ?? [];
  const world = manager.world;
  const outside = columns.filter((key) => {
    const [cx, cz] = key.split(',').map(Number);
    return !world || !world.hasColumn(cx!, cz!);
  });
  return {
    menuVisible: activeMenu.menu?.visible ?? false,
    panorama: manager.panorama,
    panoramaStarts: manager.panoramaStarts,
    lastTeardown: manager.lastPanoramaTeardown ? { ...manager.lastPanoramaTeardown } : null,
    sectionMeshes: manager.chunkRenderer?.sectionMeshCount ?? 0,
    meshedColumns: columns.length,
    meshedColumnsOutsideWorld: outside.length,
  };
};
api.uiClickSlot = (slot, button, shift = false) => {
  const manager = ui();
  if (!manager.screen) throw new Error('Open a screen before clicking a slot');
  if (button !== 'left' && button !== 'right') throw new Error(`Unknown button: ${button}`);
  manager.clickSlot(slot, button, shift);
  manager.render();
};

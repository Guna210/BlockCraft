import { api } from './core';
import { activeUi } from '../../ui/ui-manager';

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
api.uiClickSlot = (slot, button, shift = false) => {
  const manager = ui();
  if (!manager.screen) throw new Error('Open a screen before clicking a slot');
  if (button !== 'left' && button !== 'right') throw new Error(`Unknown button: ${button}`);
  manager.clickSlot(slot, button, shift);
  manager.render();
};

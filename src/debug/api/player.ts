import { api } from './core';
import { WorldManager } from '../../world/world-manager';
import type { Action } from '../../engine/input';
import { look } from './camera';

function controller() {
  const result = WorldManager.getInstance().playerController;
  if (!result?.player) throw new Error('Create a world before controlling the player');
  return result;
}

export function registerPlayerApi(): void {
  api.getPlayer = () => controller().player!.snapshot();
  api.teleport = (x, y, z, yaw, pitch) => {
    if (![x, y, z, yaw ?? 0, pitch ?? 0].every(Number.isFinite))
      throw new Error('Teleport coordinates must be finite');
    controller().teleport(x, y, z, yaw, pitch);
  };
  api.input = (action, down) => {
    const c = controller();
    if (!c.input.actionStates.has(action as Action))
      throw new Error(`Unknown input action: ${action}`);
    c.setInput(action as Action, down);
  };
  api.look = look;
  api.pause = () => controller().loop.pause();
  api.resume = () => controller().loop.resume();
  api.tick = async (n) => {
    controller().tick(n);
  };
  api.setGameMode = (mode) => {
    if (mode !== 'survival' && mode !== 'creative') throw new Error(`Unknown game mode: ${mode}`);
    controller().player!.setGameMode(mode);
  };
}

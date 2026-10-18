// Drives pistons, dispensers and note blocks through the real engine, so tests press buttons and
// read the moving blocks the renderer draws.
import { api } from './core';
import { getWorldInstance } from '../../world/world-instance';
import { BlockRegistry } from '../../world/blocks/registry';
import type { ToneEvent } from '../../gameplay/mechanics';

const tones: ToneEvent[] = [];
let subscribed: object | null = null;

function watchTones(): void {
  const mechanics = getWorldInstance().current.mechanics;
  if (subscribed === mechanics) return;
  subscribed = mechanics;
  tones.length = 0;
  mechanics.onTone((event) => tones.push(event));
}

api.useBlock = (x, y, z) => {
  watchTones();
  return getWorldInstance().current.useBlock(x, y, z);
};
api.getMovingBlocks = () => {
  const registry = BlockRegistry.getInstance();
  return getWorldInstance()
    .current.mechanics.movingBlocks()
    .map((view) => ({
      x: view.x,
      y: view.y,
      z: view.z,
      blocks: view.parts.map((part) => registry.getResolvedState(part.stateId)?.blockId ?? 'air'),
    }));
};
api.loadDispenser = (x, y, z, id, count = 1) =>
  getWorldInstance().current.mechanics.insertItem(x, y, z, id, count);
api.getTones = () => {
  watchTones();
  return tones.map((event) => ({ ...event }));
};

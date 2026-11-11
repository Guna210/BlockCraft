import { api } from './core';
import { WorldManager } from '../../game/world-manager';
import type { LeavesSetting } from '../../engine/settings';

/**
 * Sets the leaves rendering mode ('fancy' | 'fast'); loaded sections are remeshed when it changes.
 */
export function setLeaves(mode: LeavesSetting): void {
  WorldManager.getInstance().setLeaves(mode);
}

api.setLeaves = setLeaves;

import { api } from './core';
import { setWorldTime } from '../../world/time';
import { WorldManager } from '../../world/world-manager';

/**
 * Sets the world time in simulation ticks (0 = sunrise, 6000 = noon, 12000 = sunset, 18000 = midnight).
 */
export function setTimeOfDay(ticks: number): void {
  setWorldTime(ticks);
  WorldManager.getInstance().setTimeOfDay(ticks);
}

api.setTimeOfDay = setTimeOfDay;

import { api } from './core';
import { settings, type CloudSetting } from '../../engine/settings';

/**
 * Sets the cloud rendering mode ('fancy' | 'fast' | 'off').
 */
export function setClouds(mode: CloudSetting): void {
  settings.clouds = mode;
}

api.setClouds = setClouds;

import { api } from './core';
import {
  setSetting as setLiveSetting,
  resetSettings as resetLiveSettings,
} from '../../engine/settings-runtime';
import { settings, type Settings } from '../../engine/settings';
import { normalizeSettings } from '../../engine/settings-persistence';

export function getSettings(): Settings {
  return normalizeSettings(settings);
}

export function setSetting(key: keyof Settings, value: unknown): Settings {
  if (!Object.prototype.hasOwnProperty.call(settings, key))
    throw new Error(`Unknown setting '${String(key)}'`);
  return setLiveSetting(key, value as never);
}

export function resetSettings(): Settings {
  return resetLiveSettings();
}

api.getSettings = getSettings;
api.setSetting = setSetting;
api.resetSettings = resetSettings;

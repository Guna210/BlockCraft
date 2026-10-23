import {
  defaultSettings,
  GUI_SCALE_CHANGE_EVENT,
  replaceSettings,
  settings,
  type Settings,
} from './settings';
import { loadSettings, normalizeSettings, persistSettings } from './settings-persistence';
import { WorldManager } from '../world/world-manager';

export type SettingKey = keyof Settings;

function notifyGuiScaleChange(previous: Settings['guiScale']): void {
  if (previous !== settings.guiScale && typeof window !== 'undefined')
    window.dispatchEvent(new Event(GUI_SCALE_CHANGE_EVENT));
}

/** Applies the settings whose existing engine paths need an explicit update. */
export function applySettingsToGame(): void {
  const manager = WorldManager.getInstance();
  manager.setRenderDistance(settings.renderDistance);
  manager.setLeaves(settings.leaves);
  const camera = manager.camera;
  if (camera) {
    camera.fov = (settings.fov * Math.PI) / 180;
    camera.updateProjection();
  }
}

/** Must finish before the menu is shown, so saved preferences are visible immediately. */
export async function loadSavedSettings(): Promise<void> {
  try {
    replaceSettings(await loadSettings());
  } catch {
    replaceSettings(defaultSettings());
  }
  applySettingsToGame();
}

export function applySetting<K extends SettingKey>(key: K, value: Settings[K]): Settings {
  const previous = { ...settings };
  const normalized = normalizeSettings({ ...settings, [key]: value });
  replaceSettings(normalized);
  const manager = WorldManager.getInstance();
  if (previous.renderDistance !== settings.renderDistance)
    manager.setRenderDistance(settings.renderDistance);
  if (previous.leaves !== settings.leaves) manager.setLeaves(settings.leaves);
  if (previous.fov !== settings.fov && manager.camera) {
    manager.camera.fov = (settings.fov * Math.PI) / 180;
    manager.camera.updateProjection();
  }
  notifyGuiScaleChange(previous.guiScale);
  return settings;
}

export function persistCurrentSettings(): void {
  void persistSettings(settings).catch((error: unknown) => {
    console.warn('Could not save settings', error);
  });
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Settings {
  applySetting(key, value);
  persistCurrentSettings();
  return settings;
}

export function resetSettings(): Settings {
  const previousGuiScale = settings.guiScale;
  const defaults = defaultSettings();
  replaceSettings(defaults);
  applySettingsToGame();
  notifyGuiScaleChange(previousGuiScale);
  persistCurrentSettings();
  return settings;
}

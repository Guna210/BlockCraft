import { defaultSettings, type Settings } from './settings';
import { DEFAULT_KEY_BINDINGS, KEYBIND_ACTIONS } from './keybinds';
import { SaveDb, type IdbEnvironment } from '../persist/idb';

export const SETTINGS_RECORD_KEY = 'global';

function finiteIn(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Accepts only known fields and sanitizes damaged/old records field by field. */
export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const rawBindings = raw.keyBindings;
  const bindings = { ...DEFAULT_KEY_BINDINGS };
  if (rawBindings && typeof rawBindings === 'object' && !Array.isArray(rawBindings)) {
    const source = rawBindings as Record<string, unknown>;
    for (const action of KEYBIND_ACTIONS) {
      const code = source[action];
      if (typeof code === 'string' && code.length <= 32) bindings[action] = code;
    }
  }
  const settings: Settings = {
    ...defaults,
    renderDistance: Math.round(finiteIn(raw.renderDistance, defaults.renderDistance, 2, 32)),
    fov: finiteIn(raw.fov, defaults.fov, 50, 110),
    mouseSensitivity: finiteIn(raw.mouseSensitivity, defaults.mouseSensitivity, 0.1, 5),
    invertY: typeof raw.invertY === 'boolean' ? raw.invertY : defaults.invertY,
    leaves: raw.leaves === 'fast' || raw.leaves === 'fancy' ? raw.leaves : defaults.leaves,
    clouds:
      raw.clouds === 'fast' || raw.clouds === 'off' || raw.clouds === 'fancy'
        ? raw.clouds
        : defaults.clouds,
    smoothLighting:
      typeof raw.smoothLighting === 'boolean' ? raw.smoothLighting : defaults.smoothLighting,
    particles: typeof raw.particles === 'boolean' ? raw.particles : defaults.particles,
    guiScale:
      raw.guiScale === 'auto' ||
      raw.guiScale === 1 ||
      raw.guiScale === 2 ||
      raw.guiScale === 3 ||
      raw.guiScale === 4
        ? raw.guiScale
        : defaults.guiScale,
    brightness: finiteIn(raw.brightness, defaults.brightness, 0.25, 1.5),
    viewBobbing: typeof raw.viewBobbing === 'boolean' ? raw.viewBobbing : defaults.viewBobbing,
    masterVolume: finiteIn(raw.masterVolume, defaults.masterVolume, 0, 1),
    musicVolume: finiteIn(raw.musicVolume, defaults.musicVolume, 0, 1),
    effectsVolume: finiteIn(raw.effectsVolume, defaults.effectsVolume, 0, 1),
    ambientVolume: finiteIn(raw.ambientVolume, defaults.ambientVolume, 0, 1),
    keyBindings: bindings,
  };
  return settings;
}

export async function loadSettings(env?: IdbEnvironment): Promise<Settings> {
  const db = await SaveDb.open(env);
  try {
    const record = await db.get<{ key: string; value: unknown }>('settings', SETTINGS_RECORD_KEY);
    return record ? normalizeSettings(record.value) : defaultSettings();
  } finally {
    db.close();
  }
}

export async function saveSettings(settings: Settings, env?: IdbEnvironment): Promise<void> {
  const db = await SaveDb.open(env);
  try {
    await db.write([
      {
        op: 'put',
        store: 'settings',
        value: { key: SETTINGS_RECORD_KEY, value: normalizeSettings(settings) },
      },
    ]);
  } finally {
    db.close();
  }
}

let pendingSettingsWrite: Promise<void> = Promise.resolve();

/** Serialize UI/debug writes so rapid slider clicks persist in the same order they were made. */
export function persistSettings(source: Settings): Promise<void> {
  const snapshot = normalizeSettings(source);
  pendingSettingsWrite = pendingSettingsWrite.catch(() => {}).then(() => saveSettings(snapshot));
  return pendingSettingsWrite;
}

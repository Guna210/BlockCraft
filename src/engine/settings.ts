import { cloneKeyBindings, DEFAULT_KEY_BINDINGS, type KeyBindings } from './keybinds';

export type CloudSetting = 'fancy' | 'fast' | 'off';
export type LeavesSetting = 'fancy' | 'fast';
export type GuiScaleSetting = 'auto' | 1 | 2 | 3 | 4;

/** Sent only when the chosen GUI scale changes so cached overlays can redraw on demand. */
export const GUI_SCALE_CHANGE_EVENT = 'blockcraft:gui-scale-change';

export interface Settings {
  renderDistance: number;
  fov: number;
  /** Multiplier over the original 0.002 camera sensitivity. */
  mouseSensitivity: number;
  invertY: boolean;
  viewBobbing: boolean;
  clouds: CloudSetting;
  /** 'fast' draws leaves as opaque cubes without waving; changing it remeshes. */
  leaves: LeavesSetting;
  smoothLighting: boolean;
  particles: boolean;
  guiScale: GuiScaleSetting;
  brightness: number;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  ambientVolume: number;
  keyBindings: KeyBindings;
}

/** Defaults preserve the game's pre-settings behavior. FOV is in degrees. */
export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8,
  fov: 70,
  mouseSensitivity: 1,
  invertY: false,
  viewBobbing: true,
  clouds: 'fancy',
  leaves: 'fancy',
  smoothLighting: true,
  particles: true,
  guiScale: 'auto',
  brightness: 1,
  masterVolume: 1,
  musicVolume: 1,
  effectsVolume: 1,
  ambientVolume: 1,
  keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS),
};

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS) };
}

/** The live settings object is read by existing render, camera and world paths. */
export const settings: Settings = defaultSettings();

export function replaceSettings(next: Settings): void {
  Object.assign(settings, next, { keyBindings: cloneKeyBindings(next.keyBindings) });
}

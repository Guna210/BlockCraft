import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettings } from '../../src/engine/settings';
import { actionsForCode, conflictsFor, KEYBIND_ACTIONS } from '../../src/engine/keybinds';
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../../src/engine/settings-persistence';
import { DB_NAME, DB_VERSION, SaveDb, STORE_KEY_PATHS } from '../../src/persist/idb';
import { createFakeIdb } from './helpers/fake-idb';

describe('M18b settings and key bindings', () => {
  it('defaults preserve current game behavior and provide every M18 setting', () => {
    const defaults = defaultSettings();
    expect(defaults).toMatchObject({
      renderDistance: 8,
      fov: 70,
      mouseSensitivity: 1,
      invertY: false,
      leaves: 'fancy',
      clouds: 'fancy',
      smoothLighting: true,
      particles: true,
      guiScale: 'auto',
      brightness: 1,
      viewBobbing: true,
      masterVolume: 1,
      musicVolume: 1,
      effectsVolume: 1,
      ambientVolume: 1,
    });
    expect(Object.keys(defaults.keyBindings)).toEqual([...KEYBIND_ACTIONS]);
    expect(DEFAULT_SETTINGS.keyBindings.jump).toBe('Space');
  });

  it('detects shared keys and routes every action on a conflict', () => {
    const bindings = defaultSettings().keyBindings;
    bindings.jump = 'KeyK';
    bindings.forward = 'KeyK';
    expect(conflictsFor(bindings)).toContainEqual(['KeyK', ['forward', 'jump']]);
    expect(actionsForCode('KeyK', bindings)).toEqual(['forward', 'jump']);
    bindings.jump = 'KeyK';
    expect(actionsForCode('Space', bindings)).toEqual([]);
  });

  it('falls back to defaults for missing or corrupt values and normalizes known fields', () => {
    expect(normalizeSettings(undefined).fov).toBe(70);
    expect(
      normalizeSettings({ fov: 'wide', renderDistance: 99, clouds: 'broken', keyBindings: null }),
    ).toMatchObject({
      fov: 70,
      renderDistance: 32,
      clouds: 'fancy',
      keyBindings: { jump: 'Space' },
    });
  });

  it('persists, reloads, and defaults a missing settings record', async () => {
    const fake = createFakeIdb();
    expect(await loadSettings(fake.env)).toMatchObject({ fov: 70, renderDistance: 8 });
    const value = defaultSettings();
    value.fov = 88;
    value.keyBindings.jump = 'KeyK';
    await saveSettings(value, fake.env);
    expect(await loadSettings(fake.env)).toMatchObject({ fov: 88, keyBindings: { jump: 'KeyK' } });
    const db = await SaveDb.open(fake.env);
    await db.write([
      { op: 'put', store: 'settings', value: { key: 'global', value: { fov: 'wide' } } },
    ]);
    db.close();
    expect(await loadSettings(fake.env)).toMatchObject({ fov: 70, renderDistance: 8 });
  });

  it('upgrades a v1 database and preserves its saved world', async () => {
    const fake = createFakeIdb();
    const request = fake.env.factory.open(DB_NAME, 1) as IDBOpenDBRequest;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, keyPath] of Object.entries(STORE_KEY_PATHS).filter(
        ([name]) => name !== 'settings',
      ))
        db.createObjectStore(name, { keyPath: keyPath as string | string[] });
    };
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('v1 open failed'));
    });
    const transaction = legacy.transaction('worlds', 'readwrite');
    transaction
      .objectStore('worlds')
      .put({ name: 'saved-world', formatVersion: 1, seedString: 'abc' });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('v1 write failed'));
    });
    legacy.close();

    const upgraded = await SaveDb.open(fake.env);
    expect(fake.versionOf(DB_NAME)).toBe(DB_VERSION);
    expect(await upgraded.get('worlds', 'saved-world')).toEqual({
      name: 'saved-world',
      formatVersion: 1,
      seedString: 'abc',
    });
    expect(await upgraded.count('settings')).toBe(0);
    upgraded.close();
  });
});

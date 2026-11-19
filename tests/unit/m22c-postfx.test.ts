import { describe, expect, it } from 'vitest';
import { createEmptyTexture, type TextureData } from '../../src/gen/texture-noise';
import { DEFAULT_SETTINGS, defaultSettings } from '../../src/engine/settings';
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../../src/engine/settings-persistence';
import { SaveDb } from '../../src/persist/idb';
import { TextureAtlas } from '../../src/render/atlas';
import { Camera } from '../../src/render/camera';
import { atlasTileIndex } from '../../src/render/foliage';
import { buildEmissiveTileTable, EMISSIVE_TABLE_SIZE } from '../../src/render/post/emissive-tiles';
import {
  computeGodRaysState,
  fillActivePostFxPasses,
  getActivePostFxPasses,
  type PostFxPassName,
} from '../../src/render/post/sun-visibility';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { skyAtmosphereFactors, sunDirection } from '../../src/world/time';
import { createFakeIdb } from './helpers/fake-idb';

function buildMinimalAtlasForEmissiveTest(): TextureAtlas {
  const tiles = new Map<string, TextureData>();
  const names = [
    'stone',
    'snow',
    'sand',
    'lumite_block',
    'lumite_ore',
    'torch',
    'fire',
    'glowcap',
    'glowcap_gills',
    'lamp_top',
    'lamp_side',
    'lamp_bottom',
    'lamp_top_lit',
    'lamp_side_lit',
    'lamp_bottom_lit',
    'kiln_top',
    'kiln_side',
    'kiln_bottom',
    'kiln_front',
    'kiln_front_lit',
  ];
  for (const name of names) {
    tiles.set(name, createEmptyTexture());
  }
  for (let frame = 0; frame < 32; frame++) {
    tiles.set(`water_${frame}`, createEmptyTexture());
    tiles.set(`lava_${frame}`, createEmptyTexture());
  }
  return new TextureAtlas(tiles, { width: 512 });
}

describe('M22c post-processing', () => {
  it('defaults fxaa, bloom, and godRays to false', () => {
    expect(DEFAULT_SETTINGS.fxaa).toBe(false);
    expect(DEFAULT_SETTINGS.bloom).toBe(false);
    expect(DEFAULT_SETTINGS.godRays).toBe(false);
    expect(defaultSettings()).toMatchObject({
      fxaa: false,
      bloom: false,
      godRays: false,
    });
  });

  it('persists, reloads, and defaults missing or corrupt post-fx fields from old saves', async () => {
    const fake = createFakeIdb();

    // Simulate an older saved settings record lacking fxaa, bloom, and godRays.
    const db = await SaveDb.open(fake.env);
    await db.write([
      {
        op: 'put',
        store: 'settings',
        value: {
          key: 'global',
          value: {
            renderDistance: 10,
            fov: 80,
            smoothLighting: true,
            particles: false,
          },
        },
      },
    ]);
    db.close();

    expect(await loadSettings(fake.env)).toMatchObject({
      renderDistance: 10,
      fov: 80,
      smoothLighting: true,
      particles: false,
      fxaa: false,
      bloom: false,
      godRays: false,
    });

    // Reject non-boolean values cleanly.
    expect(normalizeSettings({ fxaa: 'on', bloom: 1, godRays: null })).toMatchObject({
      fxaa: false,
      bloom: false,
      godRays: false,
    });

    // Full round-trip with toggles enabled.
    const custom = defaultSettings();
    custom.fxaa = true;
    custom.bloom = true;
    custom.godRays = true;
    await saveSettings(custom, fake.env);

    expect(await loadSettings(fake.env)).toMatchObject({
      fxaa: true,
      bloom: true,
      godRays: true,
    });
  });

  it('builds the emissive tile lookup table for lit tiles only', () => {
    const registry = BlockRegistry.getInstance();
    const atlas = buildMinimalAtlasForEmissiveTest();
    const table = buildEmissiveTileTable(registry, atlas);

    expect(table.length).toBe(EMISSIVE_TABLE_SIZE * EMISSIVE_TABLE_SIZE);

    // Unconditionally emissive blocks
    expect(table[atlasTileIndex(atlas, 'lumite_block')]).toBeGreaterThan(0);
    expect(table[atlasTileIndex(atlas, 'lumite_ore')]).toBeGreaterThan(0);
    expect(table[atlasTileIndex(atlas, 'torch')]).toBeGreaterThan(0);
    expect(table[atlasTileIndex(atlas, 'fire')]).toBe(255);
    expect(table[atlasTileIndex(atlas, 'glowcap')]).toBeGreaterThan(0);
    expect(table[atlasTileIndex(atlas, 'glowcap_gills')]).toBeGreaterThan(0);
    for (let frame = 0; frame < 32; frame++) {
      expect(table[atlasTileIndex(atlas, `lava_${frame}`)]).toBe(255);
      expect(table[atlasTileIndex(atlas, `water_${frame}`)]).toBe(0);
    }

    // Conditionally emissive tiles
    expect(table[atlasTileIndex(atlas, 'lamp_top_lit')]).toBe(255);
    expect(table[atlasTileIndex(atlas, 'lamp_side_lit')]).toBe(255);
    expect(table[atlasTileIndex(atlas, 'lamp_bottom_lit')]).toBe(255);
    expect(table[atlasTileIndex(atlas, 'lamp_top')]).toBe(0);
    expect(table[atlasTileIndex(atlas, 'lamp_side')]).toBe(0);
    expect(table[atlasTileIndex(atlas, 'lamp_bottom')]).toBe(0);

    expect(table[atlasTileIndex(atlas, 'kiln_front_lit')]).toBeGreaterThan(0);
    expect(table[atlasTileIndex(atlas, 'kiln_front')]).toBe(0);
    expect(table[atlasTileIndex(atlas, 'kiln_side')]).toBe(0);

    // Non-emissive surfaces must never bloom
    expect(table[atlasTileIndex(atlas, 'stone')]).toBe(0);
    expect(table[atlasTileIndex(atlas, 'snow')]).toBe(0);
    expect(table[atlasTileIndex(atlas, 'sand')]).toBe(0);
  });

  it('computes sun screen position and god-rays visibility correctly', () => {
    const camera = new Camera(16 / 9);
    const ticksMorning = 2000;
    const sun = sunDirection(ticksMorning);
    const { dayFactor, twilightFactor } = skyAtmosphereFactors(ticksMorning);

    // Aim camera directly at the morning sun (+X, raised upward toward sun y)
    camera.yaw = Math.atan2(sun[2], sun[0]);
    camera.pitch = Math.asin(sun[1]);
    camera.updateView();

    const centered = computeGodRaysState({
      enabled: true,
      dimension: 'overworld',
      underwater: false,
      sunDir: sun,
      dayFactor,
      twilightFactor,
      rainFactor: 0,
      viewMatrix: camera.viewMatrix,
      projectionMatrix: camera.projectionMatrix,
    });
    expect(centered.enabled).toBe(true);
    expect(centered.sunUV[0]).toBeCloseTo(0.5, 3);
    expect(centered.sunUV[1]).toBeCloseTo(0.5, 3);
    expect(centered.intensity).toBeGreaterThan(0.8);

    // Turning away hides god rays
    camera.yaw += Math.PI;
    camera.updateView();
    const away = computeGodRaysState({
      enabled: true,
      dimension: 'overworld',
      underwater: false,
      sunDir: sun,
      dayFactor,
      twilightFactor,
      rainFactor: 0,
      viewMatrix: camera.viewMatrix,
      projectionMatrix: camera.projectionMatrix,
    });
    expect(away.enabled).toBe(false);
    expect(away.intensity).toBe(0);

    // Restore aim toward sun and verify edge/condition cutoffs
    camera.yaw = Math.atan2(sun[2], sun[0]);
    camera.pitch = Math.asin(sun[1]);
    camera.updateView();

    // Off underwater
    expect(
      computeGodRaysState({
        enabled: true,
        dimension: 'overworld',
        underwater: true,
        sunDir: sun,
        dayFactor,
        twilightFactor,
        rainFactor: 0,
        viewMatrix: camera.viewMatrix,
        projectionMatrix: camera.projectionMatrix,
      }).enabled,
    ).toBe(false);

    // Off in Hollowdeep
    expect(
      computeGodRaysState({
        enabled: true,
        dimension: 'hollowdeep',
        underwater: false,
        sunDir: sun,
        dayFactor,
        twilightFactor,
        rainFactor: 0,
        viewMatrix: camera.viewMatrix,
        projectionMatrix: camera.projectionMatrix,
      }).enabled,
    ).toBe(false);

    // Off at night
    const ticksNight = 18000;
    const nightSun = sunDirection(ticksNight);
    const nightFactors = skyAtmosphereFactors(ticksNight);
    expect(
      computeGodRaysState({
        enabled: true,
        dimension: 'overworld',
        underwater: false,
        sunDir: nightSun,
        dayFactor: nightFactors.dayFactor,
        twilightFactor: nightFactors.twilightFactor,
        rainFactor: 0,
        viewMatrix: camera.viewMatrix,
        projectionMatrix: camera.projectionMatrix,
      }).enabled,
    ).toBe(false);

    // Off when toggle disabled
    expect(
      computeGodRaysState({
        enabled: false,
        dimension: 'overworld',
        underwater: false,
        sunDir: sun,
        dayFactor,
        twilightFactor,
        rainFactor: 0,
        viewMatrix: camera.viewMatrix,
        projectionMatrix: camera.projectionMatrix,
      }).enabled,
    ).toBe(false);

    // Rain attenuates intensity compared to clear sky
    const rainy = computeGodRaysState({
      enabled: true,
      dimension: 'overworld',
      underwater: false,
      sunDir: sun,
      dayFactor,
      twilightFactor,
      rainFactor: 1,
      viewMatrix: camera.viewMatrix,
      projectionMatrix: camera.projectionMatrix,
    });
    expect(rainy.enabled).toBe(true);
    expect(rainy.intensity).toBeLessThan(centered.intensity);
  });

  it('orders post-processing passes as bloom -> godRays -> fxaa', () => {
    expect(getActivePostFxPasses({ bloom: false, godRays: false, fxaa: false })).toEqual([]);
    expect(getActivePostFxPasses({ bloom: false, godRays: false, fxaa: true })).toEqual(['fxaa']);
    expect(getActivePostFxPasses({ bloom: true, godRays: false, fxaa: true })).toEqual([
      'bloom',
      'fxaa',
    ]);
    expect(getActivePostFxPasses({ bloom: true, godRays: true, fxaa: true })).toEqual([
      'bloom',
      'godRays',
      'fxaa',
    ]);

    const scratch: PostFxPassName[] = [];
    fillActivePostFxPasses({ bloom: false, godRays: true, fxaa: true }, scratch);
    expect(scratch).toEqual(['godRays', 'fxaa']);
    fillActivePostFxPasses({ bloom: false, godRays: false, fxaa: false }, scratch);
    expect(scratch).toEqual([]);
  });
});

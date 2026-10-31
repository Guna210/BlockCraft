import { test, expect } from '../harness/fixture';

test('M20b: Hollowdeep blocks load in the renderer and Glowcap emits tinted level-9 light', async ({
  page,
  getRenderStats,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      type: 'flat',
      seed: 'm20b-blocks',
      mode: 'creative',
      structures: false,
      spawning: false,
    });
    api.pause!();
    api.fill!(3, 25, 3, 12, 30, 12, 'air');
    const names = [
      'duskrock',
      'driftstone',
      'glowcap_stem',
      'glowcap',
      'glowcap_gills',
      'veilroot',
      'voidglass',
      'emberite',
    ];
    for (let i = 0; i < names.length; i++) api.setBlock!(4 + i, 26, 4, names[i]!);
    api.teleport!(8, 26, 10, -Math.PI / 2, 0);
    await api.waitForTerrain!(1);
    return {
      blocks: names.map((_, i) => api.getBlock!(4 + i, 26, 4).id),
      light: api.getLight!(7, 26, 4),
      rgb: api.getBlockLightRGB!(7, 26, 4),
    };
  });
  expect(result.blocks).toEqual([
    'duskrock',
    'driftstone',
    'glowcap_stem',
    'glowcap',
    'glowcap_gills',
    'veilroot',
    'voidglass',
    'emberite',
  ]);
  expect(result.light.block).toBe(9);
  expect(result.rgb.g).toBeGreaterThan(result.rgb.r);
  expect(result.rgb.g).toBeGreaterThan(result.rgb.b);
  expect((await getRenderStats()).missingTextures).toEqual([]);
});

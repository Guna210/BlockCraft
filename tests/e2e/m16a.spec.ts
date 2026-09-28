import { test, expect } from '../harness/fixture';
import fs from 'fs';
import path from 'path';

test.describe('M16a: Synthesis library', () => {
  test('generates all expected sounds with correct RMS and peak levels', async ({ page }) => {
    // Required IDs as per spec and prompt
    const expectedIds = [
      'footstep.grass',
      'footstep.stone',
      'footstep.sand',
      'footstep.wood',
      'footstep.gravel',
      'footstep.snow',
      'footstep.water',
      'break.grass',
      'break.stone',
      'break.sand',
      'break.wood',
      'break.gravel',
      'break.snow',
      'break.glass',
      'break.foliage',
      'place.grass',
      'place.stone',
      'place.sand',
      'place.wood',
      'place.gravel',
      'place.snow',
      'place.glass',
      'place.foliage',
      'item.pickup',
      'item.eat',
      'mechanism.kiln_crackle',
      'mechanism.piston',
      'mechanism.button',
      'mechanism.lever',
      'weapon.bow_draw',
      'weapon.bow_release',
      'weapon.arrow_hit',
      'player.hurt',
      'player.death',
      'entity.explosion',
      'weather.rain',
      'weather.thunder',
      'ambience.fluid',
    ];

    const creatures = [
      'tuftbuck',
      'rootboar',
      'dapplefowl',
      'mossback',
      'glimmer_moth',
      'hollow',
      'thornling',
      'skitterer',
      'sporeburst',
      'glowwing',
      'magmaw',
    ];

    for (const c of creatures) {
      expectedIds.push(`creature.${c}.idle`);
      expectedIds.push(`creature.${c}.hurt`);
      expectedIds.push(`creature.${c}.death`);
    }

    await page.goto('/?debug=1');

    // Check that all required sounds exist
    const allIds = await page.evaluate(() => window.__blockcraft!.audio!.getAllSoundIds());

    for (const id of expectedIds) {
      expect(allIds).toContain(id);
    }

    // Evaluate sounds
    const results = [];

    for (const id of expectedIds) {
      const r1 = await page.evaluate(async (soundId) => {
        return await window.__blockcraft!.audio!.renderOffline(soundId, 42);
      }, id);

      const r2 = await page.evaluate(async (soundId) => {
        return await window.__blockcraft!.audio!.renderOffline(soundId, 42);
      }, id);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();

      // Determinism
      expect(r1!.rms).toBeCloseTo(r2!.rms, 5);
      expect(r1!.peak).toBeCloseTo(r2!.peak, 5);

      // Logging
      console.log(`${id}: RMS=${r1!.rms}, Peak=${r1!.peak}`);
      // RMS > 0.01 and peak < 1.0
      expect(r1!.rms, `Sound ${id} RMS is too low`).toBeGreaterThan(0.01);
      expect(r1!.peak, `Sound ${id} Peak is too high`).toBeLessThan(1.0);

      results.push(r1);
    }

    // Write markdown table
    let md = '| Sound ID | Length (samples) | RMS | Peak |\n';
    md += '|---|---|---|---|\n';
    for (const r of results) {
      md += `| ${r!.id} | ${r!.lengthSamples} | ${r!.rms.toFixed(4)} | ${r!.peak.toFixed(4)} |\n`;
    }

    const artifactsDir = path.join(process.cwd(), 'artifacts');
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(artifactsDir, 'm16a-table.md'), md);
  });
});

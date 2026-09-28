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
    const seenHashes = new Set<string>();

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
      expect(r1!.peak, `Sound ${id} Peak is too high`).toBeLessThan(0.8);

      const soundHash = `${r1!.rms.toFixed(6)}_${r1!.peak.toFixed(6)}`;
      expect(seenHashes.has(soundHash), `Sound ${id} is identical to another sound`).toBe(false);
      seenHashes.add(soundHash);

      results.push(r1);
    }

    // Write wavs
    const m16Dir = path.join(process.cwd(), 'artifacts', 'm16');
    if (!fs.existsSync(m16Dir)) {
      fs.mkdirSync(m16Dir, { recursive: true });
    }

    for (const r of results) {
      if (!r) continue;
      const numChannels = r.channels.length;
      const sampleRate = r.sampleRate;
      const numSamples = r.lengthSamples;

      const buffer = new ArrayBuffer(44 + numSamples * numChannels * 2);
      const view = new DataView(buffer);

      // RIFF chunk descriptor
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + numSamples * numChannels * 2, true);
      writeString(view, 8, 'WAVE');

      // fmt sub-chunk
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true); // subchunk1size (16 for PCM)
      view.setUint16(20, 1, true); // audio format (1 = PCM)
      view.setUint16(22, numChannels, true); // num channels
      view.setUint32(24, sampleRate, true); // sample rate
      view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
      view.setUint16(32, numChannels * 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample

      // data sub-chunk
      writeString(view, 36, 'data');
      view.setUint32(40, numSamples * numChannels * 2, true);

      let offset = 44;
      for (let i = 0; i < numSamples; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
          const sample = r.channels[channel]?.[i] ?? 0;
          const s = Math.max(-1, Math.min(1, sample));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          offset += 2;
        }
      }

      fs.writeFileSync(path.join(m16Dir, `${r.id}.wav`), Buffer.from(buffer));
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

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

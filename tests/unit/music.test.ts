import { describe, it, expect } from 'vitest';
import { BIOME_IDS, getMood } from '../../src/audio/music/moods.js';
import { composeSequence, getScalePitches } from '../../src/audio/music/composer.js';

describe('Music Moods', () => {
  it('assigns every biome and sub-biome a distinct scale pitch-class set', () => {
    const pitchClassSets = new Map<string, string>();

    for (const biome of BIOME_IDS) {
      const mood = getMood(biome);
      const pcs = getScalePitches(mood)
        .sort((a, b) => a - b)
        .join(',');

      if (pitchClassSets.has(pcs)) {
        throw new Error(
          `Biome ${biome} shares pitch-class set ${pcs} with ${pitchClassSets.get(pcs)}`,
        );
      }
      pitchClassSets.set(pcs, biome);
    }

    // Assert we tested all biomes (plus dimensions)
    expect(pitchClassSets.size).toBe(BIOME_IDS.length);
  });

  it('provides a mood for every ID in the list', () => {
    for (const biome of BIOME_IDS) {
      const mood = getMood(biome);
      expect(mood).toBeDefined();
      expect(mood.scale).toBeDefined();
      expect(typeof mood.tempo).toBe('number');
      expect(typeof mood.register).toBe('number');
      expect(typeof mood.density).toBe('number');
    }
  });

  it('falls back to dimension mood for unknown IDs', () => {
    const overworldFallback = getMood('unknown_plains_variant');
    const overworldMood = getMood('overworld');
    expect(overworldFallback).toEqual(overworldMood);

    const hollowdeepFallback = getMood('hollowdeep_mystery_cave');
    const hollowdeepMood = getMood('hollowdeep');
    expect(hollowdeepFallback).toEqual(hollowdeepMood);

    const anotherHollowdeepFallback = getMood('unknown_magma_pool');
    expect(anotherHollowdeepFallback).toEqual(hollowdeepMood);
  });
});

describe('Music Composer', () => {
  it('generates identical sequences for the same seed and context, no state bleed', () => {
    const seq1 = composeSequence('seed-A', 'plains');

    // Generate some unrelated sequence in between to test state bleed
    composeSequence('seed-B', 'desert');

    const seq2 = composeSequence('seed-A', 'plains');

    expect(seq1).toEqual(seq2);
  });

  it('generates different sequences for different seeds', () => {
    const seq1 = composeSequence('seed-A', 'plains');
    const seq2 = composeSequence('seed-B', 'plains');

    // They should not be deeply equal
    expect(seq1).not.toEqual(seq2);
  });

  it('ensures every note of a biome sequence belongs to that biome scale', () => {
    for (const biome of ['plains', 'desert', 'rainforest', 'hollowdeep']) {
      const seq = composeSequence('test-seed', biome);
      const mood = getMood(biome);
      const scalePcs = new Set(getScalePitches(mood));

      for (const event of seq.events) {
        const pc = event.pitch % 12;
        expect(scalePcs.has(pc)).toBe(true);
      }
    }
  });

  it('passes sanity checks on generated events', () => {
    const seq = composeSequence('test-sanity', 'meadow');

    expect(seq.events.length).toBeGreaterThan(0);
    expect(seq.tempo).toBeGreaterThan(0);

    for (const event of seq.events) {
      expect(Number.isFinite(event.startTime)).toBe(true);
      expect(event.startTime).toBeGreaterThanOrEqual(0);

      expect(Number.isFinite(event.durationInBeats)).toBe(true);
      expect(event.durationInBeats).toBeGreaterThan(0);

      expect(Number.isInteger(event.pitch)).toBe(true);
      expect(event.pitch).toBeGreaterThanOrEqual(0);
      expect(event.pitch).toBeLessThanOrEqual(127); // Standard MIDI range

      expect(Number.isFinite(event.velocity)).toBe(true);
      expect(event.velocity).toBeGreaterThanOrEqual(0);
      expect(event.velocity).toBeLessThanOrEqual(1);

      expect(['piano', 'pad']).toContain(event.voice);
    }
  });
});

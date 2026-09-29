import { PRNG, hashString, deriveSeed } from '../../engine/rng.js';
import { getMood, Mood } from './moods.js';

export interface NoteEvent {
  startTime: number;
  durationInBeats: number;
  pitch: number;
  velocity: number;
  voice: 'piano' | 'pad';
}

export interface CompositionSequence {
  tempo: number;
  events: NoteEvent[];
}

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  minor_pentatonic: [0, 3, 5, 7, 10],
  phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],
};

// Markov chains for diatonic chord progressions (based on scale degrees, 0-indexed)
const MARKOV_TRANSITIONS: Record<string, Record<number, { next: number; weight: number }[]>> = {
  major: {
    0: [
      { next: 3, weight: 1 },
      { next: 4, weight: 1 },
      { next: 5, weight: 1 },
    ],
    1: [
      { next: 4, weight: 1 },
      { next: 6, weight: 1 },
    ],
    2: [{ next: 5, weight: 1 }],
    3: [
      { next: 4, weight: 1 },
      { next: 0, weight: 1 },
    ],
    4: [
      { next: 0, weight: 2 },
      { next: 5, weight: 1 },
    ],
    5: [
      { next: 1, weight: 1 },
      { next: 3, weight: 1 },
      { next: 4, weight: 1 },
    ],
    6: [
      { next: 0, weight: 1 },
      { next: 2, weight: 1 },
    ],
  },
  harmonic_minor: {
    0: [
      { next: 3, weight: 1 },
      { next: 4, weight: 2 },
      { next: 5, weight: 1 },
    ],
    1: [
      { next: 4, weight: 1 },
      { next: 6, weight: 1 },
    ],
    2: [{ next: 5, weight: 1 }],
    3: [
      { next: 4, weight: 1 },
      { next: 0, weight: 1 },
    ],
    4: [
      { next: 0, weight: 2 },
      { next: 5, weight: 1 },
    ],
    5: [
      { next: 1, weight: 1 },
      { next: 3, weight: 1 },
      { next: 4, weight: 1 },
    ],
    6: [{ next: 0, weight: 1 }],
  },
  minor_pentatonic: {
    // Only 5 degrees
    0: [
      { next: 1, weight: 1 },
      { next: 2, weight: 1 },
      { next: 3, weight: 1 },
      { next: 4, weight: 1 },
    ],
    1: [
      { next: 2, weight: 1 },
      { next: 3, weight: 1 },
    ],
    2: [
      { next: 0, weight: 1 },
      { next: 4, weight: 1 },
    ],
    3: [
      { next: 0, weight: 1 },
      { next: 4, weight: 1 },
    ],
    4: [
      { next: 0, weight: 2 },
      { next: 2, weight: 1 },
    ],
  },
  phrygian_dominant: {
    0: [
      { next: 1, weight: 2 },
      { next: 3, weight: 1 },
      { next: 4, weight: 1 },
    ],
    1: [
      { next: 0, weight: 2 },
      { next: 2, weight: 1 },
    ],
    2: [
      { next: 0, weight: 1 },
      { next: 3, weight: 1 },
    ],
    3: [
      { next: 0, weight: 1 },
      { next: 4, weight: 1 },
    ],
    4: [
      { next: 0, weight: 2 },
      { next: 1, weight: 1 },
    ],
    5: [
      { next: 1, weight: 1 },
      { next: 4, weight: 1 },
    ],
    6: [{ next: 0, weight: 1 }],
  },
};

function getNextDegree(mode: string, currentDegree: number, prng: PRNG): number {
  const transitions = MARKOV_TRANSITIONS[mode] || MARKOV_TRANSITIONS['major'];
  if (!transitions) return 0;
  const options = transitions[currentDegree] || [{ next: 0, weight: 1 }];

  let totalWeight = 0;
  for (const opt of options) {
    totalWeight += opt.weight;
  }

  let r = prng.next() * totalWeight;
  for (const opt of options) {
    if (r < opt.weight) return opt.next;
    r -= opt.weight;
  }

  return options[0]?.next ?? 0;
}

export function getScalePitches(mood: Mood): number[] {
  const intervals = MODES[mood.scale.mode as keyof typeof MODES] || MODES.major;
  if (!intervals) return [];
  return intervals.map((i) => mood.scale.root + i);
}

export function composeSequence(seedStr: string, contextId: string): CompositionSequence {
  const seed = hashString(seedStr);
  const contextSeed = deriveSeed(seed, contextId);
  const prng = new PRNG(contextSeed);

  const mood = getMood(contextId);
  const scale = getScalePitches(mood);
  const mode = mood.scale.mode;
  const numDegrees = scale.length;

  const events: NoteEvent[] = [];
  let currentDegree = 0; // Start on tonic
  let currentTime = 0;

  // Generate a sequence of 16 bars (4 beats per bar)
  const totalBeats = 16 * 4;

  while (currentTime < totalBeats) {
    const chordDuration = 4; // 4 beats per chord

    // Determine chord notes (triad: root, third, fifth relative to scale degree)
    // Wrap around intervals by adding 12 when index goes out of bounds
    const chordPitches = [
      scale[currentDegree] ?? scale[0] ?? 0,
      currentDegree + 2 >= numDegrees
        ? (scale[(currentDegree + 2) % numDegrees] ?? 0) + 12
        : (scale[currentDegree + 2] ?? 0),
      currentDegree + 4 >= numDegrees
        ? (scale[(currentDegree + 4) % numDegrees] ?? 0) + 12
        : (scale[currentDegree + 4] ?? 0),
    ];

    // Add pad notes
    for (const pitchVal of chordPitches) {
      // Pad plays in a lower octave
      const padPitch = mood.register - 12 + pitchVal;
      events.push({
        startTime: currentTime,
        durationInBeats: chordDuration,
        pitch: padPitch,
        velocity: 0.5 + prng.next() * 0.2, // 0.5 - 0.7
        voice: 'pad',
      });
    }

    // Generate melody notes over this chord
    let beatInChord = 0;
    while (beatInChord < chordDuration) {
      // Determine note length (1, 0.5, 0.25)
      const r = prng.next();
      let noteLen = 1;
      if (r < 0.3) noteLen = 0.5;
      else if (r < 0.4) noteLen = 0.25;
      else if (r < 0.6) noteLen = 2;

      // Ensure we don't exceed chord duration
      if (beatInChord + noteLen > chordDuration) {
        noteLen = chordDuration - beatInChord;
      }

      // Decide if we play a note based on density
      if (prng.next() < mood.density) {
        // Pick a note from the scale, weighted towards chord tones
        const isChordTone = prng.next() < 0.7;
        let pitchVal = scale[0] ?? 0;
        if (isChordTone) {
          pitchVal = chordPitches[Math.floor(prng.next() * chordPitches.length)] ?? pitchVal;
        } else {
          pitchVal = scale[Math.floor(prng.next() * scale.length)] ?? pitchVal;
        }

        // Pick an octave offset
        const octaveOffset = (Math.floor(prng.next() * 3) - 1) * 12; // -12, 0, 12
        const melodyPitch = mood.register + 12 + pitchVal + octaveOffset;

        events.push({
          startTime: currentTime + beatInChord,
          durationInBeats: noteLen * 0.9, // slightly legato/staccato
          pitch: melodyPitch,
          velocity: 0.6 + prng.next() * 0.3, // 0.6 - 0.9
          voice: 'piano',
        });
      }

      beatInChord += noteLen;
    }

    currentDegree = getNextDegree(mode, currentDegree, prng);
    currentTime += chordDuration;
  }

  return {
    tempo: mood.tempo,
    events,
  };
}

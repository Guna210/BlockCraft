import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

function createCreatureVoice(
  duration: number,
  baseFreq: number,
  oscType: OscillatorType,
  pitchBend: number = 1.0,
  noiseType?: BiquadFilterType,
  peak: number = 0.5,
): SoundRecipe {
  return {
    duration,
    render: (ctx: SoundRecipeContext) => {
      const { ctx: audioCtx, t0 } = ctx;

      const osc = audioCtx.createOscillator();
      osc.type = oscType;
      osc.frequency.setValueAtTime(baseFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * pitchBend, t0 + duration * 0.8);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, duration, peak, duration * 0.1);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration);

      if (noiseType) {
        SynthesisEngine.playNoise(ctx, duration, noiseType, baseFreq * 2, peak * 0.3);
      }
    },
  };
}

const creaturesList = [
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

export const creatures: Record<string, SoundRecipe> = {};

creaturesList.forEach((c) => {
  // Simple unique parameters per creature based on string hash for determinism
  let hash = 0;
  for (let i = 0; i < c.length; i++) hash = c.charCodeAt(i) + ((hash << 5) - hash);
  const baseFreq = 100 + (Math.abs(hash) % 500); // 100 to 600 Hz
  const type = ['sine', 'square', 'sawtooth', 'triangle'][Math.abs(hash) % 4] as OscillatorType;

  creatures[`creature.${c}.idle`] = createCreatureVoice(0.4, baseFreq, type, 1.2, 'lowpass', 0.4);
  creatures[`creature.${c}.hurt`] = createCreatureVoice(
    0.3,
    baseFreq * 1.5,
    type,
    0.8,
    'bandpass',
    0.6,
  );
  creatures[`creature.${c}.death`] = createCreatureVoice(
    0.6,
    baseFreq * 0.8,
    type,
    0.5,
    'highpass',
    0.7,
  );
});

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

export const creatures: Record<string, SoundRecipe> = {
  // Tuftbuck: bleats (sawtooth, ~300Hz, quick bend up and down)
  'creature.tuftbuck.idle': createCreatureVoice(0.4, 300, 'sawtooth', 1.2, 'lowpass', 0.4),
  'creature.tuftbuck.hurt': createCreatureVoice(0.3, 400, 'sawtooth', 0.8, 'bandpass', 0.6),
  'creature.tuftbuck.death': createCreatureVoice(0.6, 250, 'sawtooth', 0.5, 'highpass', 0.6),

  // Rootboar: low grunts (square, ~80Hz, drops pitch)
  'creature.rootboar.idle': createCreatureVoice(0.5, 80, 'square', 0.8, 'lowpass', 0.4),
  'creature.rootboar.hurt': createCreatureVoice(0.4, 120, 'square', 1.2, 'bandpass', 0.6),
  'creature.rootboar.death': createCreatureVoice(0.8, 70, 'square', 0.5, 'lowpass', 0.6),

  // Dapplefowl: clucks and squawks (triangle, ~500Hz)
  'creature.dapplefowl.idle': createCreatureVoice(0.2, 500, 'triangle', 1.5, 'highpass', 0.3),
  'creature.dapplefowl.hurt': createCreatureVoice(0.3, 700, 'triangle', 0.8, 'bandpass', 0.5),
  'creature.dapplefowl.death': createCreatureVoice(0.5, 400, 'triangle', 0.5, 'lowpass', 0.5),

  // Mossback: very slow, deep, resonant groans (sine, ~60Hz)
  'creature.mossback.idle': createCreatureVoice(1.0, 60, 'sine', 1.1, 'lowpass', 0.3),
  'creature.mossback.hurt': createCreatureVoice(0.6, 100, 'sine', 0.9, 'bandpass', 0.5),
  'creature.mossback.death': createCreatureVoice(1.5, 50, 'sine', 0.6, 'lowpass', 0.5),

  // Glimmer Moth: tiny, high-pitched chirps (sine, ~2000Hz)
  'creature.glimmer_moth.idle': createCreatureVoice(0.15, 2000, 'sine', 1.1, 'highpass', 0.4),
  'creature.glimmer_moth.hurt': createCreatureVoice(0.2, 2500, 'sine', 0.9, 'highpass', 0.5),
  'creature.glimmer_moth.death': createCreatureVoice(0.4, 1500, 'sine', 0.5, 'highpass', 0.5),

  // Hollow: raspy, airy breathing (heavy noise, sawtooth base, ~150Hz)
  'creature.hollow.idle': createCreatureVoice(0.8, 150, 'sawtooth', 0.9, 'bandpass', 0.3),
  'creature.hollow.hurt': createCreatureVoice(0.5, 200, 'sawtooth', 1.2, 'highpass', 0.5),
  'creature.hollow.death': createCreatureVoice(1.2, 100, 'sawtooth', 0.5, 'lowpass', 0.6),

  // Thornling: woody creaks and sharp clicks (square, ~300Hz, quick drops)
  'creature.thornling.idle': createCreatureVoice(0.3, 300, 'square', 0.5, 'highpass', 0.4),
  'creature.thornling.hurt': createCreatureVoice(0.2, 450, 'square', 0.4, 'bandpass', 0.6),
  'creature.thornling.death': createCreatureVoice(0.7, 200, 'square', 0.2, 'lowpass', 0.6),

  // Skitterer: fast chittering (triangle, ~1200Hz)
  'creature.skitterer.idle': createCreatureVoice(0.15, 1200, 'triangle', 1.3, 'highpass', 0.2),
  'creature.skitterer.hurt': createCreatureVoice(0.2, 1600, 'triangle', 0.8, 'highpass', 0.4),
  'creature.skitterer.death': createCreatureVoice(0.5, 800, 'triangle', 0.5, 'bandpass', 0.5),

  // Sporeburst: squishy, bubbly swelling sounds (sine, ~150Hz, pitch rises)
  'creature.sporeburst.idle': createCreatureVoice(0.6, 150, 'sine', 1.5, 'lowpass', 0.3),
  'creature.sporeburst.hurt': createCreatureVoice(0.4, 250, 'sine', 0.7, 'bandpass', 0.5),
  'creature.sporeburst.death': createCreatureVoice(1.0, 100, 'sine', 0.2, 'lowpass', 0.6),

  // Glowwing: ethereal, sweeping hums (sine, ~600Hz)
  'creature.glowwing.idle': createCreatureVoice(1.2, 600, 'sine', 1.1, 'bandpass', 0.3),
  'creature.glowwing.hurt': createCreatureVoice(0.8, 800, 'sine', 0.8, 'bandpass', 0.5),
  'creature.glowwing.death': createCreatureVoice(1.5, 400, 'sine', 0.6, 'lowpass', 0.5),

  // Magmaw: bubbling, resonant bass (square, ~50Hz)
  'creature.magmaw.idle': createCreatureVoice(0.9, 50, 'square', 1.05, 'lowpass', 0.4),
  'creature.magmaw.hurt': createCreatureVoice(0.6, 90, 'square', 1.2, 'bandpass', 0.6),
  'creature.magmaw.death': createCreatureVoice(1.4, 30, 'square', 0.7, 'lowpass', 0.6),
};

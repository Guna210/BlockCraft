import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

function createBlockSound(
  duration: number,
  baseFreq: number,
  noiseType: BiquadFilterType,
  noiseFreq: number,
  peak: number = 0.8,
): SoundRecipe {
  return {
    duration,
    render: (ctx: SoundRecipeContext) => {
      // Impact
      SynthesisEngine.playOscillator(ctx, 'sine', baseFreq, duration * 0.5, peak * 0.6, 0.005);
      // Crunch
      SynthesisEngine.playNoise(ctx, duration, noiseType, noiseFreq, peak);
    },
  };
}

export const blocks: Record<string, SoundRecipe> = {
  // Break sounds
  'break.grass': createBlockSound(0.2, 50, 'lowpass', 1000, 0.5),
  'break.stone': createBlockSound(0.15, 80, 'bandpass', 3000, 0.7),
  'break.sand': createBlockSound(0.3, 40, 'lowpass', 1500, 0.5),
  'break.wood': createBlockSound(0.25, 70, 'lowpass', 1500, 0.6),
  'break.gravel': createBlockSound(0.25, 60, 'bandpass', 4000, 0.6),
  'break.snow': createBlockSound(0.3, 30, 'lowpass', 1200, 0.6),
  'break.glass': createBlockSound(0.2, 1000, 'highpass', 5000, 0.4),
  'break.foliage': createBlockSound(0.2, 40, 'lowpass', 800, 0.7),

  // Place sounds (typically shorter and slightly quieter)
  'place.grass': createBlockSound(0.15, 50, 'lowpass', 800, 0.7),
  'place.stone': createBlockSound(0.1, 80, 'bandpass', 2000, 0.8),
  'place.sand': createBlockSound(0.2, 40, 'lowpass', 1200, 0.7),
  'place.wood': createBlockSound(0.15, 70, 'lowpass', 1200, 0.8),
  'place.gravel': createBlockSound(0.15, 60, 'bandpass', 3000, 0.7),
  'place.snow': createBlockSound(0.2, 30, 'lowpass', 1000, 0.7),
  'place.glass': createBlockSound(0.1, 800, 'highpass', 4000, 0.5),
  'place.foliage': createBlockSound(0.15, 40, 'lowpass', 700, 0.7),
};

import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

function createFootstep(
  duration: number,
  baseFreq: number,
  noiseType: BiquadFilterType,
  noiseFreq: number,
  peak: number = 0.5,
): SoundRecipe {
  return {
    duration,
    render: (ctx: SoundRecipeContext) => {
      // Small thud
      SynthesisEngine.playOscillator(ctx, 'sine', baseFreq, duration * 0.8, peak * 0.3, 0.005);
      // Surface noise
      SynthesisEngine.playNoise(ctx, duration, noiseType, noiseFreq, peak);
    },
  };
}

export const footsteps: Record<string, SoundRecipe> = {
  'footstep.grass': createFootstep(0.15, 60, 'lowpass', 800, 0.7),
  'footstep.stone': createFootstep(0.12, 100, 'bandpass', 2000, 0.8),
  'footstep.sand': createFootstep(0.2, 50, 'lowpass', 1500, 0.7),
  'footstep.wood': createFootstep(0.18, 80, 'lowpass', 1200, 0.8),
  'footstep.gravel': createFootstep(0.18, 70, 'bandpass', 3000, 0.9),
  'footstep.snow': createFootstep(0.2, 40, 'lowpass', 1000, 0.8),
  'footstep.water': createFootstep(0.25, 40, 'lowpass', 600, 0.7),
};

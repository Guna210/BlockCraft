import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

export const entities: Record<string, SoundRecipe> = {
  'player.hurt': {
    duration: 0.25,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playOscillator(ctx, 'sawtooth', 150, 0.2, 0.5, 0.01);

      const { ctx: audioCtx, t0 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, t0);
      osc.frequency.exponentialRampToValueAtTime(100, t0 + 0.2);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.2, 0.6, 0.01);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    },
  },
  'player.death': {
    duration: 1.0,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playNoise(ctx, 0.8, 'lowpass', 1000, 0.5);

      const { ctx: audioCtx, t0 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.8);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.8, 0.7, 0.05);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.8);
    },
  },
  'entity.explosion': {
    duration: 1.5,
    render: (ctx: SoundRecipeContext) => {
      // Big boom noise
      SynthesisEngine.playNoise(ctx, 1.2, 'lowpass', 800, 0.9);

      const { ctx: audioCtx, t0 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(80, t0);
      osc.frequency.exponentialRampToValueAtTime(20, t0 + 1.0);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 1.0, 0.8, 0.02);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.0);
    },
  },
};

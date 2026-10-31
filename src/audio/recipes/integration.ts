import { SynthesisEngine, type SoundRecipe } from '../engine';

export const integration: Record<string, SoundRecipe> = {
  'ambience.cave': {
    duration: 0.8,
    render: (ctx) => {
      SynthesisEngine.playNoiseWithReverb(ctx, 0.35, 0.8, 'lowpass', 520, 0.12, 220);
      SynthesisEngine.playOscillator(ctx, 'sine', 88, 0.5, 0.08, 0.04);
    },
  },
  'mechanism.note': {
    duration: 0.55,
    render: (ctx) => {
      const { ctx: audioCtx, t0, pitch = 1 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440 * pitch, t0);
      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.5, 0.22, 0.008);
      osc.connect(gain);
      gain.connect(ctx.output ?? audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    },
  },
};

import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

export const items: Record<string, SoundRecipe> = {
  'item.pickup': {
    duration: 0.2,
    render: (ctx: SoundRecipeContext) => {
      // Small pop
      SynthesisEngine.playOscillator(ctx, 'sine', 600, 0.05, 0.2, 0.005);
      SynthesisEngine.playOscillator(ctx, 'sine', 800, 0.05, 0.2, 0.005);

      const { ctx: audioCtx, t0 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t0);
      osc.frequency.exponentialRampToValueAtTime(1200, t0 + 0.1);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.1, 0.2, 0.01);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    },
  },
  'item.eat': {
    duration: 0.3,
    render: (ctx: SoundRecipeContext) => {
      // Munch sounds
      SynthesisEngine.playNoise(ctx, 0.1, 'bandpass', 2000, 0.6);
      SynthesisEngine.playOscillator(ctx, 'sine', 200, 0.1, 0.3, 0.01);

      // Delay second munch
      const { ctx: audioCtx, t0, random } = ctx;
      const t1 = t0 + 0.15;

      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.ceil(audioCtx.sampleRate * 0.1),
        audioCtx.sampleRate,
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random.nextFloat(-1, 1);

      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2500;
      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t1, 0.1, 0.5, 0.01);

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noiseSource.start(t1);
      noiseSource.stop(t1 + 0.1);
    },
  },
};

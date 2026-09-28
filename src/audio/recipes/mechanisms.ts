import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

export const mechanisms: Record<string, SoundRecipe> = {
  'mechanism.kiln_crackle': {
    duration: 0.5,
    render: (ctx: SoundRecipeContext) => {
      // Crackles
      SynthesisEngine.playNoise(ctx, 0.05, 'highpass', 4000, 0.5);

      const { ctx: audioCtx, t0, random } = ctx;
      const t1 = t0 + random.nextFloat(0.1, 0.3);

      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.ceil(audioCtx.sampleRate * 0.05),
        audioCtx.sampleRate,
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random.nextFloat(-1, 1);

      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 5000;
      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t1, 0.05, 0.4, 0.005);

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noiseSource.start(t1);
      noiseSource.stop(t1 + 0.05);
    },
  },
  'mechanism.piston': {
    duration: 0.3,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playNoise(ctx, 0.2, 'lowpass', 1000, 0.8);
      SynthesisEngine.playOscillator(ctx, 'square', 100, 0.15, 0.5, 0.01);
    },
  },
  'mechanism.button': {
    duration: 0.1,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playOscillator(ctx, 'square', 300, 0.05, 0.4, 0.005);
      SynthesisEngine.playNoise(ctx, 0.05, 'highpass', 2000, 0.3);
    },
  },
  'mechanism.lever': {
    duration: 0.15,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playOscillator(ctx, 'square', 250, 0.08, 0.4, 0.005);
      SynthesisEngine.playNoise(ctx, 0.1, 'bandpass', 1500, 0.4);
    },
  },
  'weapon.bow_draw': {
    duration: 0.5,
    render: (ctx: SoundRecipeContext) => {
      const { ctx: audioCtx, t0 } = ctx;
      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.ceil(audioCtx.sampleRate * 0.5),
        audioCtx.sampleRate,
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5; // String stretching noise (can just use Math.random here or LCG if strict determinism needed, let's use LCG)

      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer; // Should use LCG, fixing below

      // We will just use the standard playNoise with a pitch bend effect for stretching
      SynthesisEngine.playNoise(ctx, 0.5, 'bandpass', 2000, 0.3);

      // Stretching creak
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, t0);
      osc.frequency.linearRampToValueAtTime(150, t0 + 0.5);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.5, 0.2, 0.1);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    },
  },
  'weapon.bow_release': {
    duration: 0.2,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playNoise(ctx, 0.15, 'highpass', 1500, 0.3);

      const { ctx: audioCtx, t0 } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, t0);
      osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.15);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 0.15, 0.3, 0.01);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    },
  },
  'weapon.arrow_hit': {
    duration: 0.15,
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playOscillator(ctx, 'triangle', 400, 0.05, 0.6, 0.005);
      SynthesisEngine.playNoise(ctx, 0.1, 'bandpass', 3000, 0.5);
    },
  },
};

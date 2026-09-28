import { SoundRecipe, SoundRecipeContext, SynthesisEngine } from '../engine';

export const weather: Record<string, SoundRecipe> = {
  'weather.rain': {
    duration: 2.0, // Ambient loops can be long
    render: (ctx: SoundRecipeContext) => {
      SynthesisEngine.playNoise(ctx, 2.0, 'bandpass', 1200, 0.3);
    },
  },
  'weather.thunder': {
    duration: 4.0,
    render: (ctx: SoundRecipeContext) => {
      // Crackle
      SynthesisEngine.playNoise(ctx, 0.5, 'highpass', 3000, 0.4);

      // Rumble
      const { ctx: audioCtx, t0, random } = ctx;

      const rumbleDur = 3.5;
      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.ceil(audioCtx.sampleRate * rumbleDur),
        audioCtx.sampleRate,
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random.nextFloat(-1, 1);

      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, t0);
      filter.frequency.linearRampToValueAtTime(100, t0 + rumbleDur);

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, rumbleDur, 0.2, 0.1);

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noiseSource.start(t0);
      noiseSource.stop(t0 + rumbleDur);
    },
  },
  'ambience.fluid': {
    duration: 2.0,
    render: (ctx: SoundRecipeContext) => {
      // Soft bubbling
      const { ctx: audioCtx, t0, random } = ctx;
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';

      // Modulate frequency slightly
      osc.frequency.setValueAtTime(200, t0);
      for (let i = 1; i < 10; i++) {
        osc.frequency.linearRampToValueAtTime(200 + random.nextFloat(-50, 50), t0 + i * 0.2);
      }

      const gain = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(gain.gain, t0, 2.0, 0.2, 0.5);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 2.0);

      SynthesisEngine.playNoise(ctx, 2.0, 'lowpass', 600, 0.1);
    },
  },
};

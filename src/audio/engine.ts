import { LCG, createNoiseBuffer } from './math';

export interface SoundRecipeContext {
  ctx: BaseAudioContext;
  t0: number;
  random: LCG;
}

export interface SoundRecipe {
  duration: number;
  render: (ctx: SoundRecipeContext) => void;
}

export class SynthesisEngine {
  static applySimpleEnvelope(
    param: AudioParam,
    t0: number,
    duration: number,
    peak = 1,
    attack = 0.01,
  ) {
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(peak, t0 + attack);
    param.exponentialRampToValueAtTime(0.001, t0 + duration);
  }

  static playNoise(
    ctx: SoundRecipeContext,
    duration: number,
    filterType: BiquadFilterType = 'lowpass',
    frequency = 1000,
    peakLevel = 1,
  ) {
    const { ctx: audioCtx, t0, random } = ctx;
    const noiseBuffer = createNoiseBuffer(audioCtx, duration, random);
    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;

    const gain = audioCtx.createGain();
    SynthesisEngine.applySimpleEnvelope(gain.gain, t0, duration, peakLevel, 0.01);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    noiseSource.start(t0);
    noiseSource.stop(t0 + duration);
  }

  static playNoiseWithReverb(
    ctx: SoundRecipeContext,
    duration: number,
    reverbDuration: number,
    filterType: BiquadFilterType = 'lowpass',
    frequency = 1000,
    peakLevel = 1,
    endFrequency?: number,
  ) {
    const { ctx: audioCtx, t0, random } = ctx;
    const noiseBuffer = createNoiseBuffer(audioCtx, Math.max(duration, reverbDuration), random);
    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, t0);
    if (endFrequency !== undefined) {
      filter.frequency.linearRampToValueAtTime(endFrequency, t0 + duration);
    }

    const gain = audioCtx.createGain();
    SynthesisEngine.applySimpleEnvelope(gain.gain, t0, duration, peakLevel, 0.01);

    const convolver = audioCtx.createConvolver();
    convolver.buffer = SynthesisEngine.createReverbIR(audioCtx, random, reverbDuration, 3.0);

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;

    noiseSource.connect(filter);
    filter.connect(gain);

    // Dry signal
    gain.connect(masterGain);

    // Wet signal
    gain.connect(convolver);
    convolver.connect(masterGain);

    masterGain.connect(audioCtx.destination);

    noiseSource.start(t0);
    noiseSource.stop(t0 + Math.max(duration, reverbDuration));
  }

  static playOscillator(
    ctx: SoundRecipeContext,
    type: OscillatorType,
    freq: number,
    duration: number,
    peakLevel = 1,
    attack = 0.01,
  ) {
    const { ctx: audioCtx, t0 } = ctx;
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const gain = audioCtx.createGain();
    SynthesisEngine.applySimpleEnvelope(gain.gain, t0, duration, peakLevel, attack);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t0);
    osc.stop(t0 + duration);
  }

  static createReverbIR(
    ctx: BaseAudioContext,
    random: LCG,
    duration: number,
    decay: number,
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let c = 0; c < 2; c++) {
      const channelData = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        // generate exponential decay noise
        const noise = random.nextFloat(-1, 1);
        channelData[i] = noise * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }
}

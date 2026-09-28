import { soundLibrary } from '../../audio/recipes';
import { LCG } from '../../audio/math';

export interface AudioRenderResult {
  id: string;
  sampleRate: number;
  lengthSamples: number;
  rms: number;
  peak: number;
  channels: Float32Array[];
}

export const audioApi = {
  renderOffline: async (soundId: string, seed: number): Promise<AudioRenderResult | null> => {
    const recipe = soundLibrary[soundId];
    if (!recipe) {
      console.error(`Sound recipe not found: ${soundId}`);
      return null;
    }

    // Environmental reverb belongs to M16b, so short sounds should stay short.
    // We add just a tiny buffer to avoid cutting off natural release tails, but keep
    // sounds like footsteps under 0.5s total as requested.
    let duration = recipe.duration;
    if (duration <= 0.3) {
      duration += 0.1; // short tail buffer for fast sounds
    } else {
      duration += 0.5; // longer tail for large sounds
    }

    // Always use 44100 sample rate for determinism across environments
    const sampleRate = 44100;
    const lengthSamples = Math.ceil(sampleRate * duration);

    const offlineCtx = new OfflineAudioContext(2, lengthSamples, sampleRate);

    const random = new LCG(seed);

    const renderCtx = {
      ctx: offlineCtx,
      t0: 0,
      random,
    };

    recipe.render(renderCtx);

    const renderedBuffer = await offlineCtx.startRendering();

    let peak = 0;
    let sumSquares = 0;
    const numChannels = renderedBuffer.numberOfChannels;

    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      const data = renderedBuffer.getChannelData(c);
      channels.push(data);
      for (let i = 0; i < data.length; i++) {
        const val = data[i] ?? 0;
        if (Math.abs(val) > peak) {
          peak = Math.abs(val);
        }
        sumSquares += val * val;
      }
    }

    const rms = Math.sqrt(sumSquares / (lengthSamples * numChannels));

    return {
      id: soundId,
      sampleRate,
      lengthSamples,
      rms,
      peak,
      channels,
    };
  },

  getAllSoundIds: (): string[] => {
    return Object.keys(soundLibrary);
  },
};

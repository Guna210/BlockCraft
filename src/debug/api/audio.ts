import { soundLibrary } from '../../audio/recipes';
import { LCG } from '../../audio/math';
import { SynthesisEngine } from '../../audio/engine';

export interface AudioRenderResult {
  id: string;
  sampleRate: number;
  lengthSamples: number;
  rms: number;
  peak: number;
}

export const audioApi = {
  renderOffline: async (soundId: string, seed: number): Promise<AudioRenderResult | null> => {
    const recipe = soundLibrary[soundId];
    if (!recipe) {
      console.error(`Sound recipe not found: ${soundId}`);
      return null;
    }

    // Include reverb tail. Let's add 1.5 seconds for reverb tail.
    // Also add to duration if sound takes longer to ring out.
    // In engine, reverb is optional per sound, but we'll render extra time for any tail.
    const duration = recipe.duration + 1.5;

    // Always use 44100 sample rate for determinism across environments
    const sampleRate = 44100;
    const lengthSamples = Math.ceil(sampleRate * duration);

    const offlineCtx = new OfflineAudioContext(2, lengthSamples, sampleRate);

    const random = new LCG(seed);

    // Some sounds might use reverb in the future, if they do they will route through it.
    // For now we just render the recipe directly to context destination.
    // If the recipe needs to construct reverb, it can, but typically the engine handles it.
    // Actually, in the spec "convolution reverb with generated impulse responses" is mentioned.
    // Let's create a global reverb node for this context in case recipes want to connect to it.

    const reverbNode = offlineCtx.createConvolver();
    // Use a fixed length and decay for deterministic IR
    reverbNode.buffer = SynthesisEngine.createReverbIR(offlineCtx, random, 1.5, 2.0);
    reverbNode.connect(offlineCtx.destination);

    // Recipes currently connect to destination directly in the recipes we wrote.
    // That's fine. We will just measure what ends up in destination.

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

    for (let c = 0; c < numChannels; c++) {
      const data = renderedBuffer.getChannelData(c);
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
    };
  },

  getAllSoundIds: (): string[] => {
    return Object.keys(soundLibrary);
  },
};

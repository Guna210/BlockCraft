import { SynthesisEngine, type SoundRecipe } from '../engine';

/** Renders one M16c sequence into one voice bus so a whole piece counts as one voice. */
export const musicSequenceRecipe: SoundRecipe = {
  duration: 1,
  render: (ctx) => {
    const sequence = ctx.sequence;
    if (!sequence) {
      SynthesisEngine.playOscillator(ctx, 'sine', 440, 0.25, 0.1, 0.01);
      return;
    }
    const { ctx: audioCtx, t0 } = ctx;
    const secondsPerBeat = 60 / sequence.tempo;
    const output = ctx.output ?? audioCtx.destination;
    for (const event of sequence.events) {
      const start = t0 + event.startTime * secondsPerBeat;
      const duration = Math.max(0.06, event.durationInBeats * secondsPerBeat * 0.88);
      const oscillator = audioCtx.createOscillator();
      oscillator.type = event.voice === 'pad' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(440 * 2 ** ((event.pitch - 69) / 12), start);
      const envelope = audioCtx.createGain();
      SynthesisEngine.applySimpleEnvelope(
        envelope.gain,
        start,
        duration,
        Math.min(0.16, event.velocity * (event.voice === 'pad' ? 0.09 : 0.13)),
        Math.min(0.04, duration * 0.1),
      );
      oscillator.connect(envelope);
      envelope.connect(output);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  },
};

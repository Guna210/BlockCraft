import { SynthesisEngine } from './engine';
import { LCG } from './math';

let context: AudioContext | null = null;
let last = -Infinity;
/** Allocate the audio device during world loading, outside simulation frames. */
export function prepareExplosionSound(): void {
  if (typeof AudioContext === 'undefined' || context) return;
  context = new AudioContext();
  const resume = () => {
    if (context?.state === 'suspended') void context.resume();
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}
/** Short synthesized boom; M16b owns positional mixing and the full reverberant recipe. */
export function playExplosion(seed: number): void {
  if (!context || context.state !== 'running' || performance.now() - last < 100) return;
  last = performance.now();
  const sound = { ctx: context, t0: context.currentTime, random: new LCG(seed) };
  SynthesisEngine.playNoise(sound, 0.24, 'lowpass', 550, 0.4);
  SynthesisEngine.playOscillator(sound, 'triangle', 55, 0.3, 0.45, 0.005);
}

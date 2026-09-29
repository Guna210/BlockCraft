export class LCG {
  private state: number;

  constructor(seed: number) {
    this.state = seed ? seed : 12345;
  }

  next(): number {
    // glibc LCG constants
    this.state = (1103515245 * this.state + 12345) % 2147483648;
    return this.state / 2147483648;
  }

  nextFloat(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

export function createNoiseBuffer(
  context: BaseAudioContext,
  duration: number,
  random: LCG,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.ceil(sampleRate * duration);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = random.nextFloat(-1, 1);
  }

  return buffer;
}

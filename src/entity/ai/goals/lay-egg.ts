import { LoveC } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface LayEggOptions {
  /** Ticks between eggs: a fresh roll of min..max after each egg. */
  min: number;
  max: number;
  /** Item dropped under the mob. */
  item: string;
}

/**
 * An adult lays one egg item entity every min–max ticks. The goal claims no flags, so it never
 * interrupts walking; it runs for the one tick in which the egg is laid.
 */
export class LayEggGoal extends MobGoal {
  readonly name = 'lay_egg';
  private wait: number;
  private laid = false;

  constructor(
    mob: MobHandle,
    private readonly options: LayEggOptions,
  ) {
    super(mob);
    this.wait = this.randomInt(options.min, options.max);
  }

  /** Ticks until the next egg. */
  get ticksUntilNext(): number {
    return this.wait;
  }

  set ticksUntilNext(ticks: number) {
    this.wait = ticks;
  }

  canStart(): boolean {
    if (this.ecs.get(this.id, LoveC)?.baby) return false;
    return --this.wait <= 0;
  }

  override shouldContinue(): boolean {
    return !this.laid;
  }

  override start(): void {
    this.wait = this.randomInt(this.options.min, this.options.max);
    this.laid = false;
    const items = this.runtime.spawnContext?.items;
    const pos = this.pos;
    if (items) items.spawn(this.options.item, 1, pos[0], pos[1] + 0.2, pos[2]);
    this.laid = true;
  }
}

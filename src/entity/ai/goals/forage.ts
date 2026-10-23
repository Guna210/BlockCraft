import type { GoalFlag } from '../goal';
import { BlockRegistry } from '../../../world/blocks/registry';
import { playClip } from '../../ecs/systems';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

export interface ForageOptions {
  name: string;
  /** Ticks between attempts: a fresh roll of min..max after each attempt. */
  min: number;
  max: number;
  /** Blocks the mob must stand on. */
  ground: readonly string[];
  /** Ticks the mob stands still with its head down before `act` runs. */
  duration: number;
  /** Model clip played while foraging. */
  clip?: string;
  /** Runs at the end, with the block the mob stands on. */
  act(x: number, y: number, z: number): void;
}

/**
 * Every min–max ticks, if the mob stands on one of its ground blocks, it stops, lowers its head for
 * `duration` ticks and then acts on that block: a Tuftbuck grazes, a Rootboar roots for a tuber.
 */
export class ForageGoal extends MobGoal {
  readonly name: string;
  override readonly flags: readonly GoalFlag[] = ['move', 'look'];
  private wait: number;
  private left = 0;
  private block: [number, number, number] | null = null;

  constructor(
    mob: MobHandle,
    private readonly options: ForageOptions,
  ) {
    super(mob);
    this.name = options.name;
    this.wait = this.randomInt(options.min, options.max);
  }

  /** Ticks until the next attempt. */
  get ticksUntilNext(): number {
    return this.wait;
  }

  set ticksUntilNext(ticks: number) {
    this.wait = ticks;
  }

  canStart(): boolean {
    if (--this.wait > 0) return false;
    this.wait = this.randomInt(this.options.min, this.options.max);
    this.block = this.groundBlock();
    return this.block !== null;
  }

  override shouldContinue(): boolean {
    return this.left > 0;
  }

  override start(): void {
    this.left = this.options.duration;
    this.nav.stop();
    if (this.options.clip) playClip(this.ecs, this.id, this.options.clip);
  }

  override tick(): void {
    this.body.wish[0] = this.body.wish[2] = 0;
    if (--this.left > 0) return;
    const block = this.groundBlock();
    if (block) this.options.act(block[0], block[1], block[2]);
  }

  override stop(): void {
    this.left = 0;
    this.block = null;
  }

  /** The block under the mob's feet when it is one of the ground blocks and the mob stands on it. */
  private groundBlock(): [number, number, number] | null {
    if (!this.body.onGround) return null;
    const pos = this.pos;
    const x = Math.floor(pos[0]),
      y = Math.floor(pos[1] - 0.05),
      z = Math.floor(pos[2]);
    const state = this.runtime.world.getBlockStateId(x, y, z);
    const id = BlockRegistry.getInstance().getResolvedState(state)?.blockId;
    return id !== undefined && this.options.ground.includes(id) ? [x, y, z] : null;
  }
}

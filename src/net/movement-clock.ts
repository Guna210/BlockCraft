import type { Player } from '../entity/player';

export const MAX_INPUT_STEPS = 3;
export const MOVEMENT_BURST = 3;
const SILENCE_TICKS = 5;

/** Per-connection movement timing; ordinary server ticks do not invent input steps. */
export class MovementClock {
  private silence = 0;
  private credit = MOVEMENT_BURST;

  constructor(private readonly budgeted = false) {}

  reset(): void {
    this.silence = 0;
    // Portal/world replacement must not refill a peer's movement budget.
  }

  beginTick(): void {
    this.credit = Math.min(MOVEMENT_BURST, this.credit + 1);
  }

  get canStep(): boolean {
    return !this.budgeted || this.credit > 0;
  }

  private spend(): boolean {
    if (!this.budgeted) return true;
    if (this.credit === 0) return false;
    this.credit--;
    return true;
  }

  input(player: Player): boolean {
    if (!this.spend()) return false;
    this.silence = 0;
    player.tick();
    return true;
  }

  finishTick(player: Player, appliedInputs: number, queueEmpty = true): void {
    if (appliedInputs > 0 || !queueEmpty) this.silence = 0;
    else if (++this.silence >= SILENCE_TICKS && this.spend()) {
      // Neutral locomotion never reuses held movement, but gravity still advances.
      player.clearInput();
      player.tick();
    }
  }
}

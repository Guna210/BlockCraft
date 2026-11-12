import type { Player } from '../entity/player';

export const MAX_INPUT_STEPS = 3;
const SILENCE_TICKS = 5;

/** Per-connection movement timing; ordinary server ticks do not invent input steps. */
export class MovementClock {
  private silence = 0;

  reset(): void {
    this.silence = 0;
  }

  input(player: Player): void {
    this.silence = 0;
    player.tick();
  }

  finishTick(player: Player, appliedInputs: number): void {
    if (appliedInputs > 0) this.silence = 0;
    else if (++this.silence >= SILENCE_TICKS) {
      // Neutral locomotion never reuses held movement, but gravity still advances.
      player.clearInput();
      player.tick();
    }
  }
}

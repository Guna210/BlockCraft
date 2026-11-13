import { FencedErrorDrain } from '../../render/fenced-error-drain';

/** Four times the normal burst allowance, still a finite bound on unread GPU frames. */
export const MAX_MULTIPLAYER_FRAMES_IN_FLIGHT = 16;

/** Defer busy-GPU error reads during multiplayer, without throttling input or model submission. */
export class MultiplayerErrorDrain extends FencedErrorDrain {
  override beginFrame(): void {
    const latest = this.pending[this.pending.length - 1];
    const finished =
      latest && (this.pollLatest ? this.pollLatest(latest) : this.isSignalled(latest));
    // A read after the latest fence covers every submitted frame. If the GPU stays busy,
    // keep the larger hard cap: no frame/fence can wait without a finite forced drain.
    if (finished || this.pending.length >= MAX_MULTIPLAYER_FRAMES_IN_FLIGHT) this.drainNow();
  }
}

/** Switch at session entry; every disconnect/exit call drains even after the normal mode is restored. */
export function installSessionErrorDrain(
  normal: FencedErrorDrain | null,
  multiplayer: FencedErrorDrain | null,
  install: (collector: FencedErrorDrain | null) => void,
): () => void {
  normal?.drainNow();
  install(multiplayer);
  let restored = false;
  return () => {
    (restored ? normal : multiplayer)?.drainNow();
    if (restored) return;
    install(normal);
    restored = true;
  };
}

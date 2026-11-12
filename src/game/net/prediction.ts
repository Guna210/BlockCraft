import type { Player } from '../../entity/player';
import { MessageType as T, type Messages } from '../../net/protocol';

const CAPACITY = 256;
const ACTIONS = ['jump', 'sneak', 'sprint', 'attack', 'use', 'pick'] as const;
/** Fixed storage for intent, post-tick pose and replay state. No tick allocates a record. */
export class Prediction {
  corrections = 0;
  private head = 0;
  private count = 0;
  private sequence = 0;
  private readonly frames = Array.from({ length: CAPACITY }, () => ({
    type: T.PlayerInput as const,
    sequence: 0,
    movement: [0, 0] as [number, number],
    look: [0, 0] as [number, number],
    actions: 0,
    state: new Float64Array(48),
  }));
  constructor(
    readonly player: Player,
    private readonly send: (message: Messages[T.PlayerInput]) => void,
  ) {}
  tick(): void {
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY;
      this.count--;
    }
    const frame = this.frames[(this.head + this.count++) % CAPACITY]!;
    frame.sequence = this.sequence = (this.sequence + 1) >>> 0;
    frame.movement[0] = Number(this.player.down('forward')) - Number(this.player.down('back'));
    frame.movement[1] = Number(this.player.down('right')) - Number(this.player.down('left'));
    frame.look[0] = this.player.yaw;
    frame.look[1] = this.player.pitch;
    frame.actions = 0;
    for (let i = 0; i < ACTIONS.length; i++)
      if (this.player.down(ACTIONS[i]!)) frame.actions |= 1 << i;
    this.send(frame);
    this.player.tick();
    this.player.writePredictionState(frame.state);
  }
  correct(message: Messages[T.PlayerCorrection]): void {
    let found = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.frames[(this.head + i) % CAPACITY]!.sequence === message.acknowledged) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      if (this.sequence === 0) {
        this.player.teleport(...message.position);
        for (let a = 0; a < 3; a++) this.player.vel[a] = message.velocity[a]!;
      }
      return;
    }
    const frame = this.frames[(this.head + found) % CAPACITY]!;
    const mismatch =
      Math.hypot(
        frame.state[0]! - message.position[0],
        frame.state[1]! - message.position[1],
        frame.state[2]! - message.position[2],
      ) > 0.01;
    this.head = (this.head + found + 1) % CAPACITY;
    this.count -= found + 1;
    if (!mismatch) return;
    this.corrections++;
    // Restore the acknowledged simulation phase before replacing the authoritative pose.
    this.player.readPredictionState(frame.state);
    for (let a = 0; a < 3; a++) {
      this.player.pos[a] = message.position[a]!;
      this.player.previous[a] = message.position[a]!;
      this.player.vel[a] = message.velocity[a]!;
    }
    this.player.onGround = this.player.collision.supported(...message.position, 1e-5);
    for (let i = 0; i < this.count; i++) {
      const pending = this.frames[(this.head + i) % CAPACITY]!;
      this.apply(pending);
      this.player.tick();
      this.player.writePredictionState(pending.state);
    }
  }
  private apply(frame: Messages[T.PlayerInput]): void {
    const p = this.player;
    p.input('forward', frame.movement[0] > 0);
    p.input('back', frame.movement[0] < 0);
    p.input('right', frame.movement[1] > 0);
    p.input('left', frame.movement[1] < 0);
    for (let i = 0; i < ACTIONS.length; i++) p.input(ACTIONS[i]!, !!(frame.actions & (1 << i)));
    p.yaw = frame.look[0];
    p.pitch = frame.look[1];
  }
}

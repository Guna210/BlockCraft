import type { Player } from '../../entity/player';
import { MovementClock } from '../../net/movement-clock';
import { MessageType as T, type Messages } from '../../net/protocol';

const CAPACITY = 256;
const ACTIONS = ['jump', 'sneak', 'sprint', 'attack', 'use', 'pick'] as const;
/** Fixed storage for intent, post-tick pose and replay state. No tick allocates a record. */
export class Prediction {
  corrections = 0;
  private dead = false;
  private vitals: Messages[T.PlayerVitals] | null = null;
  readonly trace: Array<{
    sequence: number;
    predicted: number[];
    authoritative: number[];
    movement: number[];
    actions: number;
    look: number[];
    predictedVelocity: number[];
    authoritativeVelocity: number[];
    flags: number[];
  }> = [];
  private readonly authoritative = new Float64Array(48);
  private readonly liveInput = new Float64Array(48);
  private readonly movementClock = new MovementClock();
  private provisional = false;
  private readonly provisionalBase = new Float64Array(48);
  private readonly provisionalInput = {
    type: T.PlayerInput as const,
    sequence: 0,
    movement: [0, 0] as [number, number],
    look: [0, 0] as [number, number],
    actions: 0,
  };
  private readonly beforeCorrection = new Float64Array(3);
  private head = 0;
  private count = 0;
  private sequence: number;
  get lastSequence(): number {
    return this.sequence;
  }
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
    sequence = 0,
    private readonly intent: ((action: string) => boolean) | null = null,
  ) {
    this.sequence = sequence;
    player.writePredictionState(this.authoritative);
  }
  applyVitals(v: Messages[T.PlayerVitals]): void {
    this.vitals = v;
    this.restoreVitals();
    this.dead = v.dead;
    this.vitalsState(this.authoritative, v);
    if (this.provisional) this.vitalsState(this.provisionalBase, v);
    if (v.dead) {
      this.provisional = false;
      this.player.clearInput();
    }
  }
  private restoreVitals(): void {
    const v = this.vitals;
    if (!v) return;
    const p = this.player;
    p.health = v.health;
    p.hunger = v.hunger;
    p.saturation = v.saturation;
    p.air = v.air;
    p.burning = v.burning;
    if (p.mode !== v.mode) p.setGameMode(v.mode);
    p.dead = this.dead = v.dead;
    p.xpLevel = v.xpLevel;
    p.xpProgress = v.xpProgress;
  }

  private vitalsState(state: Float64Array, v: Messages[T.PlayerVitals]): void {
    state[33] = v.health;
    state[34] = v.hunger;
    state[35] = v.saturation;
    state[37] = Number(v.dead);
    state[38] = v.air;
    state[39] = Number(v.burning);
    state[40] = Number(v.mode === 'creative');
    state[41] = v.xpLevel;
    state[42] = v.xpProgress;
    if (v.mode === 'survival') state[12] = 0;
  }
  respawn(position: readonly [number, number, number]): void {
    const p = this.player;
    this.head = this.count = 0;
    this.provisional = false;
    this.dead = false;
    this.vitals = null;
    this.movementClock.reset();
    p.survival.reset();
    p.clearInput();
    p.teleport(...position);
    p.onGround = p.collision.supported(...position, 1e-5);
    p.writePredictionState(this.authoritative);
  }
  tick(immediate = false): boolean {
    // The server's wire queue holds seven inputs. Reserve one slot for immediate input.
    // Backpressure also prevents timer catch-up from flooding a stalled server.
    if (this.dead) return false;
    if (this.count >= (immediate ? 7 : 6)) return false;
    const frame = this.nextFrame();
    frame.sequence = this.sequence = (this.sequence + 1) >>> 0;
    frame.movement[0] = Number(this.down('forward')) - Number(this.down('back'));
    frame.movement[1] = Number(this.down('right')) - Number(this.down('left'));
    frame.look[0] = this.player.yaw;
    frame.look[1] = this.player.pitch;
    frame.actions = 0;
    for (let i = 0; i < ACTIONS.length; i++) if (this.down(ACTIONS[i]!)) frame.actions |= 1 << i;
    this.send(frame);
    this.apply(frame);
    this.player.tick();
    this.restoreVitals();
    this.player.writePredictionState(frame.state);
    return true;
  }
  /** Immediate local response while the transport assigns the actual sequence. */
  speculate(input: Messages[T.PlayerInput]): boolean {
    if (this.dead || this.provisional) return false;
    this.player.writePredictionState(this.provisionalBase);
    this.provisionalInput.movement[0] = input.movement[0];
    this.provisionalInput.movement[1] = input.movement[1];
    this.provisionalInput.look[0] = input.look[0];
    this.provisionalInput.look[1] = input.look[1];
    this.provisionalInput.actions = input.actions;
    this.provisional = true;
    this.apply(this.provisionalInput);
    this.player.tick();
    this.restoreVitals();
    return true;
  }
  /** Predict the exact sequenced input emitted by the independent transport clock. */
  receiveInput(input: Messages[T.PlayerInput], immediateReceipt = false): void {
    if (this.dead) return;
    const yaw = this.player.yaw,
      pitch = this.player.pitch;
    if (this.provisional) this.player.readPredictionState(this.provisionalBase);
    const frame = this.nextFrame();
    frame.sequence = this.sequence = input.sequence;
    frame.movement[0] = input.movement[0];
    frame.movement[1] = input.movement[1];
    frame.look[0] = input.look[0];
    frame.look[1] = input.look[1];
    frame.actions = input.actions;
    this.apply(frame);
    this.player.tick();
    this.restoreVitals();
    this.player.writePredictionState(frame.state);
    if (immediateReceipt) this.provisional = false;
    if (this.provisional) this.replayProvisional();
    // Older clock messages must not overwrite a newer camera look.
    this.player.yaw = yaw;
    this.player.pitch = pitch;
  }
  private replayProvisional(): void {
    this.player.writePredictionState(this.provisionalBase);
    this.apply(this.provisionalInput);
    this.player.tick();
    this.restoreVitals();
  }
  private nextFrame() {
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY;
      this.count--;
    }
    return this.frames[(this.head + this.count++) % CAPACITY]!;
  }
  correct(message: Messages[T.PlayerCorrection]): void {
    if (this.dead) {
      this.head = this.count = 0;
      this.player.teleport(...message.position);
      this.player.clearInput();
      this.player.writePredictionState(this.authoritative);
      return;
    }
    let found = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.frames[(this.head + i) % CAPACITY]!.sequence === message.acknowledged) {
        found = i;
        break;
      }
    }
    const frame = found < 0 ? null : this.frames[(this.head + found) % CAPACITY]!;
    this.beforeCorrection.set(this.player.pos);
    this.player.writePredictionState(this.liveInput);
    // Advance only newly acknowledged inputs; plain repeated acknowledgements are idle.
    // The shared clock also supplies neutral physics after five silent server ticks.
    this.player.readPredictionState(this.authoritative);
    const appliedInputs = found + 1;
    for (let i = 0; i < appliedInputs; i++) {
      this.apply(this.frames[(this.head + i) % CAPACITY]!);
      this.movementClock.input(this.player);
      this.restoreVitals();
    }
    this.movementClock.finishTick(this.player, appliedInputs);
    this.restoreVitals();
    if (frame) {
      this.head = (this.head + appliedInputs) % CAPACITY;
      this.count -= appliedInputs;
    }
    for (let a = 0; a < 3; a++) {
      this.player.pos[a] = message.position[a]!;
      this.player.previous[a] = message.position[a]!;
      this.player.vel[a] = message.velocity[a]!;
    }
    this.player.onGround = this.player.collision.supported(...message.position, 1e-5);
    this.player.writePredictionState(this.authoritative);
    for (let i = 0; i < this.count; i++) {
      const pending = this.frames[(this.head + i) % CAPACITY]!;
      this.apply(pending);
      this.player.tick();
      this.restoreVitals();
      this.player.writePredictionState(pending.state);
    }
    if (this.provisional) this.replayProvisional();
    if (
      Math.hypot(
        this.player.pos[0] - this.beforeCorrection[0]!,
        this.player.pos[1] - this.beforeCorrection[1]!,
        this.player.pos[2] - this.beforeCorrection[2]!,
      ) > 0.01
    ) {
      const state = frame?.state ?? this.liveInput;
      this.corrections++;
      this.trace.push({
        sequence: message.acknowledged,
        predicted: [...this.beforeCorrection],
        authoritative: [...message.position],
        movement: frame ? [...frame.movement] : [],
        actions: frame?.actions ?? 0,
        look: frame ? [...frame.look] : [this.player.yaw, this.player.pitch],
        predictedVelocity: [state[3]!, state[4]!, state[5]!],
        authoritativeVelocity: [...message.velocity],
        flags: [state[11]!, state[26]!, state[28]!, state[30]!, state[23]!],
      });
      if (this.trace.length > 32) this.trace.shift();
    }
    this.player.restorePredictionInput(this.liveInput);
  }
  private down(action: string): boolean {
    return this.intent ? this.intent(action) : this.player.down(action);
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

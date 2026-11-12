import { expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { Prediction } from '../../src/game/net/prediction';
import { MessageType as T, type Messages } from '../../src/net/protocol';
import { MovementClock, MAX_INPUT_STEPS } from '../../src/net/movement-clock';

function player() {
  const world = new World(false);
  world.fill(-10, 64, -10, 200, 64, 10, 'stone');
  const p = new Player(new BlockCollision(world), () => true);
  p.teleport(0.5, 65, 0.5, 0, 0);
  p.onGround = true;
  return p;
}
it('acknowledges an exact delayed pose without counting a correction', () => {
  const p = player(),
    prediction = new Prediction(p, () => {});
  p.input('forward', true);
  prediction.tick();
  const first = [...p.pos] as [number, number, number];
  const velocity = [...p.vel] as [number, number, number];
  for (let i = 0; i < 4; i++) prediction.tick();
  const end = [...p.pos];
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 1,
    position: first,
    velocity,
  });
  expect(prediction.corrections).toBe(0);
  expect(p.pos).toEqual(end);
});
it('replays unacknowledged inputs and counts visible movement for repeated acknowledgements', () => {
  const p = player(),
    prediction = new Prediction(p, () => {});
  p.input('forward', true);
  prediction.tick();
  const state = new Float64Array(48);
  p.writePredictionState(state);
  const velocity = [...p.vel] as [number, number, number];
  for (let i = 0; i < 3; i++) prediction.tick();
  const server = player();
  server.readPredictionState(state);
  server.pos[0] += 0.25;
  const position = [...server.pos] as [number, number, number];
  for (let i = 0; i < 3; i++) server.tick();
  const correction = { type: T.PlayerCorrection as const, acknowledged: 1, position, velocity };
  prediction.correct(correction);
  expect(p.pos).toEqual(server.pos);
  const held = player();
  held.readPredictionState(state);
  held.pos[0] += 0.25;
  held.tick();
  server.tick();
  prediction.correct({ ...correction, position: [...held.pos], velocity: [...held.vel] });
  expect(p.pos).toEqual(server.pos);
  expect(prediction.corrections).toBe(2);
});
it('restores sprint/jump phase from caller-owned checkpoints', () => {
  const p = player();
  p.input('forward', true);
  p.input('jump', true);
  p.tick();
  const state = new Float64Array(48);
  p.writePredictionState(state);
  p.tick();
  const expected = p.snapshot();
  p.readPredictionState(state);
  p.tick();
  expect(p.snapshot()).toEqual(expected);
});

it('keeps sequence numbers across world resets and supports u32 wrap', () => {
  const p = player(),
    sequences: number[] = [];
  const prediction = new Prediction(p, (input) => sequences.push(input.sequence), 0xffffffff);
  prediction.tick();
  prediction.tick();
  expect(sequences).toEqual([0, 1]);
});
it('preserves input and look changes made after the latest predicted tick', () => {
  const p = player(),
    prediction = new Prediction(p, () => {});
  p.input('forward', true);
  prediction.tick();
  const position = [p.pos[0] + 0.2, p.pos[1], p.pos[2]] as [number, number, number];
  p.input('forward', false);
  p.yaw = 1.2;
  prediction.correct({ type: T.PlayerCorrection, acknowledged: 1, position, velocity: [...p.vel] });
  expect(p.down('forward')).toBe(false);
  expect(p.yaw).toBe(1.2);
});
it('samples raw input transitions exactly as the server sees them', () => {
  const p = player(),
    authority = player();
  let forward = true;
  const prediction = new Prediction(
    p,
    () => {},
    0,
    (action) => action === 'forward' && forward,
  );
  prediction.tick();
  authority.input('forward', true);
  authority.tick();
  // A release and press between tick samples must not invent a local double tap.
  forward = false;
  forward = true;
  prediction.tick();
  authority.input('forward', true);
  authority.tick();
  expect(p.snapshot()).toEqual(authority.snapshot());
});
it('aligns simulation phase from every ordered correction without counting an exact pose as a correction', () => {
  const p = player(),
    prediction = new Prediction(p, () => {});
  p.input('forward', true);
  prediction.tick();
  const first = [...p.pos] as [number, number, number];
  const velocity = [...p.vel] as [number, number, number];
  for (let i = 0; i < 4; i++) prediction.tick();
  for (let i = 0; i < 3; i++)
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged: 0,
      position: [0.5, 65, 0.5],
      velocity: [0, 0, 0],
    });
  prediction.correct({ type: T.PlayerCorrection, acknowledged: 1, position: first, velocity });
  const state = new Float64Array(48);
  p.writePredictionState(state);
  expect(prediction.corrections).toBe(0);
  expect(state[23]).toBe(5);
});
it.each([4, 8])('mirrors input-driven movement through a %i-tick packet pause', (pause) => {
  const p = player(),
    authority = player();
  const clock = new MovementClock();
  let forward = true;
  const prediction = new Prediction(
    p,
    () => {},
    0,
    (action) => action === 'forward' && forward,
  );
  prediction.tick();
  forward = false;
  prediction.tick();
  forward = true;
  prediction.tick();
  const correct = (acknowledged: number) =>
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged,
      position: [...authority.pos],
      velocity: [...authority.vel],
    });
  authority.input('forward', true);
  clock.input(authority);
  correct(1);
  for (let i = 0; i < pause; i++) {
    // Real server timing: no held-input tick; only the fifth and later silent ticks are neutral.
    clock.finishTick(authority, 0);
    correct(1);
    if (i < 4) expect(prediction.corrections).toBe(0);
  }
  authority.input('forward', false);
  clock.input(authority);
  correct(2);
  authority.input('forward', true);
  clock.input(authority);
  correct(3);
  expect(p.pos).toEqual(authority.pos);
  expect(p.vel).toEqual(authority.vel);
  const predictedState = new Float64Array(48),
    serverState = new Float64Array(48);
  p.writePredictionState(predictedState);
  authority.writePredictionState(serverState);
  expect(predictedState[26]).toBe(serverState[26]);
  // The first grounded neutral tick brakes to zero before displacement; later ones stay stationary.
  expect(prediction.corrections).toBe(0);
});
it('bounds outstanding packets to the server queue while reserving immediate input capacity', () => {
  const p = player();
  const sequences: number[] = [];
  const prediction = new Prediction(p, (frame) => sequences.push(frame.sequence));
  for (let i = 0; i < 6; i++) expect(prediction.tick()).toBe(true);
  expect(prediction.tick()).toBe(false);
  expect(prediction.tick(true)).toBe(true);
  expect(prediction.tick(true)).toBe(false);
  expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7]);
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 7,
    position: [...p.pos],
    velocity: [...p.vel],
  });
  expect(prediction.tick()).toBe(true);
  expect(sequences.at(-1)).toBe(8);
});

it('counts visible snaps for repeated acknowledgements but not an exact repeated pose', () => {
  const p = player();
  const prediction = new Prediction(p, () => {});
  prediction.tick();
  const correction = {
    type: T.PlayerCorrection as const,
    acknowledged: 1,
    position: [...p.pos] as [number, number, number],
    velocity: [...p.vel] as [number, number, number],
  };
  prediction.correct(correction);
  expect(prediction.corrections).toBe(0);
  // The acknowledged frame has left the ring; this server tick still snaps the player.
  correction.position[0] += 0.25;
  prediction.correct(correction);
  expect(prediction.corrections).toBe(1);
  expect(prediction.trace).toHaveLength(1);
  expect(prediction.trace[0]!.sequence).toBe(1);
  expect(prediction.trace[0]!.predicted[0]).toBe(0.5);
  expect(p.pos).toEqual(correction.position);
  prediction.correct(correction);
  expect(prediction.corrections).toBe(1);
  expect(prediction.trace).toHaveLength(1);
});

it('keeps phase-jittered zero-then-two input arrivals aligned without visible corrections', () => {
  const p = player();
  const server = player();
  const clock = new MovementClock();
  const queued: Messages[T.PlayerInput][] = [];
  const prediction = new Prediction(p, (input) => queued.push(input));
  let acknowledged = 0;
  const serverTick = (arrivals: number) => {
    let applied = 0;
    while (queued.length && applied < Math.min(arrivals, MAX_INPUT_STEPS)) {
      const input = queued.shift()!;
      server.input('forward', input.movement[0] > 0);
      server.input('back', input.movement[0] < 0);
      server.input('right', input.movement[1] > 0);
      server.input('left', input.movement[1] < 0);
      server.input('jump', !!(input.actions & 1));
      server.yaw = input.look[0];
      server.pitch = input.look[1];
      clock.input(server);
      acknowledged = input.sequence;
      applied++;
    }
    clock.finishTick(server, applied);
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged,
      position: [...server.pos],
      velocity: [...server.vel],
    });
  };
  for (let pair = 0; pair < 30; pair++) {
    p.input('forward', pair % 5 !== 0);
    p.input('jump', pair % 4 === 0);
    prediction.tick();
    serverTick(0);
    prediction.tick();
    serverTick(2);
    expect(p.pos).toEqual(server.pos);
    expect(p.vel).toEqual(server.vel);
  }
  expect(prediction.corrections).toBe(0);
  expect(prediction.trace).toHaveLength(0);
});

it('starts neutral physics after five silent ticks and falls without acknowledging a new input', () => {
  const p = player();
  const server = player();
  p.teleport(0.5, 80, 0.5);
  server.teleport(0.5, 80, 0.5);
  p.onGround = server.onGround = false;
  p.input('forward', true);
  server.input('forward', true);
  const prediction = new Prediction(p, () => {});
  const clock = new MovementClock();
  for (let silent = 1; silent <= 8; silent++) {
    clock.finishTick(server, 0);
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged: 0,
      position: [...server.pos],
      velocity: [...server.vel],
    });
    expect(p.pos).toEqual(server.pos);
    expect(p.vel).toEqual(server.vel);
    if (silent < 5) expect(server.pos[1]).toBe(80);
    else {
      expect(server.pos[1]).toBeLessThan(80);
      expect(server.down('forward')).toBe(false);
      expect(server.vel[1]).toBeLessThan(0);
    }
  }
  expect(prediction.lastSequence).toBe(0);
  // Silent ticks 5 through 8 each move the airborne player: four visible neutral-physics updates.
  expect(prediction.corrections).toBe(4);
});

it('replaces an immediate provisional step with its ordered worker sequence without double movement', () => {
  const p = player(),
    server = player();
  const prediction = new Prediction(p, () => {});
  const intent = {
    type: T.PlayerInput as const,
    sequence: 2,
    movement: [1, 0] as const,
    look: [0, 0] as const,
    actions: 0,
  };
  expect(prediction.speculate(intent)).toBe(true);
  expect(p.pos[0]).toBeGreaterThan(0.5);
  expect(prediction.speculate(intent)).toBe(false);
  // A regular worker tick was already queued before the immediate command reached it.
  prediction.receiveInput({ ...intent, sequence: 1, movement: [0, 0] });
  server.tick();
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 1,
    position: [...server.pos],
    velocity: [...server.vel],
  });
  p.yaw = 1.2;
  prediction.receiveInput(intent, true);
  server.input('forward', true);
  server.tick();
  expect(p.pos).toEqual(server.pos);
  expect(p.yaw).toBe(1.2);
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 2,
    position: [...server.pos],
    velocity: [...server.vel],
  });
  expect(p.pos).toEqual(server.pos);
  expect(prediction.corrections).toBe(0);
  expect(prediction.lastSequence).toBe(2);
});

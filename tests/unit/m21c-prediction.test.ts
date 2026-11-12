import { expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { Prediction } from '../../src/game/net/prediction';
import { MessageType as T } from '../../src/net/protocol';

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
  for (let i = 0; i < 4; i++) prediction.tick();
  const end = [...p.pos];
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 1,
    position: first,
    velocity: [0, 0, 0],
  });
  expect(prediction.corrections).toBe(0);
  expect(p.pos).toEqual(end);
});
it('replays unacknowledged inputs from the authoritative pose and ignores repeated acknowledgements', () => {
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
  prediction.correct(correction);
  expect(p.pos).toEqual(server.pos);
  expect(prediction.corrections).toBe(1);
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
  expect(state[23]).toBe(8);
});

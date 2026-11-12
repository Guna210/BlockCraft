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

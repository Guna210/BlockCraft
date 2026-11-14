import { expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { Prediction } from '../../src/game/net/prediction';
import { MessageType as T, type Messages } from '../../src/net/protocol';
function setup() {
  const w = new World(false);
  w.fill(-10, 64, -10, 40, 64, 10, 'stone');
  const p = new Player(new BlockCollision(w), () => true);
  p.teleport(0.5, 65, 0.5, 0, 0);
  p.onGround = true;
  return { p, prediction: new Prediction(p, () => {}) };
}
const vitals: Messages[T.PlayerVitals] = {
  type: T.PlayerVitals,
  health: 12,
  hunger: 6,
  saturation: 0,
  air: 42,
  burning: true,
  mode: 'creative',
  dead: false,
  deathCause: '',
  xpLevel: 4,
  xpProgress: 0.5,
};
it('applies vitals to live state and checkpoint, preserving them through replay', () => {
  const { p, prediction } = setup();
  prediction.applyVitals(vitals);
  expect(p.snapshot()).toMatchObject({
    health: 12,
    hunger: 6,
    air: 42,
    burning: true,
    mode: 'creative',
    xpLevel: 4,
    xpProgress: 0.5,
  });
  p.health = 20;
  p.air = 300;
  p.mode = 'survival';
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 0,
    position: [...p.pos],
    velocity: [...p.vel],
  });
  expect(p.snapshot()).toMatchObject({
    health: 12,
    hunger: 6,
    air: 42,
    burning: true,
    mode: 'creative',
    xpLevel: 4,
    xpProgress: 0.5,
  });
});
it('refreshes vitals during movement without counting corrections', () => {
  const { p, prediction } = setup();
  p.input('forward', true);
  prediction.tick();
  const position = [...p.pos] as [number, number, number],
    velocity = [...p.vel] as [number, number, number];
  prediction.tick();
  prediction.applyVitals({ ...vitals, mode: 'survival', hunger: 20 });
  prediction.correct({ type: T.PlayerCorrection, acknowledged: 1, position, velocity });
  expect(prediction.corrections).toBe(0);
  expect(p.health).toBe(12);
});
it('death and fresh respawn clear pending/provisional movement without a counted correction', () => {
  const { p, prediction } = setup();
  p.input('forward', true);
  prediction.tick();
  prediction.speculate({
    type: T.PlayerInput,
    sequence: 0,
    movement: [1, 0],
    look: [0, 0],
    actions: 0,
  });
  prediction.applyVitals({ ...vitals, dead: true, health: 0, deathCause: 'Drowned' });
  expect(prediction.tick()).toBe(false);
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 1,
    position: [2, 65, 2],
    velocity: [0, 0, 0],
  });
  prediction.respawn([5, 65, 5]);
  expect(p.pos).toEqual([5, 65, 5]);
  expect(p.dead).toBe(false);
  expect(p.health).toBe(20);
  expect(p.down('forward')).toBe(false);
  prediction.correct({
    type: T.PlayerCorrection,
    acknowledged: 1,
    position: [5, 65, 5],
    velocity: [0, 0, 0],
  });
  expect(prediction.corrections).toBe(0);
});

it('keeps server health through a locally predicted lethal landing until server vitals arrive', () => {
  const { p } = setup();
  p.teleport(0.5, 85, 0.5, 0, 0);
  // The presentation-only player's callbacks do not perform local death side effects.
  p.survival.onDeath = () => {};
  const prediction = new Prediction(p, () => {});
  prediction.applyVitals({ ...vitals, mode: 'survival', health: 2, hunger: 20 });
  for (let sequence = 1; sequence <= 50; sequence++)
    prediction.receiveInput({
      type: T.PlayerInput,
      sequence,
      movement: [0, 0],
      look: [0, 0],
      actions: 0,
    });
  expect(p.onGround).toBe(true);
  expect(p.health).toBe(2);
  expect(p.dead).toBe(false);
});

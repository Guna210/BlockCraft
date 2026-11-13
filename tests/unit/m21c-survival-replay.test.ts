import { it, expect } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { Prediction } from '../../src/game/net/prediction';
import { MovementClock } from '../../src/net/movement-clock';
import { MessageType as T, type Messages } from '../../src/net/protocol';

function fallingPlayer() {
  const world = new World(false);
  world.fill(-2, 64, -2, 2, 64, 2, 'stone');
  const player = new Player(new BlockCollision(world), () => true);
  player.teleport(0.5, 72, 0.5);
  return player;
}

it('replays a delayed landing without repeatedly applying fall damage or killing only the client', () => {
  const p = fallingPlayer(),
    server = fallingPlayer();
  const queue: Messages[T.PlayerInput][] = [];
  const prediction = new Prediction(p, (input) => queue.push(input));
  const clock = new MovementClock(true);
  let acknowledged = 0;
  for (let tick = 0; tick < 80; tick++) {
    if (tick < 60) prediction.tick();
    clock.beginTick();
    let applied = 0;
    if ((tick >= 3 && tick < 60) || (tick >= 60 && queue.length)) {
      const input = queue.shift()!;
      clock.input(server);
      acknowledged = input.sequence;
      applied = 1;
    }
    clock.finishTick(server, applied, queue.length === 0);
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged,
      position: [...server.pos],
      velocity: [...server.vel],
    });
  }
  expect(server.health).toBeLessThan(20);
  expect(server.dead).toBe(false);
  expect(p.health).toBe(server.health);
  expect(p.hunger).toBe(server.hunger);
  expect(p.saturation).toBe(server.saturation);
  expect(p.survival.exhaustion).toBe(server.survival.exhaustion);
  expect(p.dead).toBe(false);
  expect(p.pos).toEqual(server.pos);
  expect(prediction.corrections).toBe(0);
});

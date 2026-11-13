import { expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { MovementClock, MOVEMENT_BURST, MAX_INPUT_STEPS } from '../../src/net/movement-clock';
import { Prediction } from '../../src/game/net/prediction';
import { MessageType as T, type Messages } from '../../src/net/protocol';

function player() {
  const world = new World(false);
  world.fill(-4, 64, -4, 150, 64, 4, 'stone');
  const p = new Player(new BlockCollision(world), () => true);
  p.teleport(0.5, 65, 0.5, 0, 0);
  p.onGround = true;
  return p;
}

it('bounds a sustained three-input-per-tick client to elapsed-time credits plus the burst allowance', () => {
  const p = player(),
    bound = player();
  let now = 0;
  const clock = new MovementClock(true, () => now);
  p.input('forward', true);
  bound.input('forward', true);
  // Existing seven-usable-slot queue: full packets stay outside it, as on the server.
  const queue = new Uint32Array(8);
  const accepted: number[] = [];
  let head = 0,
    tail = 0,
    sequence = 0,
    acknowledged = 0,
    appliedTotal = 0;
  for (let tick = 0; tick < 200; tick++) {
    for (let incoming = 0; incoming < 3; incoming++) {
      const next = (tail + 1) % queue.length;
      sequence++;
      if (next !== head) {
        queue[tail] = sequence;
        accepted.push(sequence);
        tail = next;
      }
    }
    now += 50;
    clock.beginTick();
    let applied = 0;
    while (head !== tail && applied < MAX_INPUT_STEPS && clock.canStep) {
      expect(queue[head]).toBe(accepted[appliedTotal]);
      expect(clock.input(p)).toBe(true);
      acknowledged = queue[head]!;
      head = (head + 1) % queue.length;
      applied++;
      appliedTotal++;
    }
    clock.finishTick(p, applied, head === tail);
  }
  for (let i = 0; i < 200 + MOVEMENT_BURST; i++) bound.tick();
  expect(appliedTotal).toBeLessThanOrEqual(200 + MOVEMENT_BURST);
  expect(p.pos[0] - 0.5).toBeLessThanOrEqual(bound.pos[0] - 0.5);
  expect(head).not.toBe(tail);
  expect(acknowledged).toBe(accepted[appliedTotal - 1]);
  expect(sequence).toBe(600);
});

it('retains two-step phase-jitter catch-up with zero visible corrections under the server budget', () => {
  const p = player(),
    server = player();
  let now = 0;
  const clock = new MovementClock(true, () => now);
  const queue: Messages[T.PlayerInput][] = [];
  const prediction = new Prediction(p, (input) => queue.push(input));
  p.input('forward', true);
  let acknowledged = 0;
  for (let tick = 0; tick < 100; tick++) {
    prediction.tick();
    now += 50;
    clock.beginTick();
    let applied = 0;
    if (tick % 2 === 1)
      while (queue.length && applied < MAX_INPUT_STEPS && clock.canStep) {
        const input = queue.shift()!;
        server.input('forward', input.movement[0] > 0);
        clock.input(server);
        acknowledged = input.sequence;
        applied++;
      }
    clock.finishTick(server, applied, queue.length === 0);
    prediction.correct({
      type: T.PlayerCorrection,
      acknowledged,
      position: [...server.pos],
      velocity: [...server.vel],
    });
    if (tick % 2 === 1) {
      expect(applied).toBe(2);
      expect(p.pos).toEqual(server.pos);
    }
  }
  expect(prediction.corrections).toBe(0);
});

it('does not treat credit starvation with queued input as silence, and charges neutral steps', () => {
  const p = player();
  p.teleport(0.5, 80, 0.5);
  p.onGround = false;
  let now = 0;
  const clock = new MovementClock(true, () => now);
  // Spend the initial burst, then hold a pending queue without adding server ticks.
  for (let i = 0; i < MOVEMENT_BURST; i++) expect(clock.input(p)).toBe(true);
  const y = p.pos[1];
  for (let i = 0; i < 8; i++) clock.finishTick(p, 0, false);
  expect(p.pos[1]).toBe(y);
  expect(clock.input(p)).toBe(false);
  for (let tick = 1; tick <= 5; tick++) {
    now += 50;
    clock.beginTick();
    clock.finishTick(p, 0, true);
    if (tick < 5) expect(p.pos[1]).toBe(y);
  }
  expect(p.pos[1]).toBeLessThan(y);
  // The neutral step used one of the capped three credits.
  expect(clock.input(p)).toBe(true);
  expect(clock.input(p)).toBe(true);
  expect(clock.input(p)).toBe(false);
  clock.reset();
  expect(clock.canStep).toBe(false);
});

it('drains an honest 20 Hz input stream on a slow 75 ms server without accumulating a queue', () => {
  const p = player(),
    reference = player();
  let now = 0;
  const clock = new MovementClock(true, () => now);
  p.input('forward', true);
  reference.input('forward', true);
  let received = 0,
    appliedTotal = 0;
  for (let tick = 1; tick <= 200; tick++) {
    now = tick * 75;
    // The injected wall clock delivers one input at each real 50 ms deadline.
    const due = Math.floor(now / 50);
    received += due - received;
    clock.beginTick();
    let applied = 0;
    while (appliedTotal < received && applied < MAX_INPUT_STEPS && clock.canStep) {
      expect(clock.input(p)).toBe(true);
      reference.tick();
      appliedTotal++;
      applied++;
    }
    clock.finishTick(p, applied, appliedTotal === received);
    expect(appliedTotal).toBe(received);
    expect(p.pos).toEqual(reference.pos);
  }
  expect(appliedTotal).toBe(300);
});

it('bounds three inputs per slow tick by elapsed milliseconds rather than tick count', () => {
  const p = player(),
    bound = player();
  let now = 0,
    appliedTotal = 0;
  const clock = new MovementClock(true, () => now);
  p.input('forward', true);
  bound.input('forward', true);
  for (let tick = 1; tick <= 200; tick++) {
    now = tick * 75;
    clock.beginTick();
    let applied = 0;
    while (applied < 3 && clock.canStep) {
      expect(clock.input(p)).toBe(true);
      applied++;
      appliedTotal++;
    }
    clock.finishTick(p, applied, false);
    expect(appliedTotal).toBeLessThanOrEqual(Math.floor(now / 50) + MOVEMENT_BURST);
  }
  for (let step = 0; step < Math.floor(now / 50) + MOVEMENT_BURST; step++) bound.tick();
  expect(p.pos[0] - 0.5).toBeLessThanOrEqual(bound.pos[0] - 0.5);
});

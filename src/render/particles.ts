import { PRNG, deriveSeed } from '../engine/rng';
import type { Position } from '../entity/physics';
import type { World } from '../world/world';

export const PARTICLE_CAPACITY = 512;
export class BreakParticle {
  active = false;
  age = 0;
  lifetime = 20;
  state = 0;
  face = 0;
  u = 0;
  v = 0;
  readonly pos: Position = [0, 0, 0];
  readonly previous: Position = [0, 0, 0];
  readonly vel: Position = [0, 0, 0];
}
/** Pool replacement affects only the oldest visual debris, never item loot. */
export class BreakParticles {
  readonly pool = Array.from({ length: PARTICLE_CAPACITY }, () => new BreakParticle());
  private next = 0;
  private readonly random: PRNG;
  constructor(world: World) {
    this.random = new PRNG(deriveSeed(world.worldSeed, 'break-particles'));
  }
  spawn(state: number, x: number, y: number, z: number): void {
    for (let n = 0; n < 16; n++) {
      const p = this.pool[this.next]!;
      this.next = (this.next + 1) % PARTICLE_CAPACITY;
      p.active = true;
      p.age = 0;
      p.state = state;
      p.lifetime = 18 + Math.floor(this.random.next() * 5);
      p.face = Math.floor(this.random.next() * 6);
      p.u = Math.floor(this.random.next() * 13);
      p.v = Math.floor(this.random.next() * 13);
      for (let axis = 0; axis < 3; axis++) {
        p.pos[axis] = p.previous[axis] =
          (axis === 0 ? x : axis === 1 ? y : z) + 0.2 + this.random.next() * 0.6;
        p.vel[axis] = (this.random.next() - 0.5) * 4 + (axis === 1 ? 2 : 0);
      }
    }
  }
  tick(): void {
    for (let n = 0; n < PARTICLE_CAPACITY; n++) {
      const p = this.pool[n]!;
      if (!p.active) continue;
      if (++p.age >= p.lifetime) {
        p.active = false;
        continue;
      }
      p.vel[1] -= 12 * 0.05;
      for (let axis = 0; axis < 3; axis++) {
        p.previous[axis] = p.pos[axis]!;
        p.pos[axis]! += p.vel[axis]! * 0.05;
        p.vel[axis]! *= 0.96;
      }
    }
  }
}

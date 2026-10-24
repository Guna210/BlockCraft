import { PRNG, deriveSeed } from '../engine/rng';
import type { Position } from '../entity/physics';
import type { World } from '../world/world';

export const PARTICLE_CAPACITY = 512;
export const EMBER_CAPACITY = 128;
export class BreakParticle {
  active = false;
  emberOwner: number | null = null;
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
      p.emberOwner = null;
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
  /** A bounded share of the existing pool; no ember pool or additional tick system. */
  ember(owner: number, pos: Readonly<Position>, random: () => number, count = 1): void {
    let active = 0;
    let total = 0;
    for (const p of this.pool) {
      if (!p.active || p.emberOwner === null) continue;
      total++;
      if (p.emberOwner === owner) active++;
    }
    let cursor = 0;
    for (let i = 0; i < Math.min(count, 24 - active, EMBER_CAPACITY - total); i++) {
      while (cursor < PARTICLE_CAPACITY && this.pool[cursor]!.active) cursor++;
      if (cursor === PARTICLE_CAPACITY) break;
      const p = this.pool[cursor++]!;
      p.active = true;
      p.emberOwner = owner;
      p.age = 0;
      p.lifetime = 16 + Math.floor(random() * 9);
      for (let a = 0; a < 3; a++) {
        p.pos[a] = p.previous[a] =
          pos[a]! +
          (a === 1
            ? count > 1
              ? 0.6 + random() * 0.9
              : random() * 0.1
            : (random() - 0.5) * (count > 1 ? 0.9 : 0.08));
        p.vel[a] = a === 1 ? 0.7 + random() * 0.6 : (random() - 0.5) * 0.4;
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
      p.vel[1] += p.emberOwner === null ? -12 * 0.05 : 0.03;
      for (let axis = 0; axis < 3; axis++) {
        p.previous[axis] = p.pos[axis]!;
        p.pos[axis]! += p.vel[axis]! * 0.05;
        p.vel[axis]! *= 0.96;
      }
    }
  }
}

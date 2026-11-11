import type { Position } from '../entity/physics';

/** Visual effects supplied by the client; shared simulation owns no renderer. */
export interface ParticleSink {
  spawn(state: number, x: number, y: number, z: number): void;
  explosion(center: Readonly<Position>, random: () => number): void;
  ember(owner: number, pos: Readonly<Position>, random: () => number, count?: number): void;
}

import type { Vec3 } from '../entity/ecs/model';

/** Client effects for simulation events that have no injected adapter. */
export interface GameEventSink {
  explosion(center: Readonly<Vec3>, priority: number): void;
}
let sink: GameEventSink | null = null;
/** Register once during client startup; Node defaults to no effects. */
export function setGameEventSink(value: GameEventSink | null): void {
  sink = value;
}
export function emitExplosion(center: Readonly<Vec3>, priority: number): void {
  sink?.explosion(center, priority);
}

import { sound } from './service';

/** Compatibility wrapper routed through M16b's single audio service. */
export function playExplosion(_seed: number): void {
  sound.play('entity.explosion', { priority: 2 });
}

import { sound } from './service';
import type { Vec3 } from '../entity/ecs/model';

/** Compatibility wrapper routed through M16b's single audio service. */
export function playExplosion(center: Readonly<Vec3>, priority = 2): void {
  sound.play('entity.explosion', { pos: center, priority });
}

import { getWorldInstance } from '../../world/world-instance';

export function getLight(x: number, y: number, z: number): { sky: number; block: number } {
  const world = getWorldInstance();
  return world.getLight(x, y, z);
}

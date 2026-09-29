import { getWorldInstance, setWorldInstance } from '../../world/world-instance';
import { World } from '../../world/world';

export function setDebugWorldInstance(world: World): void {
  setWorldInstance(world);
}

export function getBlock(
  x: number,
  y: number,
  z: number,
): { id: string; state: Record<string, string | number> } {
  return getWorldInstance().getBlock(x, y, z);
}

export function setBlock(
  x: number,
  y: number,
  z: number,
  id: string,
  state?: Record<string, string | number>,
): void {
  getWorldInstance().setBlock(x, y, z, id, state);
}

export function fill(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  id: string,
): void {
  getWorldInstance().fill(x1, y1, z1, x2, y2, z2, id);
}

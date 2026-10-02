import { getWorldInstance, setWorldInstance } from '../../world/world-instance';
import { World } from '../../world/world';
import { WorldManager } from '../../world/world-manager';

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

export function getBiome(x: number, z: number): string {
  return getWorldInstance().getBiome(x, z);
}

export function getHeight(x: number, z: number): number {
  return getWorldInstance().getHeight(x, z);
}

export function worldHash(x1: number, z1: number, x2: number, z2: number): string {
  const world = getWorldInstance();
  return world.worldHash(x1, z1, x2, z2, (cx, cz) => {
    WorldManager.getInstance().generateColumnMainThread(cx, cz);
  });
}

import { getWorldInstance } from '../../world/world-instance';

export function getLight(x: number, y: number, z: number): { sky: number; block: number } {
  const world = getWorldInstance();
  return world.getLight(x, y, z);
}

export function getBlockLightRGB(
  x: number,
  y: number,
  z: number,
): { r: number; g: number; b: number } {
  return getWorldInstance().lightEngine.getBlockLightRGB(x, y, z);
}

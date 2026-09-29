import { World } from './world';

let globalWorldInstance: World | null = null;

export function getWorldInstance(): World {
  if (!globalWorldInstance) {
    globalWorldInstance = new World();
  }
  return globalWorldInstance;
}

export function setWorldInstance(world: World): void {
  globalWorldInstance = world;
}

import { WorldManager } from '../../world/world-manager';

export function setWorkerPoolSize(size: number): void {
  WorldManager.getInstance().setWorkerPoolSize(size);
}

export function getMainThreadGenCount(): number {
  return WorldManager.getInstance().mainThreadGenCount;
}

export function resetMainThreadGenCount(): void {
  WorldManager.getInstance().resetMainThreadGenCount();
}

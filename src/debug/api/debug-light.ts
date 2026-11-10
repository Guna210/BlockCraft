import { WorldManager } from '../../game/world-manager';

/** Explicit fullbright override for the owner-approved M03 cave viewpoints. */
export function setDebugLight(on: boolean): void {
  WorldManager.getInstance().setDebugLight(on);
}

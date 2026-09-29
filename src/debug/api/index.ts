import { api } from './core';
import { audioApi } from './audio';
import { look } from './camera';
import { showTestScene } from './test-scene';
import { getBlock, setBlock, fill } from './world';
import { wireframe, setWireframe } from './wireframe';
import { WorldManager } from '../../world/world-manager';

declare global {
  interface Window {
    __blockcraft?: typeof api;
  }
}

export function initDebugApi() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') {
    api.audio = audioApi;
    api.look = look;
    api.showTestScene = showTestScene;
    api.getBlock = getBlock;
    api.setBlock = setBlock;
    api.fill = fill;
    api.wireframe = wireframe;
    api.setWireframe = setWireframe;
    api.createWorld = (opts) => WorldManager.getInstance().createWorld(opts);
    api.waitForTerrain = (r) => WorldManager.getInstance().waitForTerrain(r);
    api.getWorkerStats = () => WorldManager.getInstance().getWorkerStats();
    window.__blockcraft = api;
  }
}

import { api } from './core';
import { audioApi } from './audio';
import { look } from './camera';
import { showTestScene } from './test-scene';
import { getBlock, setBlock, fill } from './world';

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
    window.__blockcraft = api;
  }
}

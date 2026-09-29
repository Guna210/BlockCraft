import { api } from './core';
import { audioApi } from './audio';
import { look } from './camera';
import { showTestScene } from './test-scene';

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
    window.__blockcraft = api;
  }
}

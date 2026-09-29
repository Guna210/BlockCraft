import { api } from './core';
import { audioApi } from './audio';
import { look } from './camera';

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
    window.__blockcraft = api;
  }
}

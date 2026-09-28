import { api } from './core';

declare global {
  interface Window {
    __blockcraft?: typeof api;
  }
}

export function initDebugApi() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') {
    window.__blockcraft = api;
  }
}

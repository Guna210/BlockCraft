export let wireframeEnabled = false;

export function setWireframe(enabled: boolean): void {
  wireframeEnabled = enabled;
}

export function wireframe(enabled?: boolean): boolean {
  if (enabled !== undefined) {
    wireframeEnabled = enabled;
  }
  return wireframeEnabled;
}

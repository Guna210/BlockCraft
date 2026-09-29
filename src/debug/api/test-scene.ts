type Initializer = () => Promise<void>;

let sceneInitializer: Initializer | null = null;
let isInitialized = false;

export function setTestSceneInitializer(initializer: Initializer) {
  sceneInitializer = initializer;
}

export function showTestScene(): Promise<void> {
  if (isInitialized) {
    return Promise.resolve();
  }
  if (!sceneInitializer) {
    return Promise.reject(new Error('Test scene initializer not set'));
  }

  isInitialized = true;
  return sceneInitializer();
}

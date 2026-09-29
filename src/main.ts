import { initDebugApi } from './debug/api/index';
import { markReady, renderStats } from './debug/api/core';
import { setTestSceneInitializer } from './debug/api/test-scene';
import { setActiveCamera } from './debug/api/camera';
import { GLWrapper } from './render/gl';
import { TestScene } from './render/test-scene';
import { InputEngine } from './engine/input';
import { Camera } from './render/camera';
import { WorldManager } from './world/world-manager';

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [r, g, b];
}

function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function main() {
  initDebugApi();

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const errorScreen = document.getElementById('error-screen') as HTMLDivElement;

  if (!canvas) return;

  const gl = canvas.getContext('webgl2');

  if (!gl) {
    canvas.style.display = 'none';
    errorScreen.style.display = 'block';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';

  const glWrapper = new GLWrapper(gl, debug, () => {
    renderStats.glErrors++;
  });

  const input = new InputEngine(canvas);
  input.attach();

  const camera = new Camera(window.innerWidth / window.innerHeight);
  setActiveCamera(camera);

  const worldManager = WorldManager.getInstance();
  worldManager.initGL(glWrapper, camera);

  let testScene: TestScene | null = null;
  let firstFrameResolve: (() => void) | null = null;

  setTestSceneInitializer(() => {
    return new Promise<void>((resolve) => {
      testScene = new TestScene(glWrapper, window.innerWidth / window.innerHeight);
      firstFrameResolve = resolve;
    });
  });

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl!.viewport(0, 0, canvas.width, canvas.height);
    if (testScene) {
      testScene.camera.setAspect(canvas.width / canvas.height);
    }
    camera.setAspect(canvas.width / canvas.height);
  }

  window.addEventListener('resize', resize);
  resize();

  // Sky blue color: hue 200 (approx 200/360 = 0.55), s: 1.0, l: 0.5
  const h = 200 / 360;
  const s = 1.0;
  const l = 0.7; // Lighter blue
  const [r, g, b] = hslToRgb(h, s, l);
  glWrapper.gl.clearColor(r, g, b, 1.0);

  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  const cpuTimes: number[] = [];

  function render(time: number) {
    const startTime = performance.now();
    const dt = time - lastTime;
    lastTime = time;

    glWrapper.gl.clear(glWrapper.gl.COLOR_BUFFER_BIT | glWrapper.gl.DEPTH_BUFFER_BIT);

    if (testScene) {
      testScene.render(dt / 1000, input);
      if (firstFrameResolve) {
        firstFrameResolve();
        firstFrameResolve = null;
      }
    } else if (worldManager.world) {
      camera.update(dt / 1000, input);
      worldManager.render();
    }

    const endTime = performance.now();
    cpuTimes.push(endTime - startTime);

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 1000) {
      renderStats.fps = Math.round((frameCount * 1000) / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      // Calculate P95 CPU time
      if (cpuTimes.length > 0) {
        cpuTimes.sort((a, b) => a - b);
        const p95Index = Math.floor(cpuTimes.length * 0.95);
        renderStats.frameCpuMsP95 = cpuTimes[p95Index] || 0;
        cpuTimes.length = 0;
      }
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame((time) => {
    markReady();
    render(time);
  });
}

main();

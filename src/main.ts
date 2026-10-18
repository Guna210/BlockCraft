import { PlayerController } from './engine/player-controller';
import { initDebugApi } from './debug/api/index';
import { markReady, renderStats, setGlErrorDrain } from './debug/api/core';
import { setTestSceneInitializer } from './debug/api/test-scene';
import { setActiveCamera } from './debug/api/camera';
import { GLWrapper } from './render/gl';
import { FencedErrorDrain } from './render/fenced-error-drain';
import { TestScene } from './render/test-scene';
import { InputEngine } from './engine/input';
import { Camera } from './render/camera';
import { WorldManager } from './world/world-manager';
import { frameStats, percentile95 } from './engine/frame-stats';
import { buildIconSheet, createTileLookup, type IconSheet } from './ui/icons';
import { UiManager, activeUi } from './ui/ui-manager';
import { Hud, type DebugOverlaySnapshot } from './ui/hud';
import { createSentinelTile } from './render/texture-resolve';
import { registerKilnBlockEntity } from './gameplay/kiln';

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
  registerKilnBlockEntity();

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const errorScreen = document.getElementById('error-screen') as HTMLDivElement;

  if (!canvas) return;

  const gl = canvas.getContext('webgl2', { stencil: true });

  if (!gl) {
    canvas.style.display = 'none';
    errorScreen.style.display = 'block';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';

  // Debug mode reads WebGL errors once per frame. `&glcheck=draw` also reads them after every draw
  // call, which pins the error to its draw but costs a GPU-process round trip per draw.
  const glCheckDraw = debug && params.get('glcheck') === 'draw';
  const glWrapper = new GLWrapper(gl, glCheckDraw, () => {
    renderStats.glErrors++;
  });

  const input = new InputEngine(canvas);
  input.attach();

  const camera = new Camera(window.innerWidth / window.innerHeight);
  setActiveCamera(camera);

  const worldManager = WorldManager.getInstance();
  worldManager.initGL(glWrapper, camera);
  const playerController = new PlayerController(camera, input, (x, z) =>
    worldManager.streamer.canSimulate(Math.floor(x / 16), Math.floor(z / 16)),
  );
  worldManager.playerController = playerController;
  // The icon atlas is built once, in one pass over the registries, from tiles already generated.
  // It is built right after the first frame, off the path to the first frame, or on first use.
  let iconSheet: IconSheet | null = null;
  const icons = () =>
    (iconSheet ??= buildIconSheet(
      createTileLookup(worldManager.atlas!),
      createSentinelTile(),
      (name) => {
        if (!renderStats.missingTextures.includes(name)) renderStats.missingTextures.push(name);
      },
    ));
  const ui = new UiManager(input, () => worldManager.playerController, icons);
  ui.attach();
  activeUi.manager = ui;
  const hud = new Hud(
    input,
    () => worldManager.playerController,
    icons,
    debug,
    (): DebugOverlaySnapshot | null => {
      const world = worldManager.world;
      const controller = worldManager.playerController;
      const player = controller?.player;
      if (!world || !controller || !player) return null;
      const [x, y, z] = player.pos;
      const blockX = Math.floor(x);
      const blockY = Math.floor(y + player.eye);
      const blockZ = Math.floor(z);
      const angle = (((player.yaw / (Math.PI / 4)) % 8) + 8) % 8;
      const directions = [
        'EAST',
        'SOUTH-EAST',
        'SOUTH',
        'SOUTH-WEST',
        'WEST',
        'NORTH-WEST',
        'NORTH',
        'NORTH-EAST',
      ];
      const interaction = controller.interaction;
      let target = 'NONE';
      if (interaction?.target.hit) {
        const hit = interaction.target;
        target = `${hit.x} ${hit.y} ${hit.z} ${world
          .getBlock(hit.x, hit.y, hit.z)
          .id.toUpperCase()}`;
      }
      return {
        fps: renderStats.fps,
        frameTimes: frameStats.recentFrameTimes(),
        position: [...player.pos],
        chunk: [Math.floor(x / 16), Math.floor(z / 16)],
        facing: directions[Math.round(angle) % directions.length]!,
        biome: world.getBiome(blockX, blockZ),
        light: world.getLight(blockX, blockY, blockZ),
        target,
        render: {
          frameCpuMsP95: renderStats.frameCpuMsP95,
          uploadMsP95: renderStats.uploadMsP95,
          drawCalls: renderStats.drawCalls,
          triangles: renderStats.triangles,
          chunksLoaded: renderStats.chunksLoaded,
          chunksMeshed: renderStats.chunksMeshed,
          chunksVisible: renderStats.chunksVisible,
        },
        workers: worldManager.getWorkerStats(),
      };
    },
    () => worldManager.underwaterView.submerged,
    () => ui.screen !== null,
  );
  hud.attach();
  let frameDrain: FencedErrorDrain | null = null;
  if (debug) {
    frameDrain = new FencedErrorDrain(
      gl,
      () => glWrapper.drainErrors(),
      (fence) => {
        const status = gl.clientWaitSync(fence, 0, 0);
        return status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED;
      },
    );
    const drainNow = () => frameDrain!.drainNow();
    worldManager.drainGlErrors = drainNow;
    setGlErrorDrain(drainNow);
  }

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
  const uploadTimes: number[] = [];

  function render(time: number) {
    // Reads the errors of an earlier frame once the GPU has finished it. Not update or draw
    // submission (SPEC §2.3), so it is outside the frame CPU timer and timed on its own.
    let glCheckMs = 0;
    if (frameDrain) {
      const t = performance.now();
      frameDrain.beginFrame();
      glCheckMs += performance.now() - t;
    }
    const startTime = performance.now();
    const dt = time - lastTime;
    lastTime = time;

    glWrapper.gl.clear(glWrapper.gl.COLOR_BUFFER_BIT | glWrapper.gl.DEPTH_BUFFER_BIT);
    let rendered = false;

    if (testScene) {
      testScene.render(dt / 1000, input);
      rendered = true;
      if (firstFrameResolve) {
        firstFrameResolve();
        firstFrameResolve = null;
      }
    } else if (worldManager.world) {
      playerController.frame(dt / 1000);
      rendered = worldManager.render();
    }

    ui.frame();
    hud.frame(time);

    const endTime = performance.now();
    const frameCpuMs = endTime - startTime;
    if (rendered) cpuTimes.push(frameCpuMs);
    const uploadMs = testScene ? 0 : worldManager.lastUploadMs;
    if (rendered) uploadTimes.push(uploadMs);

    // The fence that lets a later frame read this frame's errors; placed after the timer stopped.
    if (frameDrain) {
      const t = performance.now();
      frameDrain.endFrame();
      glCheckMs += performance.now() - t;
    }
    if (rendered) {
      frameStats.record(frameCpuMs, uploadMs, glCheckMs);
      frameCount++;
    }
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
      // Same one-second window as the frame CPU time
      renderStats.uploadMsP95 = percentile95(uploadTimes);
      uploadTimes.length = 0;
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame((time) => {
    markReady();
    render(time);
    setTimeout(icons, 0);
  });
}

main();

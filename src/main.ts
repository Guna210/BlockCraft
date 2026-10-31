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
import { CreativeInventory } from './ui/creative-inventory';
import { Chat } from './ui/chat';
import { Screenshots } from './ui/screenshot';
import { executeCommand } from './game/commands';
import { commandContext, completionCatalog } from './game/commands/runtime';
import { WorldListScreen, activeWorldList } from './ui/world-list-screen';
import { Hud, type DebugOverlaySnapshot } from './ui/hud';
import { MainMenu, activeMenu } from './ui/main-menu';
import { createSentinelTile } from './render/texture-resolve';
import { registerKilnBlockEntity, type KilnState } from './gameplay/kiln';
import type { BlockEntityInstance } from './world/block-entities';
import './gameplay/chests';
import './gameplay/spawners';
import {
  bedPairAt,
  hostileWithin,
  nextMorningAbsoluteTime,
  sleepRefusalReason,
} from './gameplay/death-beds';
import { getWorldTime } from './world/time';
import { SettingsScreen } from './ui/settings-screen';
import { loadSavedSettings } from './engine/settings-runtime';

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

async function main() {
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
  playerController.onTick = () => worldManager.tickPortals();
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
  const creativeInventory = new CreativeInventory(input, icons);
  ui.onCreativeInventory = () => {
    const player = worldManager.playerController?.player;
    if (!player || input.captured || ui.screen) return false;
    creativeInventory.open(player);
    return true;
  };
  const chat = new Chat(
    input,
    () => !!worldManager.playerController?.player && !worldManager.playerController.player.dead,
    async (line) => {
      try {
        return await executeCommand(line, commandContext(worldManager));
      } catch (error) {
        return { text: error instanceof Error ? error.message : 'Command failed', error: true };
      }
    },
    completionCatalog,
  );
  const screenshots = new Screenshots(
    input,
    () => !!worldManager.playerController?.player,
    (text, error) => chat.message(text, error),
  );
  activeWorldList.screen = new WorldListScreen(input, worldManager);
  const settingsScreen = new SettingsScreen(input);
  const menu = new MainMenu(
    glWrapper,
    camera,
    worldManager,
    () => {
      void activeWorldList.screen?.open();
    },
    () => {
      ui.settingsOverlayOpen = true;
      settingsScreen.show(() => {
        ui.settingsOverlayOpen = false;
        menu.refresh();
      });
    },
  );
  activeMenu.menu = menu;
  // A world created with an empty seed field got a random seed; the player is told which.
  activeWorldList.screen.onWorldCreated = (_name, seed) => ui.showMessage(`Seed: ${seed}`, 5000);
  worldManager.onLeaveMenu = () => menu.hide();
  ui.onSaveAndQuit = async () => {
    await worldManager.quitToMenu();
    menu.show();
  };
  ui.onOpenSettings = () => {
    ui.settingsOverlayOpen = true;
    settingsScreen.show(() => {
      ui.settingsOverlayOpen = false;
    });
  };
  playerController.onDeath = (cause) => {
    chat.close();
    creativeInventory.close();
    ui.showDeath(cause);
  };
  ui.onRespawn = () => playerController.respawn();
  playerController.onUseBlock = (blockId, target) => {
    // Ember Flint lights an empty Lumite frame (M20a).
    if (
      playerController.player?.inventory.held?.id === 'ember_flint' &&
      worldManager.useEmberFlint(target)
    )
      return true;
    if (blockId === 'bed') {
      const player = playerController.player;
      const world = worldManager.world;
      const pair = world && bedPairAt(world, target.x, target.y, target.z);
      if (!player || !world || !pair) {
        ui.showMessage('This bed is incomplete');
        return true;
      }
      player.spawnPoint = [pair.foot[0] + 0.5, pair.foot[1] + 9 / 16, pair.foot[2] + 0.5];
      const refusal = sleepRefusalReason(getWorldTime(), hostileWithin(world, player.pos, 8));
      if (refusal === 'day') ui.showMessage('You can only sleep at night');
      else if (refusal === 'hostile') ui.showMessage('Monsters are nearby');
      else
        ui.fadeToBlackThen(() =>
          worldManager.setTimeOfDay(nextMorningAbsoluteTime(getWorldTime())),
        );
      return true;
    }
    if (blockId === 'workbench') {
      ui.open('crafting');
      return true;
    }
    if (blockId === 'kiln') {
      const entity = worldManager.world?.blockEntities.get(target.x, target.y, target.z);
      if (!entity) return false;
      ui.openKiln(entity as BlockEntityInstance<KilnState>);
      return true;
    }
    if (blockId === 'chest') {
      ui.openChest(target.x, target.y, target.z);
      return true;
    }
    if (blockId === 'dispenser') {
      // Without a screen of its own, using a dispenser loads one held item into it.
      const player = worldManager.playerController?.player;
      const held = player?.inventory.held;
      const world = worldManager.world;
      if (
        player &&
        held &&
        world?.current.mechanics.insertItem(target.x, target.y, target.z, held.id)
      ) {
        if (player.mode === 'survival') player.inventory.consumeSelected();
      }
      return true;
    }
    return false;
  };
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
  playerController.onDamage = (event) => {
    ui.showDamageFlash();
    if (event.healthAfter <= 4) hud.onDamage();
  };
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
    worldManager.leaveMenu();
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

    // With no world and no test scene the only thing on the canvas is the static main menu: its
    // frame stays presented until something on it changes (decisions/M18a-menus.md).
    const idleMenu = !testScene && !worldManager.world && menu.visible && !menu.needsFrame;
    if (!idleMenu)
      glWrapper.gl.clear(glWrapper.gl.COLOR_BUFFER_BIT | glWrapper.gl.DEPTH_BUFFER_BIT);
    let rendered = false;
    // Menu frames (the panorama) are not game frames: they stay out of the frame statistics.
    let measured = true;

    if (testScene) {
      testScene.render(dt / 1000, input);
      rendered = true;
      if (firstFrameResolve) {
        firstFrameResolve();
        firstFrameResolve = null;
      }
    } else if (worldManager.panorama) {
      menu.updateCamera(time);
      rendered = worldManager.render();
      measured = false;
    } else if (worldManager.world) {
      playerController.frame(dt / 1000);
      rendered = worldManager.render();
    }
    if (menu.visible) {
      if (!idleMenu) menu.render();
      measured = false;
    }

    if (rendered && measured && !testScene && worldManager.saves.thumbnailCaptureRequested)
      worldManager.saves.captureThumbnailFrame(canvas);

    if (screenshots.pending && rendered) screenshots.captureAfterRender(canvas);

    ui.frame();
    hud.frame(time);

    const endTime = performance.now();
    const frameCpuMs = endTime - startTime;
    if (rendered && measured) cpuTimes.push(frameCpuMs);
    const uploadMs = testScene ? 0 : worldManager.lastUploadMs;
    if (rendered && measured) uploadTimes.push(uploadMs);

    // The fence that lets a later frame read this frame's errors; placed after the timer stopped.
    if (frameDrain) {
      const t = performance.now();
      frameDrain.endFrame();
      glCheckMs += performance.now() - t;
    }
    if (rendered && measured) {
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

  // The page boots to the main menu; ready() resolves once it is shown and interactive.
  await loadSavedSettings();
  menu.show();
  requestAnimationFrame((time) => {
    markReady();
    render(time);
    setTimeout(icons, 0);
  });
}

void main();

import { registerPlayerApi } from './player';
import { api } from './core';
import { audioApi } from './audio';
import './audio-stats';
import { look } from './camera';
import { showTestScene } from './test-scene';
import { getBlock, setBlock, fill, getBiome, getHeight, worldHash } from './world';
import { locate } from './locate';
import './ore-locate';
import './structure-locate';
import './time';
import './fluids';
import './clouds';
import './leaves';
import './settings';
import './weather';
import './raycast';
import './shapes';
import './mechanics';
import './inventory';
import './ui';
import './death';
import './spawning';
import './entities';
import './explosions';
import './persist';
import './dimension';
import { getLight, getBlockLightRGB } from './light';
import { setDebugLight } from './debug-light';
import { wireframe, setWireframe } from './wireframe';
import { setWorkerPoolSize, getMainThreadGenCount, resetMainThreadGenCount } from './workers';
import {
  setRenderDistance,
  getStreamingStats,
  resetFrameStats,
  getFrameStats,
  getGlResourceCounts,
} from './streaming';
import { WorldManager } from '../../world/world-manager';
import { setXp } from './xp';
import { setVitals } from './vitals';
import { findDebugPath } from './pathfinding';

declare global {
  interface Window {
    __blockcraft?: typeof api;
  }
}

export function initDebugApi() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') {
    registerPlayerApi();
    api.setXp = setXp;
    api.setVitals = setVitals;
    api.audio = audioApi;
    api.look = look;
    api.showTestScene = showTestScene;
    api.getBlock = getBlock;
    api.setBlock = setBlock;
    api.fill = fill;
    api.getBiome = getBiome;
    api.getHeight = getHeight;
    api.getLight = getLight;
    api.getBlockLightRGB = getBlockLightRGB;
    api.setDebugLight = setDebugLight;
    api.locate = locate;
    api.findPath = findDebugPath;
    api.worldHash = worldHash;
    api.setWorkerPoolSize = setWorkerPoolSize;
    api.getMainThreadGenCount = getMainThreadGenCount;
    api.resetMainThreadGenCount = resetMainThreadGenCount;
    api.wireframe = wireframe;
    api.setWireframe = setWireframe;
    api.setRenderDistance = setRenderDistance;
    api.getStreamingStats = getStreamingStats;
    api.resetFrameStats = resetFrameStats;
    api.getFrameStats = getFrameStats;
    api.getGlResourceCounts = getGlResourceCounts;
    api.createWorld = (opts) => WorldManager.getInstance().createWorld(opts);
    api.waitForTerrain = (r) => WorldManager.getInstance().waitForTerrain(r);
    api.getWorkerStats = () => WorldManager.getInstance().getWorkerStats();
    (window as unknown as Record<string, unknown>).WorldManager = WorldManager;
    window.__blockcraft = api;
  }
}

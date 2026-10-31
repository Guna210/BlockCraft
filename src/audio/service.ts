import { settings } from '../engine/settings';
import { deriveSeed, PRNG } from '../engine/rng';
import type { Camera } from '../render/camera';
import type { EntityWorld } from '../entity/ecs/world';
import { EntityKindC, HealthC, TransformC } from '../entity/ecs/components';
import type { Player } from '../entity/player';
import type { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { weatherManager, getWeather } from '../world/weather';
import { soundLibrary } from './recipes';
import { musicSequenceRecipe } from './recipes/music';
import type { SoundRecipe, SoundRecipeContext } from './engine';
import { LCG } from './math';
import { composeSequence } from './music/composer';

export type SoundCategory = 'music' | 'effects' | 'ambient';

export interface SoundPlayOptions {
  pos?: ArrayLike<number>;
  x?: number;
  y?: number;
  z?: number;
  priority?: number;
  category?: SoundCategory;
  volume?: number;
  pitch?: number;
  sequence?: SoundRecipeContext['sequence'];
  duration?: number;
  fadeIn?: number;
  fadeOut?: number;
}

interface Voice {
  id: string;
  category: SoundCategory;
  source: AudioBufferSourceNode;
  panner: PannerNode | null;
  filter: BiquadFilterNode;
  gain: GainNode;
  reverbSend: GainNode;
  x: number;
  y: number;
  z: number;
  positional: boolean;
  importance: number;
  priority: number;
  occluded: boolean | null;
  endsAt: number;
}

interface BufferPreparation {
  id: string;
  recipe: SoundRecipe;
  duration: number;
  sequence?: NonNullable<SoundRecipeContext['sequence']>;
}

interface RecentPlayback {
  time: number;
  x: number;
  y: number;
  z: number;
}

interface PendingPlayback {
  id: string;
  time: number;
  x: number;
  y: number;
  z: number;
  positional: boolean;
  priority: number;
  category?: SoundCategory;
  volume?: number;
  pitch?: number;
  duration?: number;
  fadeIn?: number;
  fadeOut?: number;
}

interface PendingMusic {
  sequence: NonNullable<SoundRecipeContext['sequence']>;
  duration: number;
}

interface CreatureVoiceState {
  nextIdleTick: number;
  hurtActive: boolean;
  dead: boolean;
}

const MAX_VOICES = 32;
const SOUND_RING_SIZE = 64;
const HEARING_DISTANCE = 36;
const IDLE_HEARING_DISTANCE = 24;
const COALESCE_WINDOW_MS = 100;
const COALESCE_DISTANCE_SQUARED = 25;
const PENDING_PLAYBACK_WINDOW_MS = 2500;

const BLOCK_MATERIALS: Record<
  string,
  'grass' | 'sand' | 'gravel' | 'snow' | 'glass' | 'foliage' | 'wood'
> = {
  glass: 'glass',
  blackglass: 'glass',
  red_stained_glass: 'glass',
  orange_stained_glass: 'glass',
  yellow_stained_glass: 'glass',
  green_stained_glass: 'glass',
  cyan_stained_glass: 'glass',
  blue_stained_glass: 'glass',
  purple_stained_glass: 'glass',
  pink_stained_glass: 'glass',
  sand: 'sand',
  red_sand: 'sand',
  gravel: 'gravel',
  snow: 'snow',
  snow_layer: 'snow',
  ice: 'snow',
  packed_ice: 'snow',
  grass_block: 'grass',
  dirt: 'grass',
  coarse_dirt: 'grass',
  mud: 'grass',
  farmland: 'grass',
  mire: 'grass',
  hay_bale: 'grass',
  tall_grass: 'foliage',
  wheat_crop: 'foliage',
  bluebell: 'foliage',
  buttercup: 'foliage',
  marigold: 'foliage',
  violet: 'foliage',
  daisy: 'foliage',
  wild_rose: 'foliage',
  lupine: 'foliage',
  heather: 'foliage',
  sugar_reeds: 'foliage',
  brown_mushroom: 'foliage',
  red_mushroom: 'foliage',
  cactus: 'foliage',
  vine: 'foliage',
  oak_leaves: 'foliage',
  birch_leaves: 'foliage',
  pine_leaves: 'foliage',
  rainwood_leaves: 'foliage',
  acacia_leaves: 'foliage',
  torch: 'wood',
  wall_torch: 'wood',
  inverter_torch: 'wood',
  wooden_button: 'wood',
};

export function blockSoundMaterial(
  id: string,
): 'grass' | 'stone' | 'sand' | 'wood' | 'gravel' | 'snow' | 'glass' | 'foliage' {
  const material = BLOCK_MATERIALS[id];
  if (material) return material;
  const tool = BlockRegistry.getInstance().getBlockDefinition(id)?.tool;
  if (tool === 'axe') return 'wood';
  if (tool === 'shovel') return 'grass';
  if (tool === 'shears/hoe' || tool === 'shears/sword' || tool === 'hoe') return 'foliage';
  return 'stone';
}
/** One browser audio device and mixer for every game sound. */
class AudioService {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private reverbs: Record<SoundCategory, ConvolverNode> | null = null;
  private readonly voices: Voice[] = [];
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly sequenceBuffers = new WeakMap<object, AudioBuffer>();
  private readonly pendingBuffers = new Set<string>();
  private readonly pendingSequences = new WeakSet<object>();
  private readonly failedBuffers = new Set<string>();
  private readonly failedSequences = new WeakSet<object>();
  private readonly bufferQueue: BufferPreparation[] = [];
  private readonly priorityBufferQueue: BufferPreparation[] = [];
  private readonly priorityBufferIds = new Set<string>();
  private readonly prioritySequences = new WeakSet<object>();
  private readonly recentPlaybacks = new Map<string, RecentPlayback>();
  private readonly pendingPlaybacks = new Map<string, PendingPlayback>();
  private bufferPreparationScheduled = false;
  private explosionPlaybackScheduled = false;
  private readonly recentSounds: string[] = Array.from({ length: SOUND_RING_SIZE }, () => '');
  private lastSoundIndex = 0;
  private lastSoundCount = 0;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private listenerYaw = 0;
  private listenerPitch = 0;
  private audioListenerX = Number.NaN;
  private audioListenerY = Number.NaN;
  private audioListenerZ = Number.NaN;
  private audioForwardX = Number.NaN;
  private audioForwardY = Number.NaN;
  private audioForwardZ = Number.NaN;
  private appliedMasterVolume = Number.NaN;
  private appliedMusicVolume = Number.NaN;
  private appliedEffectsVolume = Number.NaN;
  private appliedAmbientVolume = Number.NaN;
  private rayWorld: World | null = null;
  private raycaster: VoxelRaycaster | null = null;
  private positionalVoiceCount = 0;
  private occlusionPhasesDue = 0;
  private occlusionScheduled = false;
  private readonly rayHit = createRayHit();
  private readonly creatures = new Map<number, CreatureVoiceState>();
  private sessionWorld: World | null = null;
  private sessionEcs: EntityWorld | null = null;
  private random = new PRNG(1);
  private tickCount = 0;
  private footstepDistance = 0;
  private lastWalkDistance = 0;
  private previousWeather = 'clear';
  private nextRainTick = 0;
  private lastStrikeSeed = -1;
  private thunderTick = -1;
  private nextFluidTick = 0;
  private nextKilnTick = 0;
  private nextCaveTick = 0;
  private nextMusicTick = 0;
  private pendingMusic: PendingMusic | null = null;
  private caveLevel = 0;
  private targetCaveLevel = 0;
  private appliedReverbLevel = Number.NaN;
  private musicSeed = 0;
  private readonly onGesture = () => this.activateFromGesture();
  private readonly onOcclusionTimer = () => this.flushOcclusion();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.onGesture, { capture: true });
      window.addEventListener('keydown', this.onGesture, { capture: true });
      window.addEventListener('click', this.onGesture, { capture: true });
    }
  }

  getAudioStats(): {
    contextState: AudioContextState | 'not-created';
    activeVoices: number;
    lastSounds: string[];
  } {
    this.pruneVoices();
    const lastSounds: string[] = [];
    const oldest = (this.lastSoundIndex - this.lastSoundCount + SOUND_RING_SIZE) % SOUND_RING_SIZE;
    for (let i = 0; i < this.lastSoundCount; i++)
      lastSounds.push(this.recentSounds[(oldest + i) % SOUND_RING_SIZE]!);
    return {
      contextState: this.context?.state ?? 'not-created',
      activeVoices: this.voices.length,
      lastSounds,
    };
  }

  /** Records before checking gesture activation, so headless tests can inspect attempted events. */
  play(id: string, options: SoundPlayOptions = {}): boolean {
    this.recordSound(id);
    const context = this.context;
    if (!context || context.state !== 'running') return false;
    const recipe = id === 'music.sequence' ? musicSequenceRecipe : soundLibrary[id];
    if (!recipe) return false;

    const positional =
      options.pos !== undefined ||
      options.x !== undefined ||
      options.y !== undefined ||
      options.z !== undefined;
    const x = options.x ?? (positional ? (options.pos?.[0] ?? 0) : this.listenerX);
    const y = options.y ?? (positional ? (options.pos?.[1] ?? 0) : this.listenerY);
    const z = options.z ?? (positional ? (options.pos?.[2] ?? 0) : this.listenerZ);
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    const distance = positional ? Math.hypot(dx, dy, dz) : 0;
    if (positional && distance > HEARING_DISTANCE) return false;

    if (id === 'entity.explosion') {
      for (let i = 0; i < this.voices.length; i++) {
        const voice = this.voices[i]!;
        if (
          voice.id === id &&
          (voice.x - x) ** 2 + (voice.y - y) ** 2 + (voice.z - z) ** 2 <= COALESCE_DISTANCE_SQUARED
        )
          return false;
      }
    }

    const coalesceKey = options.pitch === undefined ? id : `${id}:${options.pitch}`;
    const nowMs = performance.now();
    const recent = this.recentPlaybacks.get(coalesceKey);
    if (
      recent &&
      nowMs - recent.time < COALESCE_WINDOW_MS &&
      (x - recent.x) ** 2 + (y - recent.y) ** 2 + (z - recent.z) ** 2 <= COALESCE_DISTANCE_SQUARED
    )
      return false;
    this.recentPlaybacks.set(coalesceKey, { time: nowMs, x, y, z });

    const sequence = options.sequence;
    if (!sequence && this.failedBuffers.has(id)) return false;
    const buffer = sequence ? this.sequenceBuffers.get(sequence) : this.buffers.get(id);
    if (!buffer) {
      this.queueBufferPreparation(
        {
          id,
          recipe,
          duration: Math.max(recipe.duration, options.duration ?? recipe.duration),
          ...(sequence ? { sequence } : {}),
        },
        true,
      );
      if (!sequence) {
        this.pendingPlaybacks.set(coalesceKey, {
          id,
          time: nowMs,
          x,
          y,
          z,
          positional,
          priority: options.priority ?? this.defaultImportance(id),
          ...(options.category ? { category: options.category } : {}),
          ...(options.volume !== undefined ? { volume: options.volume } : {}),
          ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
          ...(options.duration !== undefined ? { duration: options.duration } : {}),
          ...(options.fadeIn !== undefined ? { fadeIn: options.fadeIn } : {}),
          ...(options.fadeOut !== undefined ? { fadeOut: options.fadeOut } : {}),
        });
      }
      return false;
    }
    if (id === 'entity.explosion') {
      this.pendingPlaybacks.set(coalesceKey, {
        id,
        time: nowMs,
        x,
        y,
        z,
        positional,
        priority: options.priority ?? this.defaultImportance(id),
        ...(options.category ? { category: options.category } : {}),
        ...(options.volume !== undefined ? { volume: options.volume } : {}),
        ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
        ...(options.duration !== undefined ? { duration: options.duration } : {}),
        ...(options.fadeIn !== undefined ? { fadeIn: options.fadeIn } : {}),
        ...(options.fadeOut !== undefined ? { fadeOut: options.fadeOut } : {}),
      });
      this.scheduleExplosionPlayback(buffer);
      return true;
    }
    return this.startVoice(id, recipe, buffer, options, positional, x, y, z, distance);
  }

  private scheduleExplosionPlayback(buffer: AudioBuffer): void {
    if (this.explosionPlaybackScheduled) return;
    this.explosionPlaybackScheduled = true;
    window.setTimeout(() => {
      this.explosionPlaybackScheduled = false;
      this.playPendingBuffer('entity.explosion', buffer);
    }, 0);
  }

  private startVoice(
    id: string,
    recipe: SoundRecipe,
    buffer: AudioBuffer,
    options: SoundPlayOptions | PendingPlayback,
    positional: boolean,
    x: number,
    y: number,
    z: number,
    distance: number,
  ): boolean {
    const context = this.context;
    if (!context || context.state !== 'running') return false;
    this.pruneVoices();
    const importance = Math.max(0, options.priority ?? this.defaultImportance(id));
    const priority = importance / (1 + distance / 10);
    if (this.voices.length >= MAX_VOICES) {
      let lowest = 0;
      for (let i = 1; i < this.voices.length; i++)
        if (this.voices[i]!.priority < this.voices[lowest]!.priority) lowest = i;
      if (priority <= this.voices[lowest]!.priority) return false;
      this.removeVoice(lowest, true);
    }

    this.syncListener(context);
    this.syncVolumes(context);
    const category = options.category ?? this.categoryFor(id);
    const panner = positional ? context.createPanner() : null;
    if (panner) {
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = HEARING_DISTANCE;
      panner.rolloffFactor = 1;
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    }
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 22000;
    const gain = context.createGain();
    const reverbSend = context.createGain();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.25, Math.min(4, options.pitch ?? 1));
    const categoryGain = this.categoryNode(category);
    const duration = Math.max(0.01, options.duration ?? recipe.duration);
    const fadeIn = Math.max(0.005, options.fadeIn ?? 0.01);
    const fadeOut = Math.max(0, options.fadeOut ?? 0);
    reverbSend.gain.value = this.caveLevel * 0.22;
    source.connect(filter);
    if (panner) {
      filter.connect(panner);
      panner.connect(gain);
    } else filter.connect(gain);
    gain.connect(categoryGain);
    gain.connect(reverbSend);
    reverbSend.connect(this.reverbs![category]);
    const startAt = context.currentTime + 0.05;
    const peak = options.volume ?? 1;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + Math.min(fadeIn, duration));
    if (fadeOut > 0 && duration > fadeOut) {
      gain.gain.setValueAtTime(peak, startAt + duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, startAt + duration);
    }
    const voice: Voice = {
      id,
      category,
      source,
      panner,
      filter,
      gain,
      reverbSend,
      x,
      y,
      z,
      positional,
      importance,
      priority,
      occluded: null,
      endsAt: startAt + duration,
    };
    this.voices.push(voice);
    if (positional) this.positionalVoiceCount++;
    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.removeVoice(index, false);
    };
    try {
      source.start(startAt);
      source.stop(startAt + duration);
    } catch (error) {
      this.removeVoice(this.voices.length - 1, true);
      throw error;
    }
    return true;
  }

  /** Listener and live volume gains are refreshed once by the rendered camera frame. */
  updateListener(camera: Camera): void {
    const context = this.context;
    if (!context) return;
    this.listenerX = camera.position[0];
    this.listenerY = camera.position[1];
    this.listenerZ = camera.position[2];
    this.listenerYaw = camera.yaw;
    this.listenerPitch = camera.pitch;
    if (this.voices.length === 0) return;
    if (this.positionalVoiceCount > 0) this.syncListener(context);
    this.syncVolumes(context);
  }

  /** Fixed-tick integration owns source polling, cadence, and rate-limited occlusion. */
  tick(world: World, player: Player, ecs: EntityWorld): void {
    if (world !== this.sessionWorld || ecs !== this.sessionEcs)
      this.startWorldSession(world, ecs, player);
    this.tickCount++;
    this.updateFootsteps(world, player);
    this.updatePlayerEvents(player);
    if (this.tickCount % 4 === 0) this.updateCreatureVoices(ecs, player);
    this.updateOcclusion(world);
    const weather = getWeather();
    if (weather !== this.previousWeather) {
      this.previousWeather = weather;
      if (weather !== 'clear') this.nextRainTick = this.tickCount;
    }
    if (weather !== 'clear' && this.tickCount >= this.nextRainTick) {
      this.play('weather.rain', {
        volume: weather === 'thunder' ? 0.68 : 0.52,
        category: 'ambient',
        priority: 0.7,
      });
      this.nextRainTick = this.tickCount + 32;
    }
    this.updateThunder(player);
    if (this.tickCount % 20 === 0) this.updateEnvironment(world, player);
    this.updateCaveLevel();
    if (this.tickCount % 4 === 0) this.updateReverbSends();
    if (this.tickCount >= this.nextMusicTick) this.scheduleMusic(world, player);
  }

  private activateFromGesture(): void {
    if (typeof AudioContext === 'undefined') return;
    if (this.context) {
      void this.resumeFromGesture(this.context);
      return;
    }
    const context = new AudioContext();
    this.context = context;
    this.masterGain = context.createGain();
    this.musicGain = context.createGain();
    this.effectsGain = context.createGain();
    this.ambientGain = context.createGain();
    this.reverbs = {
      music: context.createConvolver(),
      effects: context.createConvolver(),
      ambient: context.createConvolver(),
    };
    const length = Math.ceil(context.sampleRate * 1.35);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    const random = new LCG(0x16b0cafe);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = random.nextFloat(-1, 1) * (1 - i / length) ** 3;
    }
    this.reverbs.music.buffer = impulse;
    this.reverbs.effects.buffer = impulse;
    this.reverbs.ambient.buffer = impulse;
    this.musicGain.connect(this.masterGain);
    this.effectsGain.connect(this.masterGain);
    this.ambientGain.connect(this.masterGain);
    this.reverbs.music.connect(this.musicGain);
    this.reverbs.effects.connect(this.effectsGain);
    this.reverbs.ambient.connect(this.ambientGain);
    this.masterGain.connect(context.destination);
    this.masterGain.gain.value = settings.masterVolume;
    this.musicGain.gain.value = settings.musicVolume;
    this.effectsGain.gain.value = settings.effectsVolume;
    this.ambientGain.gain.value = settings.ambientVolume;
    this.appliedMasterVolume = settings.masterVolume;
    this.appliedMusicVolume = settings.musicVolume;
    this.appliedEffectsVolume = settings.effectsVolume;
    this.appliedAmbientVolume = settings.ambientVolume;
    this.prewarmRecipeBuffers();
    void this.resumeFromGesture(context);
  }

  private async resumeFromGesture(context: AudioContext): Promise<void> {
    try {
      await context.resume();
      if (context.state !== 'running') return;
      window.removeEventListener('pointerdown', this.onGesture, { capture: true });
      window.removeEventListener('keydown', this.onGesture, { capture: true });
      window.removeEventListener('click', this.onGesture, { capture: true });
    } catch {
      // Keep the gesture listeners so a later user action can retry a blocked resume.
    }
  }

  private startWorldSession(world: World, ecs: EntityWorld, player: Player): void {
    this.sessionWorld = world;
    this.sessionEcs = ecs;
    this.tickCount = 0;
    this.footstepDistance = 0;
    this.lastWalkDistance = player.walkDistance;
    this.previousWeather = 'clear';
    this.nextRainTick = 0;
    this.lastStrikeSeed = -1;
    this.thunderTick = -1;
    this.nextFluidTick = 0;
    this.nextKilnTick = 0;
    this.nextCaveTick = 60;
    this.nextMusicTick = 20;
    this.pendingMusic = null;
    this.caveLevel = 0;
    this.targetCaveLevel = 0;
    this.musicSeed = world.worldSeed;
    this.creatures.clear();
    this.random = new PRNG(deriveSeed(world.worldSeed, 'audio-integration'));
    this.rayWorld = world;
    this.raycaster = new VoxelRaycaster(world);
    this.occlusionPhasesDue = 0;
  }

  private prewarmRecipeBuffers(): void {
    const recipe = soundLibrary['entity.explosion'];
    if (recipe)
      this.queueBufferPreparation({ id: 'entity.explosion', recipe, duration: recipe.duration });
  }

  private queueBufferPreparation(request: BufferPreparation, prioritize = false): void {
    if (request.sequence) {
      if (this.sequenceBuffers.has(request.sequence) || this.failedSequences.has(request.sequence))
        return;
      if (this.pendingSequences.has(request.sequence)) {
        if (prioritize && !this.prioritySequences.has(request.sequence)) {
          this.prioritySequences.add(request.sequence);
          this.priorityBufferQueue.push(request);
          this.scheduleBufferPreparation();
        }
        return;
      }
      this.pendingSequences.add(request.sequence);
    } else {
      if (this.buffers.has(request.id) || this.failedBuffers.has(request.id)) return;
      if (this.pendingBuffers.has(request.id)) {
        if (prioritize && !this.priorityBufferIds.has(request.id)) {
          this.priorityBufferIds.add(request.id);
          this.priorityBufferQueue.push(request);
          this.scheduleBufferPreparation();
        }
        return;
      }
      this.pendingBuffers.add(request.id);
    }
    if (prioritize) {
      if (request.sequence) this.prioritySequences.add(request.sequence);
      else this.priorityBufferIds.add(request.id);
      this.priorityBufferQueue.push(request);
    } else this.bufferQueue.push(request);
    this.scheduleBufferPreparation();
  }

  private scheduleBufferPreparation(): void {
    if (
      this.bufferPreparationScheduled ||
      (this.priorityBufferQueue.length === 0 && this.bufferQueue.length === 0)
    )
      return;
    this.bufferPreparationScheduled = true;
    const run = () => {
      this.bufferPreparationScheduled = false;
      const request = this.priorityBufferQueue.shift() ?? this.bufferQueue.shift();
      if (!request) return;
      const cached = request.sequence
        ? this.sequenceBuffers.has(request.sequence)
        : this.buffers.has(request.id);
      if (cached) {
        if (request.sequence) this.prioritySequences.delete(request.sequence);
        else this.priorityBufferIds.delete(request.id);
        this.scheduleBufferPreparation();
        return;
      }
      void this.renderBuffer(request).finally(() => {
        if (request.sequence) this.prioritySequences.delete(request.sequence);
        else this.priorityBufferIds.delete(request.id);
        this.scheduleBufferPreparation();
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(run, { timeout: 250 });
    else window.setTimeout(run, 0);
  }

  private async renderBuffer(request: BufferPreparation): Promise<void> {
    const cacheKey = request.sequence ? null : request.id;
    let rendered: AudioBuffer | null = null;
    try {
      if (typeof OfflineAudioContext === 'undefined') return;
      const sampleRate = this.context?.sampleRate ?? 44100;
      const frameCount = Math.max(1, Math.ceil(request.duration * sampleRate));
      const offline = new OfflineAudioContext(2, frameCount, sampleRate);
      request.recipe.render({
        ctx: offline,
        t0: 0,
        random: new LCG(deriveSeed(0x16b0cafe, request.id)),
        ...(request.sequence ? { sequence: request.sequence } : {}),
      });
      rendered = await offline.startRendering();
      if (request.sequence) this.sequenceBuffers.set(request.sequence, rendered);
      else this.buffers.set(request.id, rendered);
    } catch {
      // A sound that cannot be rendered is silently unavailable; play() remains bounded and safe.
      if (request.sequence) this.failedSequences.add(request.sequence);
      else this.failedBuffers.add(request.id);
    } finally {
      if (request.sequence) this.pendingSequences.delete(request.sequence);
      else if (cacheKey) this.pendingBuffers.delete(cacheKey);
    }
    if (rendered && request.sequence) this.tryStartPendingMusic(request.sequence);
    else if (rendered) this.playPendingBuffer(request.id, rendered);
  }

  private playPendingBuffer(id: string, buffer: AudioBuffer): void {
    const now = performance.now();
    const recipe = soundLibrary[id];
    if (!recipe) return;
    for (const [key, pending] of this.pendingPlaybacks) {
      if (pending.id !== id) continue;
      this.pendingPlaybacks.delete(key);
      if (now - pending.time > PENDING_PLAYBACK_WINDOW_MS) continue;
      if (!this.context || this.context.state !== 'running') continue;
      const dx = pending.x - this.listenerX;
      const dy = pending.y - this.listenerY;
      const dz = pending.z - this.listenerZ;
      const distance = pending.positional ? Math.hypot(dx, dy, dz) : 0;
      if (pending.positional && distance > HEARING_DISTANCE) continue;
      this.startVoice(
        id,
        recipe,
        buffer,
        pending,
        pending.positional,
        pending.x,
        pending.y,
        pending.z,
        distance,
      );
    }
  }

  private updateFootsteps(world: World, player: Player): void {
    const distance = player.walkDistance;
    const walked = distance - this.lastWalkDistance;
    this.lastWalkDistance = distance;
    if (walked > 4 || walked < 0) {
      this.footstepDistance = 0;
      return;
    }
    if (!player.onGround || player.detached || player.flying || player.climbing) {
      this.footstepDistance = 0;
      return;
    }
    this.footstepDistance += walked;
    if (this.footstepDistance < 1.25) return;
    this.footstepDistance %= 1.25;
    let id: string;
    if (player.inFluid === 'water') id = 'footstep.water';
    else {
      const state = world.getBlockStateId(
        Math.floor(player.pos[0]),
        Math.floor(player.pos[1] - 0.05),
        Math.floor(player.pos[2]),
      );
      const blockId = BlockRegistry.getInstance().getResolvedState(state)?.blockId ?? 'grass_block';
      id = this.footstepForBlock(blockId);
    }
    this.play(id, { x: player.pos[0], y: player.pos[1] + 0.1, z: player.pos[2], priority: 0.9 });
  }

  private updatePlayerEvents(player: Player): void {
    const eatingTicks = player.survival.eatingTicks;
    if (player.isEating && eatingTicks > 0 && eatingTicks % 8 === 1)
      this.play('item.eat', {
        x: player.pos[0],
        y: player.pos[1] + player.eye,
        z: player.pos[2],
        priority: 0.8,
      });
  }

  private updateCreatureVoices(ecs: EntityWorld, player: Player): void {
    for (const id of ecs.query(EntityKindC, TransformC, HealthC)) {
      const kind = ecs.get(id, EntityKindC)!;
      const pos = ecs.get(id, TransformC)!.pos;
      const health = ecs.get(id, HealthC)!;
      let state = this.creatures.get(id);
      if (!state) {
        state = {
          nextIdleTick: this.tickCount + 60 + Math.floor(this.random.next() * 180),
          hurtActive: false,
          dead: false,
        };
        this.creatures.set(id, state);
      }
      const distance = Math.hypot(
        pos[0] - player.pos[0],
        pos[1] - (player.pos[1] + player.eye),
        pos[2] - player.pos[2],
      );
      if (distance <= HEARING_DISTANCE && health.hurtTicks > 0 && !state.hurtActive)
        this.play(`creature.${kind.type}.hurt`, { pos, priority: 1.3 });
      state.hurtActive = health.hurtTicks > 0;
      if (health.current <= 0 && !state.dead) {
        if (distance <= HEARING_DISTANCE)
          this.play(`creature.${kind.type}.death`, { pos, priority: 1.6 });
        state.dead = true;
      }
      if (!state.dead && this.tickCount >= state.nextIdleTick) {
        if (distance <= IDLE_HEARING_DISTANCE)
          this.play(`creature.${kind.type}.idle`, { pos, priority: 0.45 });
        state.nextIdleTick = this.tickCount + 80 + Math.floor(this.random.next() * 220);
      }
    }
    for (const id of this.creatures.keys()) if (!ecs.exists(id)) this.creatures.delete(id);
  }

  private updateOcclusion(world: World): void {
    if (this.positionalVoiceCount === 0 || !this.context) return;
    const phase = this.tickCount & 3;
    let hasPositionalVoiceInPhase = false;
    for (let i = phase; i < this.voices.length; i += 4) {
      if (this.voices[i]!.positional) {
        hasPositionalVoiceInPhase = true;
        break;
      }
    }
    if (!hasPositionalVoiceInPhase) return;
    if (!this.raycaster || this.rayWorld !== world) {
      this.rayWorld = world;
      this.raycaster = new VoxelRaycaster(world);
    }
    this.occlusionPhasesDue |= 1 << phase;
    if (this.occlusionScheduled) return;
    this.occlusionScheduled = true;
    window.setTimeout(this.onOcclusionTimer, 0);
  }

  private flushOcclusion(): void {
    this.occlusionScheduled = false;
    const voiceCount = this.voices.length;
    const phasesDue = this.occlusionPhasesDue;
    this.occlusionPhasesDue = 0;
    if (this.positionalVoiceCount === 0 || !this.context || !this.raycaster) return;
    const context = this.context;
    const now = context.currentTime;
    for (let phase = 0; phase < 4; phase++) {
      if ((phasesDue & (1 << phase)) === 0) continue;
      for (let i = phase; i < voiceCount; i += 4) {
        const voice = this.voices[i]!;
        if (!voice.positional) continue;
        const dx = voice.x - this.listenerX;
        const dy = voice.y - this.listenerY;
        const dz = voice.z - this.listenerZ;
        const distance = Math.hypot(dx, dy, dz);
        voice.priority = voice.importance / (1 + distance / 10);
        if (distance < 1.5) continue;
        this.raycaster.cast(
          this.listenerX,
          this.listenerY,
          this.listenerZ,
          dx,
          dy,
          dz,
          distance - 0.2,
          this.rayHit,
        );
        const blocked = this.rayHit.hit;
        if (voice.occluded !== blocked) {
          voice.occluded = blocked;
          voice.filter.frequency.setTargetAtTime(blocked ? 820 : 22000, now, 0.16);
        }
      }
    }
  }

  private updateEnvironment(world: World, player: Player): void {
    let fluid: string | null = player.inFluid;
    let fluidX = player.pos[0];
    let fluidY = player.pos[1] + 0.6;
    let fluidZ = player.pos[2];
    if (!fluid) {
      const registry = BlockRegistry.getInstance();
      let nearest = Infinity;
      for (let y = Math.floor(player.pos[1]) - 1; y <= Math.floor(player.pos[1]) + 2; y++)
        for (let z = Math.floor(player.pos[2]) - 4; z <= Math.floor(player.pos[2]) + 4; z++)
          for (let x = Math.floor(player.pos[0]) - 4; x <= Math.floor(player.pos[0]) + 4; x++) {
            const id = registry.getResolvedState(world.getBlockStateId(x, y, z))?.blockId;
            if (id !== 'water' && id !== 'lava') continue;
            const distance =
              (x + 0.5 - player.pos[0]) ** 2 +
              (y + 0.5 - player.pos[1]) ** 2 +
              (z + 0.5 - player.pos[2]) ** 2;
            if (distance < nearest) {
              nearest = distance;
              fluid = id;
              fluidX = x + 0.5;
              fluidY = y + 0.5;
              fluidZ = z + 0.5;
            }
          }
    }
    if (fluid && this.tickCount >= this.nextFluidTick) {
      this.play('ambience.fluid', {
        x: fluidX,
        y: fluidY,
        z: fluidZ,
        category: 'ambient',
        volume: fluid === 'lava' ? 0.55 : 0.35,
        priority: 0.35,
      });
      this.nextFluidTick = this.tickCount + 90;
    }

    const blockEntities = world.blockEntities.getAll();
    let kilnX = 0,
      kilnY = 0,
      kilnZ = 0,
      kilnDistance = Infinity;
    for (let i = 0; i < blockEntities.length; i++) {
      const entity = blockEntities[i]!;
      if (entity.blockId !== 'kiln') continue;
      const block = world.getBlock(entity.x, entity.y, entity.z);
      if (String(block.state.lit) !== 'true') continue;
      const distance = Math.hypot(
        entity.x + 0.5 - player.pos[0],
        entity.y + 0.5 - player.pos[1],
        entity.z + 0.5 - player.pos[2],
      );
      if (distance < kilnDistance) {
        kilnDistance = distance;
        kilnX = entity.x + 0.5;
        kilnY = entity.y + 0.5;
        kilnZ = entity.z + 0.5;
      }
    }
    if (kilnDistance <= 12 && this.tickCount >= this.nextKilnTick) {
      this.play('mechanism.kiln_crackle', {
        x: kilnX,
        y: kilnY,
        z: kilnZ,
        category: 'ambient',
        volume: 0.6,
        priority: 0.3,
      });
      this.nextKilnTick = this.tickCount + 9;
    }

    if (!world.lightEngine) {
      this.targetCaveLevel = 0;
      return;
    }
    const x = Math.floor(player.pos[0]);
    const y = Math.floor(player.pos[1]);
    const z = Math.floor(player.pos[2]);
    const skyLight = world.getLight(x, y, z).sky;
    const underground = y < world.getHeight(x, z) - 2 && skyLight <= 7;
    this.targetCaveLevel = underground ? 1 : 0;
    if (underground && this.tickCount >= this.nextCaveTick) {
      this.play('ambience.cave', {
        x: player.pos[0] + (this.random.next() - 0.5) * 8,
        y: player.pos[1] + 1,
        z: player.pos[2] + (this.random.next() - 0.5) * 8,
        category: 'ambient',
        volume: 0.3,
        priority: 0.25,
      });
      this.nextCaveTick = this.tickCount + 100 + Math.floor(this.random.next() * 180);
    }
  }

  private updateCaveLevel(): void {
    this.caveLevel += (this.targetCaveLevel - this.caveLevel) * 0.025;
  }

  private updateReverbSends(): void {
    const context = this.context;
    if (!context) return;
    const target = this.caveLevel * 0.22;
    if (Math.abs(target - this.appliedReverbLevel) < 0.001) return;
    this.appliedReverbLevel = target;
    const now = context.currentTime;
    for (let i = 0; i < this.voices.length; i++)
      this.voices[i]!.reverbSend.gain.setTargetAtTime(target, now, 0.25);
  }

  private updateThunder(player: Player): void {
    const strike = weatherManager.activeStrike;
    if (strike && strike.seed !== this.lastStrikeSeed) {
      this.lastStrikeSeed = strike.seed;
      const distance = Math.hypot(
        strike.end[0] - player.pos[0],
        strike.end[1] - (player.pos[1] + player.eye),
        strike.end[2] - player.pos[2],
      );
      this.thunderTick = this.tickCount + Math.round((distance / 343) * 20);
    }
    if (this.thunderTick >= 0 && this.tickCount >= this.thunderTick) {
      const end = strike?.end;
      this.play('weather.thunder', {
        ...(end ? { pos: end } : {}),
        category: 'ambient',
        priority: 1.2,
      });
      this.thunderTick = -1;
    }
  }

  private scheduleMusic(world: World, player: Player): void {
    if (!this.context || this.context.state !== 'running') {
      this.nextMusicTick = this.tickCount + 20;
      return;
    }
    const hasMusic = this.voices.some((voice) => voice.id === 'music.sequence');
    if (hasMusic) {
      this.nextMusicTick = this.tickCount + 20;
      return;
    }
    if (!this.pendingMusic) {
      const contextId =
        player.dimension !== 'overworld'
          ? player.dimension
          : world.getBiome(player.pos[0], player.pos[2]);
      const seed = `${this.musicSeed}:${Math.floor(this.random.next() * 0xffffffff)}`;
      const sequence = composeSequence(seed, contextId);
      let duration = 0;
      for (const event of sequence.events)
        duration = Math.max(
          duration,
          ((event.startTime + event.durationInBeats) * 60) / sequence.tempo,
        );
      this.pendingMusic = { sequence, duration: Math.max(1, duration) };
      this.queueBufferPreparation(
        {
          id: 'music.sequence',
          recipe: musicSequenceRecipe,
          duration: this.pendingMusic.duration + 2,
          sequence,
        },
        true,
      );
    }

    const pending = this.pendingMusic;
    if (!pending) return;
    if (this.failedSequences.has(pending.sequence)) {
      this.pendingMusic = null;
      this.nextMusicTick = this.tickCount + 1200;
      return;
    }
    if (!this.sequenceBuffers.has(pending.sequence)) {
      this.nextMusicTick = this.tickCount + 20;
      return;
    }
    this.tryStartPendingMusic(pending.sequence);
  }

  private tryStartPendingMusic(sequence: NonNullable<SoundRecipeContext['sequence']>): boolean {
    const pending = this.pendingMusic;
    if (
      !pending ||
      pending.sequence !== sequence ||
      !this.context ||
      this.context.state !== 'running' ||
      !this.sequenceBuffers.has(sequence)
    )
      return false;
    if (this.voices.some((voice) => voice.id === 'music.sequence')) return false;
    const started = this.play('music.sequence', {
      sequence: pending.sequence,
      category: 'music',
      duration: pending.duration + 2,
      fadeIn: 2,
      fadeOut: 2,
      priority: 0.2,
    });
    if (!started) {
      this.nextMusicTick = this.tickCount + 20;
      return false;
    }
    this.pendingMusic = null;
    const totalInterval = Math.floor(1200 + this.random.next() * 1200);
    const pieceTicks = Math.ceil((pending.duration + 2) * 20);
    this.nextMusicTick = this.tickCount + Math.max(20, totalInterval - pieceTicks);
    return true;
  }

  private footstepForBlock(id: string): string {
    const material = blockSoundMaterial(id);
    if (material === 'foliage') return 'footstep.grass';
    if (material === 'glass') return 'footstep.stone';
    return `footstep.${material}`;
  }

  private categoryFor(id: string): SoundCategory {
    if (id.startsWith('weather.') || id.startsWith('ambience.') || id === 'mechanism.kiln_crackle')
      return 'ambient';
    return 'effects';
  }

  private defaultImportance(id: string): number {
    if (id.includes('.death') || id === 'entity.explosion' || id === 'player.death') return 2;
    if (id.includes('.hurt') || id === 'player.hurt' || id === 'weather.thunder') return 1.3;
    if (id.startsWith('footstep.')) return 0.55;
    if (id.startsWith('music.')) return 0.2;
    return 0.8;
  }

  private categoryNode(category: SoundCategory): GainNode {
    if (category === 'music') return this.musicGain!;
    if (category === 'ambient') return this.ambientGain!;
    return this.effectsGain!;
  }

  private recordSound(id: string): void {
    this.recentSounds[this.lastSoundIndex] = id;
    this.lastSoundIndex = (this.lastSoundIndex + 1) % SOUND_RING_SIZE;
    this.lastSoundCount = Math.min(SOUND_RING_SIZE, this.lastSoundCount + 1);
  }

  private pruneVoices(): void {
    const now = this.context?.currentTime ?? 0;
    for (let i = this.voices.length - 1; i >= 0; i--)
      if (now >= this.voices[i]!.endsAt) this.removeVoice(i, false);
  }

  private removeVoice(index: number, fade: boolean): void {
    const voice = this.voices[index];
    if (!voice) return;
    this.voices.splice(index, 1);
    if (voice.positional) this.positionalVoiceCount--;
    if (fade && this.context) {
      const now = this.context.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.012);
    }
    try {
      voice.source.stop();
    } catch {
      // A naturally ended or not-yet-started source may already be stopped.
    }
    voice.source.disconnect();
    voice.filter.disconnect();
    voice.panner?.disconnect();
    voice.gain.disconnect();
    voice.reverbSend.disconnect();
  }

  private syncListener(context: AudioContext): void {
    const listener = context.listener;
    const now = context.currentTime;
    if (this.audioListenerX !== this.listenerX) {
      this.setParam(listener.positionX, this.listenerX, now);
      this.audioListenerX = this.listenerX;
    }
    if (this.audioListenerY !== this.listenerY) {
      this.setParam(listener.positionY, this.listenerY, now);
      this.audioListenerY = this.listenerY;
    }
    if (this.audioListenerZ !== this.listenerZ) {
      this.setParam(listener.positionZ, this.listenerZ, now);
      this.audioListenerZ = this.listenerZ;
    }
    const cosPitch = Math.cos(this.listenerPitch);
    const forwardX = Math.cos(this.listenerYaw) * cosPitch;
    const forwardY = Math.sin(this.listenerPitch);
    const forwardZ = Math.sin(this.listenerYaw) * cosPitch;
    if (this.audioForwardX !== forwardX) {
      this.setParam(listener.forwardX, forwardX, now);
      this.audioForwardX = forwardX;
    }
    if (this.audioForwardY !== forwardY) {
      this.setParam(listener.forwardY, forwardY, now);
      this.audioForwardY = forwardY;
    }
    if (this.audioForwardZ !== forwardZ) {
      this.setParam(listener.forwardZ, forwardZ, now);
      this.audioForwardZ = forwardZ;
    }
  }

  private syncVolumes(context: AudioContext): void {
    const now = context.currentTime;
    if (this.appliedMasterVolume !== settings.masterVolume) {
      this.setParam(this.masterGain!.gain, settings.masterVolume, now);
      this.appliedMasterVolume = settings.masterVolume;
    }
    if (this.appliedMusicVolume !== settings.musicVolume) {
      this.setParam(this.musicGain!.gain, settings.musicVolume, now);
      this.appliedMusicVolume = settings.musicVolume;
    }
    if (this.appliedEffectsVolume !== settings.effectsVolume) {
      this.setParam(this.effectsGain!.gain, settings.effectsVolume, now);
      this.appliedEffectsVolume = settings.effectsVolume;
    }
    if (this.appliedAmbientVolume !== settings.ambientVolume) {
      this.setParam(this.ambientGain!.gain, settings.ambientVolume, now);
      this.appliedAmbientVolume = settings.ambientVolume;
    }
  }

  private setParam(param: AudioParam, value: number, now: number): void {
    param.setTargetAtTime(Math.max(0, value), now, 0.04);
  }
}

export const sound = new AudioService();

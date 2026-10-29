import { settings } from '../engine/settings';
import { deriveSeed, PRNG } from '../engine/rng';
import type { Camera } from '../render/camera';
import type { EntityWorld } from '../entity/ecs/world';
import { EntityKindC, HealthC, TransformC } from '../entity/ecs/components';
import type { Player } from '../entity/player';
import type { ItemEntity, ItemEntityManager } from '../entity/item-entity';
import type { World } from '../world/world';
import { BlockRegistry } from '../world/blocks/registry';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { weatherManager, getWeather } from '../world/weather';
import { soundLibrary } from './recipes';
import { musicSequenceRecipe } from './recipes/music';
import type { SoundRecipeContext } from './engine';
import { LCG } from './math';
import { composeSequence } from './music/composer';

export type SoundCategory = 'music' | 'effects' | 'ambient';

export interface SoundPlayOptions {
  pos?: ArrayLike<number>;
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
  panner: PannerNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  reverbSend: GainNode;
  x: number;
  y: number;
  z: number;
  positional: boolean;
  importance: number;
  priority: number;
  endsAt: number;
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

export function blockSoundMaterial(
  id: string,
): 'grass' | 'stone' | 'sand' | 'wood' | 'gravel' | 'snow' | 'glass' | 'foliage' {
  if (/glass|crystal/.test(id)) return 'glass';
  if (/sand|sandstone/.test(id)) return 'sand';
  if (/gravel/.test(id)) return 'gravel';
  if (/snow|ice/.test(id)) return 'snow';
  if (/log|plank|wood|stem|bark|fence|door/.test(id)) return 'wood';
  if (/leaf|foliage|fern|flower|grass$|rose|mushroom|vine/.test(id)) return 'foliage';
  if (/grass|moss|dirt|soil|mud/.test(id)) return 'grass';
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
  private readonly recentSounds: string[] = Array.from({ length: SOUND_RING_SIZE }, () => '');
  private lastSoundIndex = 0;
  private lastSoundCount = 0;
  private voiceSeed = 0;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private forwardX = 1;
  private forwardY = 0;
  private forwardZ = 0;
  private rayWorld: World | null = null;
  private raycaster: VoxelRaycaster | null = null;
  private readonly rayHit = createRayHit();
  private readonly creatures = new Map<number, CreatureVoiceState>();
  private readonly activeItems = new Map<ItemEntity, number>();
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
  private caveLevel = 0;
  private targetCaveLevel = 0;
  private musicSeed = 0;
  private readonly onGesture = () => this.activateFromGesture();

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
    const recipe = id === 'music.sequence' ? musicSequenceRecipe : soundLibrary[id];
    const context = this.context;
    if (!recipe || !context || context.state !== 'running') return false;
    this.pruneVoices();

    const positional = options.pos !== undefined;
    const x = positional ? (options.pos?.[0] ?? 0) : this.listenerX;
    const y = positional ? (options.pos?.[1] ?? 0) : this.listenerY;
    const z = positional ? (options.pos?.[2] ?? 0) : this.listenerZ;
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    const distance = positional ? Math.hypot(dx, dy, dz) : 0;
    if (positional && distance > HEARING_DISTANCE) return false;
    const importance = Math.max(0, options.priority ?? this.defaultImportance(id));
    const priority = importance / (1 + distance / 10);
    if (this.voices.length >= MAX_VOICES) {
      let lowest = 0;
      for (let i = 1; i < this.voices.length; i++)
        if (this.voices[i]!.priority < this.voices[lowest]!.priority) lowest = i;
      if (priority <= this.voices[lowest]!.priority) return false;
      this.removeVoice(lowest, true);
    }

    const category = options.category ?? this.categoryFor(id);
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = HEARING_DISTANCE;
    panner.rolloffFactor = 1;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 22000;
    const gain = context.createGain();
    const reverbSend = context.createGain();
    const categoryGain = this.categoryNode(category);
    const duration = Math.max(0.01, options.duration ?? recipe.duration);
    const fadeIn = Math.max(0.005, options.fadeIn ?? 0.01);
    const fadeOut = Math.max(0, options.fadeOut ?? 0);
    const now = context.currentTime;
    const peak = options.volume ?? 1;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + Math.min(fadeIn, duration));
    if (fadeOut > 0 && duration > fadeOut) {
      gain.gain.setValueAtTime(peak, now + duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, now + duration);
    }
    reverbSend.gain.value = this.caveLevel * 0.22;
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(categoryGain);
    gain.connect(reverbSend);
    reverbSend.connect(this.reverbs![category]);
    const voice: Voice = {
      id,
      category,
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
      endsAt: now + duration,
    };
    this.voices.push(voice);
    try {
      const seed =
        (Math.imul(++this.voiceSeed, 1103515245) + (this.sessionWorld?.worldSeed ?? 42)) >>> 0;
      const renderContext: SoundRecipeContext = {
        ctx: context,
        t0: now,
        random: new LCG(seed),
        output: filter,
        ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
        ...(options.sequence ? { sequence: options.sequence } : {}),
      };
      recipe.render(renderContext);
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
    const listener = context.listener;
    this.listenerX = camera.position[0];
    this.listenerY = camera.position[1];
    this.listenerZ = camera.position[2];
    const cosPitch = Math.cos(camera.pitch);
    this.forwardX = Math.cos(camera.yaw) * cosPitch;
    this.forwardY = Math.sin(camera.pitch);
    this.forwardZ = Math.sin(camera.yaw) * cosPitch;
    this.setParam(listener.positionX, this.listenerX, context.currentTime);
    this.setParam(listener.positionY, this.listenerY, context.currentTime);
    this.setParam(listener.positionZ, this.listenerZ, context.currentTime);
    this.setParam(listener.forwardX, this.forwardX, context.currentTime);
    this.setParam(listener.forwardY, this.forwardY, context.currentTime);
    this.setParam(listener.forwardZ, this.forwardZ, context.currentTime);
    this.setParam(listener.upX, 0, context.currentTime);
    this.setParam(listener.upY, 1, context.currentTime);
    this.setParam(listener.upZ, 0, context.currentTime);
    this.setParam(this.masterGain!.gain, settings.masterVolume, context.currentTime);
    this.setParam(this.musicGain!.gain, settings.musicVolume, context.currentTime);
    this.setParam(this.effectsGain!.gain, settings.effectsVolume, context.currentTime);
    this.setParam(this.ambientGain!.gain, settings.ambientVolume, context.currentTime);

    this.pruneVoices();
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]!;
      if (!voice.positional) {
        voice.panner.positionX.value = this.listenerX;
        voice.panner.positionY.value = this.listenerY;
        voice.panner.positionZ.value = this.listenerZ;
      }
    }
  }

  /** Fixed-tick integration owns source polling, cadence, and rate-limited occlusion. */
  tick(world: World, player: Player, ecs: EntityWorld, items: ItemEntityManager): void {
    if (world !== this.sessionWorld || ecs !== this.sessionEcs)
      this.startWorldSession(world, ecs, player);
    this.tickCount++;
    this.pruneVoices();
    this.updateFootsteps(world, player);
    this.updatePlayerEvents(player, items);
    if (this.tickCount % 4 === 0) {
      this.updateCreatureVoices(ecs, player);
      this.updateOcclusion(world);
    }
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
    if (this.context || typeof AudioContext === 'undefined') return;
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
    void context.resume().catch(() => {});
    window.removeEventListener('pointerdown', this.onGesture, { capture: true });
    window.removeEventListener('keydown', this.onGesture, { capture: true });
    window.removeEventListener('click', this.onGesture, { capture: true });
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
    this.nextMusicTick = 600;
    this.caveLevel = 0;
    this.targetCaveLevel = 0;
    this.musicSeed = world.worldSeed;
    this.creatures.clear();
    this.activeItems.clear();
    this.random = new PRNG(deriveSeed(world.worldSeed, 'audio-integration'));
    this.rayWorld = world;
    this.raycaster = new VoxelRaycaster(world);
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
    this.play(id, { pos: [player.pos[0], player.pos[1] + 0.1, player.pos[2]], priority: 0.9 });
  }

  private updatePlayerEvents(player: Player, items: ItemEntityManager): void {
    const eatingTicks = player.survival.eatingTicks;
    if (player.isEating && eatingTicks > 0 && eatingTicks % 8 === 1)
      this.play('item.eat', {
        pos: [player.pos[0], player.pos[1] + player.eye, player.pos[2]],
        priority: 0.8,
      });
    for (let i = 0; i < items.pool.length; i++) {
      const item = items.pool[i]!;
      const previousId = this.activeItems.get(item);
      if (item.active) this.activeItems.set(item, item.id);
      else if (previousId !== undefined) {
        this.activeItems.delete(item);
        if (item.id === previousId && item.age < 6000)
          this.play('item.pickup', { pos: [item.pos[0], item.pos[1], item.pos[2]], priority: 0.7 });
      }
    }
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
    if (!this.raycaster || this.rayWorld !== world) {
      this.rayWorld = world;
      this.raycaster = new VoxelRaycaster(world);
    }
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (let i = 0; i < this.voices.length; i++) {
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
      voice.filter.frequency.setTargetAtTime(blocked ? 820 : 22000, now, 0.16);
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
        pos: [fluidX, fluidY, fluidZ],
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
        pos: [kilnX, kilnY, kilnZ],
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
        pos: [
          player.pos[0] + (this.random.next() - 0.5) * 8,
          player.pos[1] + 1,
          player.pos[2] + (this.random.next() - 0.5) * 8,
        ],
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
    const now = context.currentTime;
    const target = this.caveLevel * 0.22;
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
    const hasMusic = this.voices.some((voice) => voice.id === 'music.sequence');
    if (hasMusic) {
      this.nextMusicTick = this.tickCount + 20;
      return;
    }
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
    duration = Math.max(1, duration);
    this.play('music.sequence', {
      sequence,
      category: 'music',
      duration: duration + 2,
      fadeIn: 2,
      fadeOut: 2,
      priority: 0.2,
    });
    this.nextMusicTick = this.tickCount + Math.floor(1200 + this.random.next() * 1200);
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
    if (fade && this.context) {
      const now = this.context.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.012);
    }
    voice.filter.disconnect();
    voice.panner.disconnect();
    voice.gain.disconnect();
    voice.reverbSend.disconnect();
  }

  private setParam(param: AudioParam, value: number, now: number): void {
    param.setTargetAtTime(Math.max(0, value), now, 0.04);
  }
}

export const sound = new AudioService();

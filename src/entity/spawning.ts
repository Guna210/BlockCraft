import { BlockRegistry } from '../world/blocks/registry';
import type { World } from '../world/world';
import { getWorldTime, skyLightMultiplier } from '../world/time';
import { TransformC } from './ecs/components';
import { MAX_UNPOPULATED_COLUMNS } from './ecs/world';
import { hasEntityType } from './ecs/entity-types';
import { MobC, type MobCategory } from './ai/components';
import type { MobRuntime } from './ai/runtime';

export interface SpawnRule {
  /** A type registered with registerEntityType. */
  type: string;
  category: MobCategory;
  /** Biome ids the rule spawns in; empty means every biome. */
  biomes: readonly string[];
  /** Mobs per spawn: a fixed count or an inclusive [min, max] range. */
  groupSize: number | readonly [number, number];
  /** Relative chance among the rules that fit a spot. */
  weight: number;
  /** Ground blocks accepted below the mob. Passive rules default to grass. */
  ground?: readonly string[];
  /** Additional bounded species-specific spot condition. */
  where?: (world: World, x: number, y: number, z: number) => boolean;
  /** Dynamic weight for a valid spot, used for cave-biased species. */
  weightAt?: (world: World, x: number, y: number, z: number) => number;
}

/** Appendix B caps, counted over the loaded area around the player. */
export const MOB_CAPS: Readonly<Record<MobCategory, number>> = {
  passive: 12,
  hostile: 40,
  ambient: 10,
};
export const SPAWN_MIN_DISTANCE = 24;
export const SPAWN_MAX_DISTANCE = 128;
/** Hostiles farther than this may despawn at random; beyond SPAWN_MAX_DISTANCE they always do. */
export const DESPAWN_NEAR_DISTANCE = 32;
export const DESPAWN_CHANCE = 1 / 800;
export const PASSIVE_INTERVAL = 400;
/** Effective sky light (sky × daylight factor) must be below this for hostiles. */
export const HOSTILE_MAX_SKY = 8;
/** Shared budget across all spawning categories. */
export const SPAWN_ATTEMPTS_PER_TICK = 8;
export { MAX_UNPOPULATED_COLUMNS };
const MAX_POPULATED_COLUMNS = 256;
const GROUP_SPREAD = 4;

export class SpawnRuleRegistry {
  private readonly list: SpawnRule[] = [];

  register(rule: SpawnRule): void {
    if (!(rule.weight > 0)) throw new Error(`Spawn rule ${rule.type} needs a positive weight`);
    const [min, max] = groupRange(rule);
    if (!(min >= 1 && max >= min && Number.isInteger(min) && Number.isInteger(max)))
      throw new Error(`Spawn rule ${rule.type} has an invalid group size`);
    this.list.push(rule);
  }

  forCategory(category: MobCategory): SpawnRule[] {
    return this.list.filter((rule) => rule.category === category);
  }

  get rules(): readonly SpawnRule[] {
    return this.list;
  }
}

/** The game's rules; creature tasks register theirs here. */
export const spawnRules = new SpawnRuleRegistry();

export function registerSpawnRule(rule: SpawnRule): void {
  spawnRules.register(rule);
}

function groupRange(rule: SpawnRule): [number, number] {
  return typeof rule.groupSize === 'number'
    ? [rule.groupSize, rule.groupSize]
    : [rule.groupSize[0], rule.groupSize[1]];
}

/**
 * Natural spawning and despawning for one mob runtime: hostiles in the dark 24–128 blocks from the
 * player, passives on grass when a column is first generated and rarely afterwards, ambient mobs in
 * free air; all under the mob caps.
 */
export class MobSpawner {
  private readonly populated = new Set<string>();
  private clock = 0;
  private readonly grass: number | undefined;
  private readonly categories: MobCategory[];
  private attemptCursor = 0;

  constructor(
    private readonly runtime: MobRuntime,
    readonly rules: SpawnRuleRegistry,
  ) {
    this.grass = BlockRegistry.getInstance().getDefaultStateId('grass_block');
    this.categories = (['passive', 'hostile', 'ambient'] as const).filter(
      (category) => this.rules.forCategory(category).length > 0,
    );
  }

  /** Mobs of a category standing in loaded columns. */
  count(category: MobCategory): number {
    const ecs = this.runtime.ecs,
      world = this.runtime.world;
    let n = 0;
    for (const id of ecs.query(MobC, TransformC)) {
      if (ecs.get(id, MobC)!.category !== category) continue;
      const pos = ecs.get(id, TransformC)!.pos;
      if (world.hasColumn(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16))) n++;
    }
    return n;
  }

  tick(): void {
    const player = this.runtime.player();
    if (!player) return;
    this.clock++;
    this.despawn();
    if (this.categories.length === 0) return;
    let periodicPassive = this.clock % PASSIVE_INTERVAL === 0;
    for (let i = 0; i < SPAWN_ATTEMPTS_PER_TICK; i++) {
      const category = this.categories[this.attemptCursor++ % this.categories.length]!;
      if (category === 'passive' && periodicPassive) {
        periodicPassive = false;
        this.periodicPassiveAttempt();
      } else if (category === 'passive') this.passiveAttemptFromQueue();
      else this.annulusAttempt(category, i % 2 === 0);
    }
  }

  /** Removes far hostiles: always beyond 128 blocks, 1/800 per tick beyond 32. */
  private despawn(): void {
    const ecs = this.runtime.ecs,
      player = this.runtime.player()!;
    for (const id of ecs.query(MobC, TransformC)) {
      if (ecs.get(id, MobC)!.category !== 'hostile') continue;
      const pos = ecs.get(id, TransformC)!.pos;
      const d = Math.hypot(pos[0] - player.pos[0], pos[1] - player.pos[1], pos[2] - player.pos[2]);
      if (d > SPAWN_MAX_DISTANCE) this.runtime.removeNow(id);
      else if (d > DESPAWN_NEAR_DISTANCE && this.runtime.random() < DESPAWN_CHANCE)
        this.runtime.removeNow(id);
    }
  }

  /** One attempt for a category at a random spot 24–128 blocks from the player. */
  private annulusAttempt(category: 'hostile' | 'ambient', surface: boolean): void {
    if (this.rules.forCategory(category).length === 0) return;
    if (this.count(category) >= MOB_CAPS[category]) return;
    const runtime = this.runtime,
      world = runtime.world,
      player = runtime.player()!;
    const angle = runtime.random() * Math.PI * 2;
    const distance =
      SPAWN_MIN_DISTANCE + runtime.random() * (SPAWN_MAX_DISTANCE - SPAWN_MIN_DISTANCE);
    const x = Math.floor(player.pos[0] + Math.cos(angle) * distance);
    const z = Math.floor(player.pos[2] + Math.sin(angle) * distance);
    if (!world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) return;
    const top = world.getHeight(x, z);
    const y = surface ? top + 1 : 1 + Math.floor(runtime.random() * Math.max(1, top + 1));
    const test = category === 'hostile' ? this.hostileSpot.bind(this) : this.ambientSpot.bind(this);
    if (!test(x, y, z)) return;
    this.spawnGroup(category, x, y, z, test);
  }

  /** Solid below, two free cells, block light 0, effective sky light below 8, 24–128 away. */
  hostileSpot(x: number, y: number, z: number): boolean {
    const runtime = this.runtime,
      world = runtime.world;
    if (!this.inAnnulus(x, z) || !this.lightReady(x, z)) return false;
    if (runtime.classify(x, y - 1, z) !== 'solid') return false;
    if (runtime.classify(x, y, z) !== 'passable' || runtime.classify(x, y + 1, z) !== 'passable')
      return false;
    const light = world.getLight(x, y, z);
    return light.block === 0 && light.sky * skyLightMultiplier(getWorldTime()) < HOSTILE_MAX_SKY;
  }

  /** Two free cells of air (not water), 24–128 away. */
  ambientSpot(x: number, y: number, z: number): boolean {
    const runtime = this.runtime;
    return (
      this.inAnnulus(x, z) &&
      runtime.classify(x, y, z) === 'passable' &&
      runtime.classify(x, y + 1, z) === 'passable'
    );
  }

  /** Grass below and two free cells. */
  passiveSpot(
    x: number,
    y: number,
    z: number,
    ground: readonly string[] = ['grass_block'],
  ): boolean {
    const runtime = this.runtime;
    return (
      ground.some((block) =>
        block === 'grass_block'
          ? runtime.world.getBlockStateId(x, y - 1, z) === this.grass
          : runtime.world.getBlock(x, y - 1, z).id === block,
      ) &&
      runtime.classify(x, y, z) === 'passable' &&
      runtime.classify(x, y + 1, z) === 'passable'
    );
  }

  private passiveAttemptFromQueue(): void {
    if (this.rules.forCategory('passive').length === 0) return;
    const world = this.runtime.world;
    const key = world.unpopulatedColumns.values().next().value as string | undefined;
    if (!key) return;
    world.unpopulatedColumns.delete(key);
    if (this.populated.has(key)) return;
    if (this.populated.size >= MAX_POPULATED_COLUMNS) {
      const oldest = this.populated.values().next().value as string | undefined;
      if (oldest !== undefined) this.populated.delete(oldest);
    }
    this.populated.add(key);
    const [cx, cz] = key.split(',').map(Number) as [number, number];
    if (this.count('passive') < MOB_CAPS.passive && world.hasColumn(cx, cz))
      this.passiveAttempt(cx, cz);
  }

  private passiveAttempt(cx: number, cz: number): void {
    if (this.rules.forCategory('passive').length === 0) return;
    if (this.count('passive') >= MOB_CAPS.passive) return;
    const runtime = this.runtime;
    const x = cx * 16 + Math.floor(runtime.random() * 16);
    const z = cz * 16 + Math.floor(runtime.random() * 16);
    const y = runtime.world.getHeight(x, z) + 1;
    this.spawnGroup('passive', x, y, z, (gx, gy, gz, rule) => this.canSpawnAt(rule, gx, gy, gz));
  }

  private periodicPassiveAttempt(): void {
    if (this.count('passive') >= MOB_CAPS.passive) return;
    const runtime = this.runtime,
      player = runtime.player();
    if (!player) return;
    // A fixed-size local search samples a nearby column without enumerating loaded columns.
    const x = Math.floor(player.pos[0] + (runtime.random() * 2 - 1) * 60);
    const z = Math.floor(player.pos[2] + (runtime.random() * 2 - 1) * 60);
    const y = runtime.world.getHeight(x, z) + 1;
    if (!runtime.world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) return;
    this.spawnGroup('passive', x, y, z, (gx, gy, gz, rule) => this.canSpawnAt(rule, gx, gy, gz));
  }

  private spawnGroup(
    category: MobCategory,
    x: number,
    y: number,
    z: number,
    test: (x: number, y: number, z: number, rule: SpawnRule) => boolean,
  ): void {
    const rule = this.pickRule(category, this.runtime.world.getBiome(x, z), x, y, z);
    if (!rule) return;
    const [min, max] = groupRange(rule);
    const size = min + Math.floor(this.runtime.random() * (max - min + 1));
    let spawned = 0;
    for (let attempt = 0; attempt < size * 4 && spawned < size; attempt++) {
      if (this.count(category) >= MOB_CAPS[category]) return;
      let sx = x,
        sz = z;
      if (spawned > 0) {
        sx = x + Math.floor((this.runtime.random() * 2 - 1) * GROUP_SPREAD);
        sz = z + Math.floor((this.runtime.random() * 2 - 1) * GROUP_SPREAD);
      }
      if (!test(sx, y, sz, rule)) continue;
      this.runtime.spawn(rule.type, sx + 0.5, y, sz + 0.5);
      spawned++;
    }
  }

  /** Weighted pick among the category's rules for this biome. */
  pickRule(
    category: MobCategory,
    biome: string,
    x?: number,
    y?: number,
    z?: number,
  ): SpawnRule | null {
    const hasSpot = x !== undefined && y !== undefined && z !== undefined;
    const fitting = this.rules
      .forCategory(category)
      .filter(
        (rule) =>
          (rule.biomes.length === 0 || rule.biomes.includes(biome)) && hasEntityType(rule.type),
      );
    const eligible = hasSpot ? fitting.filter((rule) => this.ruleFits(rule, x!, y!, z!)) : fitting;
    const total = eligible.reduce((sum, rule) => sum + this.ruleWeight(rule, x, y, z), 0);
    if (total <= 0) return null;
    let roll = this.runtime.random() * total;
    for (const rule of eligible) {
      roll -= this.ruleWeight(rule, x, y, z);
      if (roll < 0) return rule;
    }
    return eligible[eligible.length - 1]!;
  }

  /** Full biome, ground, light, time and species-specific check for one rule candidate. */
  canSpawnAt(rule: SpawnRule, x: number, y: number, z: number): boolean {
    const world = this.runtime.world;
    return (
      (rule.biomes.length === 0 || rule.biomes.includes(world.getBiome(x, z))) &&
      this.ruleFits(rule, x, y, z) &&
      (rule.category === 'hostile'
        ? this.hostileSpot(x, y, z)
        : rule.category === 'ambient'
          ? this.ambientSpot(x, y, z)
          : this.passiveSpot(x, y, z, rule.ground ?? ['grass_block']))
    );
  }

  private ruleFits(rule: SpawnRule, x: number, y: number, z: number): boolean {
    if (rule.category === 'passive' && !this.passiveSpot(x, y, z, rule.ground ?? ['grass_block']))
      return false;
    return rule.where?.(this.runtime.world, x, y, z) ?? true;
  }

  private ruleWeight(rule: SpawnRule, x?: number, y?: number, z?: number): number {
    if (x === undefined || y === undefined || z === undefined) return rule.weight;
    const weight = rule.weightAt?.(this.runtime.world, x, y, z) ?? rule.weight;
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  }

  private inAnnulus(x: number, z: number): boolean {
    const player = this.runtime.player();
    if (!player) return false;
    const d = Math.hypot(x + 0.5 - player.pos[0], z + 0.5 - player.pos[2]);
    return d >= SPAWN_MIN_DISTANCE && d <= SPAWN_MAX_DISTANCE;
  }

  /** The streamer lights columns after loading them; never judge an unlit column as dark. */
  private lightReady(x: number, z: number): boolean {
    const engine = this.runtime.world.lightEngine;
    if (!engine) return false;
    return !engine.onlyLitColumns || engine.isLit(Math.floor(x / 16), Math.floor(z / 16));
  }
}

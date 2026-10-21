import { BlockRegistry } from '../world/blocks/registry';
import { getWorldTime, skyLightMultiplier } from '../world/time';
import { TransformC } from './ecs/components';
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
export const PASSIVE_CHANCE = 0.1;
/** Effective sky light (sky × daylight factor) must be below this for hostiles. */
export const HOSTILE_MAX_SKY = 8;
const ATTEMPTS_PER_TICK = 4;
const GENERATED_PER_TICK = 8;
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

  constructor(
    private readonly runtime: MobRuntime,
    readonly rules: SpawnRuleRegistry,
  ) {
    this.grass = BlockRegistry.getInstance().getDefaultStateId('grass_block');
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
    const world = this.runtime.world;
    // With no passive rules nothing could spawn, so nothing is recorded either.
    const passive = this.rules.forCategory('passive').length > 0;
    if (!passive) world.unpopulatedColumns.clear();
    let generated = 0;
    for (const key of world.unpopulatedColumns) {
      if (generated++ >= GENERATED_PER_TICK) break;
      world.unpopulatedColumns.delete(key);
      if (this.populated.has(key)) continue;
      this.populated.add(key);
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      if (world.hasColumn(cx, cz)) this.passiveAttempt(cx, cz);
    }
    for (let i = 0; i < ATTEMPTS_PER_TICK; i++) {
      this.annulusAttempt('hostile', i % 2 === 0);
      this.annulusAttempt('ambient', i % 2 === 0);
    }
    if (passive && this.clock % PASSIVE_INTERVAL === 0) {
      const columns = world.loadedColumns().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [cx, cz] of columns)
        if (this.runtime.random() < PASSIVE_CHANCE) this.passiveAttempt(cx, cz);
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
  passiveSpot(x: number, y: number, z: number): boolean {
    const runtime = this.runtime;
    return (
      runtime.world.getBlockStateId(x, y - 1, z) === this.grass &&
      runtime.classify(x, y, z) === 'passable' &&
      runtime.classify(x, y + 1, z) === 'passable'
    );
  }

  private passiveAttempt(cx: number, cz: number): void {
    if (this.rules.forCategory('passive').length === 0) return;
    if (this.count('passive') >= MOB_CAPS.passive) return;
    const runtime = this.runtime;
    const x = cx * 16 + Math.floor(runtime.random() * 16);
    const z = cz * 16 + Math.floor(runtime.random() * 16);
    const y = runtime.world.getHeight(x, z) + 1;
    if (!this.passiveSpot(x, y, z)) return;
    this.spawnGroup('passive', x, y, z, (gx, gy, gz) => this.passiveSpot(gx, gy, gz));
  }

  private spawnGroup(
    category: MobCategory,
    x: number,
    y: number,
    z: number,
    test: (x: number, y: number, z: number) => boolean,
  ): void {
    const rule = this.pickRule(category, this.runtime.world.getBiome(x, z));
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
      if (spawned > 0 && !test(sx, y, sz)) continue;
      this.runtime.spawn(rule.type, sx + 0.5, y, sz + 0.5);
      spawned++;
    }
  }

  /** Weighted pick among the category's rules for this biome. */
  pickRule(category: MobCategory, biome: string): SpawnRule | null {
    const fitting = this.rules
      .forCategory(category)
      .filter(
        (rule) =>
          (rule.biomes.length === 0 || rule.biomes.includes(biome)) && hasEntityType(rule.type),
      );
    const total = fitting.reduce((sum, rule) => sum + rule.weight, 0);
    if (total <= 0) return null;
    let roll = this.runtime.random() * total;
    for (const rule of fitting) {
      roll -= rule.weight;
      if (roll < 0) return rule;
    }
    return fitting[fitting.length - 1]!;
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

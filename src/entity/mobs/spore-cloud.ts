import { defineComponent, type EntityWorld } from '../ecs/world';
import { AnimatorC, EntityKindC, RenderableC, TransformC } from '../ecs/components';
import type { AnimationClip, Vec3 } from '../ecs/model';
import { registerEntityModel } from '../ecs/model';
import { playClip } from '../ecs/systems';
import { mobRuntime } from '../ai/runtime';
import { SkinPainter, buildModel, type PartSpec, type Ramp } from './kit';
import { CREATURE_ORDER } from './creature';

// The lingering spore cloud a Sporeburst leaves when it bursts: a drifting ring of spore puffs that
// slows the player inside it for a few seconds. A local effect, not a general status-effect system.

export const SPORE_CLOUD = 'spore_cloud';
/** Ticks the cloud lingers. */
export const SPORE_CLOUD_TICKS = 100;
/** Horizontal radius in blocks; the player is slowed with feet within 2 blocks below to 1 above. */
export const SPORE_CLOUD_RADIUS = 2.5;
export const SPORE_SLOW_FACTOR = 0.5;
/** Ticks the slow lasts after the last tick spent inside the cloud. */
export const SPORE_SLOW_TICKS = 10;
const DRIFT_TICKS = 40;
/** Runs after the creature system. */
const CLOUD_ORDER = CREATURE_ORDER + 1;

const SPORES: Ramp = ['#6b5872', '#927c99', '#b8a3ba', '#ddd0d8'];

interface SporeCloud {
  ticks: number;
}

export const SporeCloudC = defineComponent<SporeCloud>('sporeCloud');

/** Twelve puffs around the centre, alternating near and far, low and high. */
function sporeCloudModel() {
  const parts: PartSpec[] = [];
  for (let n = 0; n < 12; n++) {
    const angle = (n * Math.PI * 2) / 12 + (n % 2) * 0.2;
    const reach = n % 3 === 0 ? 8 : n % 3 === 1 ? 18 : 28;
    const size = n % 2 === 0 ? 4 : 3;
    const x = Math.round(Math.cos(angle) * reach),
      z = Math.round(Math.sin(angle) * reach),
      y = 3 + ((n * 7) % 13);
    parts.push({
      name: `puff${n}`,
      pivot: [x, y, z],
      cubes: [{ from: [x - size / 2, y, z - size / 2], size: [size, size, size] }],
    });
  }
  const drift: AnimationClip = {
    length: DRIFT_TICKS,
    loop: true,
    channels: parts.map((part, n) => ({
      part: part.name,
      property: 'position' as const,
      interpolation: 'linear' as const,
      keys: [
        { tick: 0, value: [0, 0, 0] as Vec3 },
        { tick: DRIFT_TICKS / 2, value: [0, n % 2 === 0 ? 3 : -2, 0] as Vec3 },
        { tick: DRIFT_TICKS, value: [0, 0, 0] as Vec3 },
      ],
    })),
  };
  return buildModel({ id: SPORE_CLOUD, textureSize: [64, 32], parts, clips: { drift } });
}

export const SPORE_CLOUD_MODEL = sporeCloudModel();

function sporeCloudSkin(seed: number): Uint8Array {
  const p = new SkinPainter(64, 32, seed);
  SPORE_CLOUD_MODEL.parts.forEach((part, n) =>
    p.cube(part.cubes[0]!, SPORES, { base: n % 2 === 0 ? 2 : 1.5, falloff: 1.2 }),
  );
  return p.data;
}

export const SPORE_CLOUD_PALETTE = [...SPORES];

registerEntityModel(SPORE_CLOUD_MODEL, sporeCloudSkin);

const installed = new WeakSet<EntityWorld>();

/** Leaves a spore cloud with its centre on the ground at `pos`. */
export function spawnSporeCloud(ecs: EntityWorld, pos: Readonly<Vec3>): number {
  if (!installed.has(ecs)) {
    installed.add(ecs);
    // After the AI system, so a cloud left by a burst during the AI pass works the same tick.
    ecs.addSystem(() => sporeCloudSystem(ecs), CLOUD_ORDER);
  }
  const id = ecs.create();
  ecs.add(id, EntityKindC, { type: SPORE_CLOUD });
  ecs.add(id, TransformC, { pos: [...pos], previous: [...pos], yaw: 0, previousYaw: 0 });
  ecs.add(id, RenderableC, { model: SPORE_CLOUD, scale: 0.4 });
  ecs.add(id, AnimatorC, {
    walkPhase: 0,
    previousWalkPhase: 0,
    speed: 0,
    previousSpeed: 0,
    headYaw: 0,
    previousHeadYaw: 0,
    headPitch: 0,
    previousHeadPitch: 0,
    clips: [],
  });
  ecs.add(id, SporeCloudC, { ticks: SPORE_CLOUD_TICKS });
  playClip(ecs, id, 'drift');
  return id;
}

/** Whether feet at `feet` are inside a cloud at `center`. */
export function insideSporeCloud(center: Readonly<Vec3>, feet: Readonly<Vec3>): boolean {
  const dy = feet[1] - center[1];
  return (
    Math.hypot(feet[0] - center[0], feet[2] - center[2]) <= SPORE_CLOUD_RADIUS &&
    dy >= -2 &&
    dy <= 1
  );
}

function sporeCloudSystem(ecs: EntityWorld): void {
  for (const id of ecs.query(SporeCloudC, TransformC)) {
    const cloud = ecs.get(id, SporeCloudC)!;
    if (--cloud.ticks <= 0) {
      ecs.destroy(id);
      continue;
    }
    // Billows out over 6 ticks and thins away over the last 20.
    const age = SPORE_CLOUD_TICKS - cloud.ticks;
    const renderable = ecs.get(id, RenderableC);
    if (renderable)
      renderable.scale = Math.min(1, 0.4 + age * 0.1) * Math.min(1, 0.3 + cloud.ticks / 20);
    const player = mobRuntime(ecs)?.player();
    if (player && insideSporeCloud(ecs.get(id, TransformC)!.pos, player.pos))
      player.slow?.(SPORE_SLOW_FACTOR, SPORE_SLOW_TICKS);
  }
}

import { mat4, vec3 } from 'gl-matrix';
import type { EntityWorld } from './world';
import {
  AnimatorC,
  DEATH_TICKS,
  HURT_TINT,
  HealthC,
  RenderableC,
  TransformC,
  type Health,
} from './components';
import { MAX_MODEL_PARTS, getEntityModel, type EntityModel } from './model';
import { clipTime, lerp, sampleChannel, walkSwing, wrapAngle } from './animation';

/** Tip-over roll in radians: 0 while alive, reaching π/2 after DEATH_TICKS. */
export function tipAngle(health: Health | undefined, alpha: number): number {
  if (!health || (health.deathTicks === 0 && health.previousDeathTicks === 0)) return 0;
  const ticks = Math.min(lerp(health.previousDeathTicks, health.deathTicks, alpha), DEATH_TICKS);
  return (ticks / DEATH_TICKS) * (Math.PI / 2);
}

/** Red mix while hurt or dying, else 0. */
export function hurtTint(health: Health | undefined): number {
  return health && (health.hurtTicks > 0 || health.current <= 0) ? HURT_TINT : 0;
}

const root = mat4.create();
const local = mat4.create();
const world = Array.from({ length: MAX_MODEL_PARTS }, () => mat4.create());
const indexCache = new WeakMap<EntityModel, Map<string, number>>();
const offsets = new Float32Array(MAX_MODEL_PARTS * 3);
const rotations = new Float32Array(MAX_MODEL_PARTS * 3);
const scratch: [number, number, number] = [0, 0, 0];
const translation = vec3.create();
const PIXEL = 1 / 16;

/**
 * World matrices of every part of an entity at render fraction `alpha` between the last two ticks,
 * written to `out` (16 floats per part, in model part order). Each maps model pixels to world blocks.
 * Returns the part count.
 */
export function computePose(
  ecs: EntityWorld,
  id: number,
  alpha: number,
  out: Float32Array,
  modelOverride?: EntityModel,
): number {
  const t = ecs.get(id, TransformC)!,
    a = ecs.get(id, AnimatorC),
    health = ecs.get(id, HealthC),
    model = modelOverride ?? getEntityModel(ecs.get(id, RenderableC)!.model);
  const parts = model.parts,
    count = parts.length;
  offsets.fill(0, 0, count * 3);
  for (let n = 0; n < count; n++) {
    const rest = parts[n]!.rotation;
    rotations[n * 3] = rest?.[0] ?? 0;
    rotations[n * 3 + 1] = rest?.[1] ?? 0;
    rotations[n * 3 + 2] = rest?.[2] ?? 0;
  }
  const indices = indexCache.get(model) ?? new Map(parts.map((part, n) => [part.name, n]));
  indexCache.set(model, indices);
  const index = (name: string) => indices.get(name)!;
  if (a) {
    for (const playing of a.clips) {
      const clip = model.clips?.[playing.name];
      if (!clip) continue;
      const time = clipTime(clip, Math.max(0, ecs.time - 1 + alpha - playing.start));
      if (time === null) continue;
      for (const channel of clip.channels) {
        const n = index(channel.part),
          target = channel.property === 'rotation' ? rotations : offsets;
        sampleChannel(channel, time, scratch);
        for (let axis = 0; axis < 3; axis++) target[n * 3 + axis]! += scratch[axis]!;
      }
    }
    if (model.walk) {
      const phase = lerp(a.previousWalkPhase, a.walkPhase, alpha),
        speed = lerp(a.previousSpeed, a.speed, alpha);
      for (const [limb, offset] of Object.entries(model.walk.limbs))
        rotations[index(limb) * 3]! += walkSwing(
          model.walk.maxSwing,
          phase + offset,
          speed,
          model.walk.refSpeed,
        );
    }
    if (model.head) {
      const n = index(model.head.part);
      // Model space faces +Z, so a head turned toward a world yaw to the body's left rotates by -yaw.
      rotations[n * 3 + 1]! -= lerp(a.previousHeadYaw, a.headYaw, alpha);
      rotations[n * 3]! -= lerp(a.previousHeadPitch, a.headPitch, alpha);
    }
  }
  translation[0] = lerp(t.previous[0], t.pos[0], alpha);
  translation[1] = lerp(t.previous[1], t.pos[1], alpha);
  translation[2] = lerp(t.previous[2], t.pos[2], alpha);
  const yaw = t.previousYaw + wrapAngle(t.yaw - t.previousYaw) * alpha;
  mat4.fromTranslation(root, translation);
  mat4.rotateY(root, root, Math.PI / 2 - yaw);
  if (t.pitch !== undefined) {
    const pitch = lerp(t.previousPitch ?? t.pitch, t.pitch, alpha);
    mat4.rotateX(root, root, -pitch);
  }
  const tip = tipAngle(health, alpha);
  if (tip) mat4.rotateZ(root, root, tip);
  translation[0] = translation[1] = translation[2] = PIXEL;
  mat4.scale(root, root, translation);
  for (let n = 0; n < count; n++) {
    const part = parts[n]!,
      parentIndex = part.parent === undefined ? -1 : index(part.parent);
    const pivot = part.pivot;
    translation[0] = pivot[0] + offsets[n * 3]!;
    translation[1] = pivot[1] + offsets[n * 3 + 1]!;
    translation[2] = pivot[2] + offsets[n * 3 + 2]!;
    mat4.fromTranslation(local, translation);
    mat4.rotateZ(local, local, rotations[n * 3 + 2]!);
    mat4.rotateY(local, local, rotations[n * 3 + 1]!);
    mat4.rotateX(local, local, rotations[n * 3]!);
    translation[0] = -pivot[0];
    translation[1] = -pivot[1];
    translation[2] = -pivot[2];
    mat4.translate(local, local, translation);
    mat4.multiply(world[n]!, parentIndex < 0 ? root : world[parentIndex]!, local);
    out.set(world[n]!, n * 16);
  }
  return count;
}

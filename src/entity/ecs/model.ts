export type Vec3 = [number, number, number];

export const MAX_MODEL_PARTS = 24;

/**
 * One box. `from` and `size` are in model pixels (1/16 block) in model space: +Y up, the model faces
 * +Z and its right-hand side is -X; the origin is the centre of the feet. `uv` is the top-left texel of
 * the box's unwrap (see `cubeFaceRects`); `inflate` grows the box on every side without changing its UVs.
 */
export interface ModelCube {
  from: Vec3;
  size: Vec3;
  uv: [number, number];
  inflate?: number;
}

/** A bone. Its pivot is in model pixels; a child moves with its parent. Rest rotation is in radians (X, Y, Z). */
export interface ModelPart {
  name: string;
  parent?: string;
  pivot: Vec3;
  rotation?: Vec3;
  cubes: ModelCube[];
}

/** Keyframes for one part. `rotation` values are radians; `position` values are model pixels. */
export interface KeyframeChannel {
  part: string;
  property: 'rotation' | 'position';
  interpolation: 'linear' | 'step';
  keys: Array<{ tick: number; value: Vec3 }>;
}

/** A keyframed clip timed in ticks. A one-shot clip ends after `length` ticks; a looping clip repeats. */
export interface AnimationClip {
  length: number;
  loop: boolean;
  channels: KeyframeChannel[];
}

/** Speed-driven walk: each limb swings around X by maxSwing · sin(phase + offset) · min(speed / refSpeed, 1). */
export interface WalkAnimation {
  /** Radians. */
  maxSwing: number;
  /** Blocks per second at which the swing reaches maxSwing. */
  refSpeed: number;
  /** Horizontal blocks travelled per full cycle; the phase advances with distance, not time. */
  stride: number;
  /** Part name → phase offset in radians (0 or Math.PI for opposite limbs). */
  limbs: Record<string, number>;
}

/** The part that turns toward the entity's look target. */
export interface HeadTracking {
  part: string;
  /** Radians either side of the body; default 60°. */
  maxYaw?: number;
  /** Radians up or down; default 40°. */
  maxPitch?: number;
}

export interface EntityModel {
  id: string;
  /** Skin texture size in pixels. */
  textureSize: [number, number];
  /** At most MAX_MODEL_PARTS; a parent must be listed before its children. */
  parts: ModelPart[];
  walk?: WalkAnimation;
  head?: HeadTracking;
  clips?: Record<string, AnimationClip>;
}

/** Procedural skin: returns RGBA bytes of textureSize[0] × textureSize[1] pixels; same seed, same pixels. */
export type SkinGenerator = (seed: number) => Uint8Array;

export type FaceName = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

/**
 * Box unwrap of a cube of size (w, h, d) at uv (u, v), in texels:
 *   row v .. v+d:       top at u+d (w × d), bottom at u+d+w (w × d)
 *   row v+d .. v+d+h:   right (-X) at u (d × h), front (+Z) at u+d (w × h),
 *                       left (+X) at u+d+w (d × h), back (-Z) at u+2d+w (w × h)
 * The unwrap is 2(w + d) wide and d + h tall. Side faces are upright and seen from outside; the
 * top's texture-up is the back (-Z) and the bottom's is the front (+Z).
 */
export function cubeFaceRects(cube: ModelCube): Record<FaceName, [number, number, number, number]> {
  const [u, v] = cube.uv;
  const [w, h, d] = cube.size;
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
}

interface RegisteredModel {
  model: EntityModel;
  skin: SkinGenerator;
}

const models = new Map<string, RegisteredModel>();

/** Throws when the model breaks a rule a renderer depends on. */
export function validateModel(model: EntityModel): void {
  const [tw, th] = model.textureSize;
  if (!(tw > 0 && th > 0 && Number.isInteger(tw) && Number.isInteger(th)))
    throw new Error(`Model ${model.id}: invalid texture size`);
  if (model.parts.length === 0 || model.parts.length > MAX_MODEL_PARTS)
    throw new Error(`Model ${model.id}: needs 1 to ${MAX_MODEL_PARTS} parts`);
  const seen = new Set<string>();
  for (const part of model.parts) {
    if (seen.has(part.name)) throw new Error(`Model ${model.id}: duplicate part ${part.name}`);
    if (part.parent !== undefined && !seen.has(part.parent))
      throw new Error(`Model ${model.id}: part ${part.name} must follow its parent ${part.parent}`);
    seen.add(part.name);
    for (const cube of part.cubes) {
      if (cube.size.some((s) => !(s >= 0)))
        throw new Error(`Model ${model.id}: part ${part.name} has a negative cube size`);
      const [u, v] = cube.uv,
        [w, h, d] = cube.size;
      if (u < 0 || v < 0 || u + 2 * (w + d) > tw || v + d + h > th)
        throw new Error(`Model ${model.id}: part ${part.name} UVs leave the texture`);
    }
  }
  const named = (name: string, what: string) => {
    if (!seen.has(name)) throw new Error(`Model ${model.id}: ${what} names unknown part ${name}`);
  };
  if (model.walk) for (const limb of Object.keys(model.walk.limbs)) named(limb, 'walk');
  if (model.head) named(model.head.part, 'head');
  for (const [name, clip] of Object.entries(model.clips ?? {})) {
    if (!(clip.length > 0)) throw new Error(`Model ${model.id}: clip ${name} has no length`);
    for (const channel of clip.channels) {
      named(channel.part, `clip ${name}`);
      if (channel.keys.length === 0) throw new Error(`Model ${model.id}: clip ${name} has no keys`);
      for (let n = 1; n < channel.keys.length; n++)
        if (channel.keys[n]!.tick < channel.keys[n - 1]!.tick)
          throw new Error(`Model ${model.id}: clip ${name} keys are out of order`);
    }
  }
}

/** Registers a model and its procedural skin. A model id can be registered once. */
export function registerEntityModel(model: EntityModel, skin: SkinGenerator): void {
  if (models.has(model.id)) throw new Error(`Duplicate entity model: ${model.id}`);
  validateModel(model);
  const pixels = skin(1);
  if (pixels.length !== model.textureSize[0] * model.textureSize[1] * 4)
    throw new Error(`Model ${model.id}: skin size does not match its texture size`);
  models.set(model.id, { model, skin });
}

export function getEntityModel(id: string): EntityModel {
  const entry = models.get(id);
  if (!entry) throw new Error(`Unknown entity model: ${id}`);
  return entry.model;
}

export function getEntitySkin(id: string): SkinGenerator {
  const entry = models.get(id);
  if (!entry) throw new Error(`Unknown entity model: ${id}`);
  return entry.skin;
}

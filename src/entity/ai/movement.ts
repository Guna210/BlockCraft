import { EPSILON, type BlockCollision } from '../physics';
import type { Body, Transform } from '../ecs/components';
import type { MobBody } from './components';

/** Blocks per tick², per tick. */
export const MOB_GRAVITY = 0.08;
export const MOB_JUMP_VELOCITY = 0.42;
export const MOB_CLIMB_SPEED = 0.2;
const STEP_HEIGHT = 0.6;
/** Share of the gap between velocity and wish that survives one tick. */
const GROUND_KEEP = 0.5;
const AIR_KEEP = 0.91;
const FLY_KEEP = 0.8;
const MAX_TURN = 0.35;

/**
 * One tick of mob physics with swept AABB collision: gravity unless flying, a jump when asked on
 * the ground, swimming, wall climbing, and a 0.6-block step-up. Clears the wish afterwards.
 */
export function moveMob(
  collision: BlockCollision,
  transform: Transform,
  size: Body,
  body: MobBody,
): void {
  const pos = transform.pos,
    vel = body.vel,
    wish = body.wish;
  const half = size.width / 2,
    height = size.height;
  const world = collision.world;
  if (!world.hasColumn(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16))) {
    clearIntent(body);
    return;
  }
  body.inFluid = !body.flying && collision.inWater(pos, height);
  const touchingCeiling =
    body.climbing && body.climb && collision.sweep(pos, height, 1, 0.03, half) < 0.03 - EPSILON;
  const keep = body.flying ? FLY_KEEP : body.onGround || body.inFluid ? GROUND_KEEP : AIR_KEEP;
  vel[0] = wish[0] + (vel[0] - wish[0]) * keep;
  vel[2] = wish[2] + (vel[2] - wish[2]) * keep;
  if (body.flying) vel[1] = wish[1] + (vel[1] - wish[1]) * FLY_KEEP;
  else if (touchingCeiling && body.ceilingCling === true) vel[1] = 0;
  else if (body.climb && body.climbing && body.horizontalCollision) vel[1] = MOB_CLIMB_SPEED;
  else if (body.inFluid)
    vel[1] = Math.max(-0.2, Math.min(0.2, vel[1] * 0.8 + (body.jump ? 0.04 : -0.02)));
  else if (body.jump && body.onGround) vel[1] = MOB_JUMP_VELOCITY;
  else vel[1] = Math.max((vel[1] - MOB_GRAVITY) * 0.98, -(body.maxFallSpeed ?? Infinity));

  const grounded = body.onGround;
  const dy = collision.sweep(pos, height, 1, vel[1], half);
  pos[1] += dy;
  body.onGround = vel[1] < 0 && dy > vel[1] + EPSILON;
  if (Math.abs(dy - vel[1]) > EPSILON) vel[1] = 0;
  const blockedX = moveAxis(
    collision,
    pos,
    height,
    half,
    0,
    vel[0],
    grounded && !body.flying,
    body,
  );
  const blockedZ = moveAxis(
    collision,
    pos,
    height,
    half,
    2,
    vel[2],
    grounded && !body.flying,
    body,
  );
  if (blockedX) vel[0] = 0;
  if (blockedZ) vel[2] = 0;
  body.horizontalCollision = blockedX || blockedZ;
  body.ceilingCling =
    body.climbing && body.climb && collision.sweep(pos, height, 1, 0.03, half) < 0.03 - EPSILON;
  if (body.ceilingCling) vel[1] = 0;

  if (Math.hypot(wish[0], wish[2]) > 1e-4) {
    const want = Math.atan2(wish[2], wish[0]);
    let delta = want - transform.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    transform.yaw += Math.max(-MAX_TURN, Math.min(MAX_TURN, delta));
  }
  clearIntent(body);
}

function clearIntent(body: MobBody): void {
  body.wish[0] = body.wish[1] = body.wish[2] = 0;
  body.jump = false;
  body.climb = false;
}

/** Moves along x (0) or z (2); returns true when a wall stopped the move. */
function moveAxis(
  collision: BlockCollision,
  pos: [number, number, number],
  height: number,
  half: number,
  axis: 0 | 2,
  distance: number,
  canStep: boolean,
  body: MobBody,
): boolean {
  if (distance === 0) return false;
  const moved = collision.sweep(pos, height, axis, distance, half);
  if (Math.abs(moved - distance) <= EPSILON) {
    pos[axis] += moved;
    return false;
  }
  if (canStep) {
    const up = collision.sweep(pos, height, 1, STEP_HEIGHT, half);
    if (up > EPSILON) {
      pos[1] += up;
      const stepped = collision.sweep(pos, height, axis, distance, half);
      if (Math.abs(stepped) > Math.abs(moved) + EPSILON) {
        pos[axis] += stepped;
        pos[1] += collision.sweep(pos, height, 1, -up, half);
        body.onGround = true;
        return Math.abs(stepped - distance) > EPSILON;
      }
      pos[1] -= up;
    }
  }
  pos[axis] += moved;
  return true;
}

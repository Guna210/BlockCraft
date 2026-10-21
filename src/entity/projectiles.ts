import { BlockRegistry } from '../world/blocks/registry';
import type { World } from '../world/world';
import { VoxelRaycaster, createRayHit } from '../world/raycast';
import { BodyC, EntityKindC, HealthC, RenderableC, TransformC } from './ecs/components';
import { entityState } from './ecs/systems';
import { defineComponent, type EntityWorld } from './ecs/world';
import {
  cubeFaceRects,
  getEntityModel,
  registerEntityModel,
  type EntityModel,
  type ModelCube,
  type Vec3,
} from './ecs/model';
import { CombatC, MobBodyC, PLAYER_TARGET } from './ai/components';
import { hurtMob, hurtPlayer } from '../gameplay/combat';
import type { ItemEntityManager } from './item-entity';
import type { Player } from './player';

/** The shared projectile kind data registered by each projectile-owning task. */
export interface ProjectileKind {
  id: string;
  model: string;
  gravity: number;
  drag: number;
  damageScale: number;
  pickup: boolean;
}

/** ECS state intentionally stays small; block anchoring lives beside the velocity component. */
export interface Projectile {
  owner: number;
  kind: string;
  stuck: boolean;
  ageTicks: number;
  pickup: boolean;
  stuckBlock?: [number, number, number];
}

export interface ProjectileVelocity {
  vel: Vec3;
}

export const ProjectileC = defineComponent<Projectile>('projectile');
export const ProjectileVelocityC = defineComponent<ProjectileVelocity>('projectileVelocity');
export const PROJECTILE_TICK_ORDER = -100;
export const PROJECTILE_LIFETIME_TICKS = 1200;
export const PROJECTILE_OWNER_GRACE_TICKS = 5;
export const PROJECTILE_WATER_DRAG = 0.6;
const ARROW_MODEL_ID = 'projectile_arrow';
const PROJECTILE_RADIUS = 0.02;
const PROJECTILE_KNOCKBACK = 0.4;
const EPSILON = 1e-9;

const shaft: ModelCube = { from: [-0.5, -0.5, -7], size: [1, 1, 12], uv: [0, 0] };
const head: ModelCube = { from: [-1.5, -1.5, 5], size: [3, 3, 4], uv: [28, 0] };
const fletchA: ModelCube = { from: [-2, -0.5, -9], size: [4, 1, 3], uv: [44, 0] };
const fletchB: ModelCube = { from: [-0.5, -2, -9], size: [1, 4, 3], uv: [44, 5] };

const ARROW_MODEL: EntityModel = {
  id: ARROW_MODEL_ID,
  textureSize: [64, 16],
  parts: [
    { name: 'shaft', pivot: [0, 0, 0], cubes: [shaft] },
    { name: 'head', pivot: [0, 0, 0], cubes: [head] },
    { name: 'fletching', pivot: [0, 0, 0], cubes: [fletchA, fletchB] },
  ],
};

const SHAFT_RAMP = [
  [53, 35, 26, 255],
  [94, 65, 47, 255],
  [133, 93, 57, 255],
  [191, 154, 98, 255],
];
const METAL_RAMP = [
  [79, 82, 87, 255],
  [98, 102, 107, 255],
  [139, 143, 148, 255],
  [163, 167, 171, 255],
];
const FEATHER_RAMP = [
  [36, 72, 26, 255],
  [47, 94, 34, 255],
  [85, 152, 58, 255],
  [111, 177, 74, 255],
];

function paintCube(data: Uint8Array, cube: ModelCube, ramp: readonly number[][]): void {
  for (const [faceIndex, rect] of Object.values(cubeFaceRects(cube)).entries()) {
    const [x0, y0, width, height] = rect;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const edge = x === 0 || y === 0 ? 3 : x === width - 1 || y === height - 1 ? 0 : -1;
        const cluster = (Math.floor(x / 2) + Math.floor(y / 2) + faceIndex) % 4;
        const color = ramp[edge >= 0 ? edge : cluster === 0 ? 1 : 2]!;
        const pixel = (Math.floor(y0 + y) * 64 + Math.floor(x0 + x)) * 4;
        data[pixel] = color[0]!;
        data[pixel + 1] = color[1]!;
        data[pixel + 2] = color[2]!;
        data[pixel + 3] = color[3]!;
      }
  }
}

/** Small code-drawn model skin: a wood shaft, metal point and clustered green fletching. */
export function arrowSkin(): Uint8Array {
  const data = new Uint8Array(64 * 16 * 4);
  paintCube(data, shaft, SHAFT_RAMP);
  paintCube(data, head, METAL_RAMP);
  paintCube(data, fletchA, FEATHER_RAMP);
  paintCube(data, fletchB, FEATHER_RAMP);
  return data;
}

registerEntityModel(ARROW_MODEL, arrowSkin);

const projectileKinds = new Map<string, ProjectileKind>();

/** Registers one complete projectile definition; each id can only be installed once. */
export function registerProjectileKind(kind: ProjectileKind): void {
  if (!kind.id || projectileKinds.has(kind.id))
    throw new Error(`Invalid or duplicate projectile kind: ${kind.id}`);
  if (
    !Number.isFinite(kind.gravity) ||
    kind.gravity < 0 ||
    !Number.isFinite(kind.drag) ||
    kind.drag < 0 ||
    kind.drag > 1 ||
    !Number.isFinite(kind.damageScale) ||
    kind.damageScale < 0
  )
    throw new Error(`Invalid projectile physics: ${kind.id}`);
  getEntityModel(kind.model);
  projectileKinds.set(kind.id, Object.freeze({ ...kind }));
}

export function getProjectileKind(id: string): ProjectileKind {
  const kind = projectileKinds.get(id);
  if (!kind) throw new Error(`Unknown projectile kind: ${id}`);
  return kind;
}

export interface ProjectileLaunch {
  kind: string;
  from: Readonly<Vec3>;
  speed: number;
  owner: number;
  pickup?: boolean;
}

export type ProjectileFireOptions = ProjectileLaunch &
  ({ dir: Readonly<Vec3>; aimAt?: never } | { aimAt: Readonly<Vec3>; dir?: never });

/** Creates one ECS projectile; its registered ProjectileRuntime advances it at the next tick. */
export function fireProjectile(ecs: EntityWorld, options: ProjectileFireOptions): number {
  if (!Number.isFinite(options.speed) || options.speed <= 0)
    throw new Error('Projectile speed must be finite and positive');
  if (!Number.isSafeInteger(options.owner) || options.owner < 0)
    throw new Error('Projectile owner must be a non-negative entity id');
  const kind = getProjectileKind(options.kind);
  const dir = normalize(
    'aimAt' in options && options.aimAt
      ? solveAimDirection(options.from, options.aimAt, options.speed, kind.gravity)
      : options.dir!,
  );
  const id = ecs.create(),
    yaw = Math.atan2(dir[2], dir[0]),
    pitch = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  ecs.add(id, EntityKindC, { type: kind.id });
  ecs.add(id, TransformC, {
    pos: [...options.from],
    previous: [...options.from],
    yaw,
    previousYaw: yaw,
    pitch,
    previousPitch: pitch,
  });
  ecs.add(id, RenderableC, { model: kind.model });
  ecs.add(id, ProjectileC, {
    owner: options.owner,
    kind: kind.id,
    stuck: false,
    ageTicks: 0,
    pickup: options.pickup ?? kind.pickup,
  });
  ecs.add(id, ProjectileVelocityC, {
    vel: [dir[0] * options.speed, dir[1] * options.speed, dir[2] * options.speed],
  });
  return id;
}

/** Returns the flatter ballistic launch direction, or a 45° direction when the target is out of range. */
export function solveAimDirection(
  from: Readonly<Vec3>,
  aimAt: Readonly<Vec3>,
  speed: number,
  gravity: number,
): Vec3 {
  if (!(speed > 0) || !Number.isFinite(speed) || !(gravity >= 0) || !Number.isFinite(gravity))
    throw new Error('Aim speed and gravity must be finite, with positive speed');
  const dx = aimAt[0] - from[0],
    dy = aimAt[1] - from[1],
    dz = aimAt[2] - from[2],
    horizontal = Math.hypot(dx, dz);
  if (horizontal < EPSILON) return [0, dy < 0 ? -1 : 1, 0];
  if (gravity < EPSILON) return normalize([dx, dy, dz]);
  const speed2 = speed * speed,
    discriminant =
      speed2 * speed2 - gravity * (gravity * horizontal * horizontal + 2 * dy * speed2);
  const horizontalScale = 1 / horizontal;
  if (discriminant >= 0) {
    const tangent = (speed2 - Math.sqrt(discriminant)) / (gravity * horizontal);
    const cos = 1 / Math.sqrt(1 + tangent * tangent);
    return [dx * horizontalScale * cos, tangent * cos, dz * horizontalScale * cos];
  }
  const diagonal = Math.SQRT1_2;
  return [dx * horizontalScale * diagonal, diagonal, dz * horizontalScale * diagonal];
}

function normalize(vector: Readonly<Vec3>): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > EPSILON) || !Number.isFinite(length))
    throw new Error('Projectile direction must be nonzero');
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export type ProjectilePlayer = Pick<
  Player,
  'pos' | 'height' | 'mode' | 'dead' | 'detached' | 'yaw' | 'inventory' | 'vel' | 'onGround'
>;

/** Installs the shared 20 Hz swept-segment projectile system on an ECS world. */
export class ProjectileRuntime {
  private readonly raycaster: VoxelRaycaster;
  private readonly blockHit = createRayHit();
  private readonly getPlayer: () => ProjectilePlayer | null;
  private readonly getItems: () => ItemEntityManager | null;

  constructor(
    readonly world: World,
    readonly ecs: EntityWorld,
    getPlayer: () => ProjectilePlayer | null = () => null,
    getItems: () => ItemEntityManager | null = () => null,
  ) {
    this.raycaster = new VoxelRaycaster(world);
    this.getPlayer = getPlayer;
    this.getItems = getItems;
    ecs.addSystem(() => this.tick(), PROJECTILE_TICK_ORDER);
  }

  private tick(): void {
    for (const id of this.ecs.query(ProjectileC, ProjectileVelocityC, TransformC)) {
      const projectile = this.ecs.get(id, ProjectileC)!;
      const transform = this.ecs.get(id, TransformC)!;
      const motion = this.ecs.get(id, ProjectileVelocityC)!;
      if (++projectile.ageTicks >= PROJECTILE_LIFETIME_TICKS) {
        this.ecs.destroy(id);
        continue;
      }
      if (projectile.stuck) {
        this.tickStuck(id, projectile, transform);
        continue;
      }

      const kind = getProjectileKind(projectile.kind),
        velocity = motion.vel;
      velocity[1] -= kind.gravity;
      const speedBeforeDrag = Math.hypot(velocity[0], velocity[1], velocity[2]);
      if (!(speedBeforeDrag > EPSILON)) continue;
      const candidate: Vec3 = [
        transform.pos[0] + velocity[0],
        transform.pos[1] + velocity[1],
        transform.pos[2] + velocity[2],
      ];
      const drag =
        this.inWater(transform.pos) || this.inWater(candidate) ? PROJECTILE_WATER_DRAG : kind.drag;
      velocity[0] *= drag;
      velocity[1] *= drag;
      velocity[2] *= drag;
      const length = Math.hypot(velocity[0], velocity[1], velocity[2]);
      if (!(length > EPSILON)) continue;
      const dir: Vec3 = [velocity[0] / length, velocity[1] / length, velocity[2] / length],
        start: Vec3 = [...transform.pos];
      this.raycaster.cast(
        start[0],
        start[1],
        start[2],
        dir[0],
        dir[1],
        dir[2],
        length,
        this.blockHit,
      );
      const blockDistance = this.blockHit.hit ? this.blockHit.distance : Infinity;
      const entityHit = this.closestEntityHit(projectile, start, dir, length);
      if (this.blockHit.hit && blockDistance <= (entityHit?.distance ?? Infinity)) {
        transform.pos[0] = start[0] + dir[0] * (blockDistance - 0.05);
        transform.pos[1] = start[1] + dir[1] * (blockDistance - 0.05);
        transform.pos[2] = start[2] + dir[2] * (blockDistance - 0.05);
        projectile.stuck = true;
        projectile.stuckBlock = [this.blockHit.x, this.blockHit.y, this.blockHit.z];
        velocity.fill(0);
        this.setOrientation(transform, dir);
        continue;
      }
      if (entityHit) {
        const hit: Vec3 = [
          start[0] + dir[0] * entityHit.distance,
          start[1] + dir[1] * entityHit.distance,
          start[2] + dir[2] * entityHit.distance,
        ];
        transform.pos.splice(0, 3, ...hit);
        this.hitEntity(projectile, entityHit.id, hit, dir, length);
        this.ecs.destroy(id);
        continue;
      }
      transform.pos[0] += velocity[0];
      transform.pos[1] += velocity[1];
      transform.pos[2] += velocity[2];
      this.setOrientation(transform, dir);
    }
  }

  private tickStuck(id: number, projectile: Projectile, transform: { pos: Vec3 }): void {
    const anchor = projectile.stuckBlock;
    if (anchor) {
      const stateId = this.world.getBlockStateId(anchor[0], anchor[1], anchor[2]);
      if (!this.raycaster.shapes.parts[stateId]?.length) {
        if (projectile.pickup && this.drop(projectile.kind, transform.pos, [0, -0.2, 0]))
          this.ecs.destroy(id);
        else if (!projectile.pickup) this.ecs.destroy(id);
        return;
      }
    }
    const player = this.getPlayer();
    if (
      projectile.pickup &&
      player &&
      !player.dead &&
      !player.detached &&
      Math.hypot(
        transform.pos[0] - player.pos[0],
        transform.pos[1] - player.pos[1],
        transform.pos[2] - player.pos[2],
      ) <= 1 &&
      this.drop(projectile.kind, transform.pos, [0, 0, 0])
    )
      this.ecs.destroy(id);
  }

  private drop(kind: string, pos: Readonly<Vec3>, velocity: Vec3): boolean {
    const items = this.getItems();
    if (!items) return false;
    return Boolean(items.spawn(kind, 1, pos[0], pos[1], pos[2], { velocity, pickupDelay: 0 }));
  }

  private inWater(pos: Readonly<Vec3>): boolean {
    const state = BlockRegistry.getInstance().getResolvedState(
      this.world.getBlockStateId(Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2])),
    );
    return state?.blockId === 'water';
  }

  private closestEntityHit(
    projectile: Projectile,
    start: Readonly<Vec3>,
    dir: Readonly<Vec3>,
    length: number,
  ): { id: number; distance: number } | null {
    let nearest: { id: number; distance: number } | null = null;
    const afterGrace = projectile.ageTicks > PROJECTILE_OWNER_GRACE_TICKS;
    for (const id of this.ecs.query(TransformC, HealthC)) {
      if (id === projectile.owner && !afterGrace) continue;
      if (entityState(this.ecs, id) === 'dying') continue;
      const transform = this.ecs.get(id, TransformC)!;
      const body = this.ecs.get(id, BodyC);
      if (!body) continue;
      const half = body.width / 2 + PROJECTILE_RADIUS;
      const distance = segmentBox(
        start,
        dir,
        length,
        transform.pos[0] - half,
        transform.pos[1] - PROJECTILE_RADIUS,
        transform.pos[2] - half,
        transform.pos[0] + half,
        transform.pos[1] + body.height + PROJECTILE_RADIUS,
        transform.pos[2] + half,
      );
      if (distance !== null && (!nearest || distance < nearest.distance))
        nearest = { id, distance };
    }
    const player = this.getPlayer();
    if (
      player &&
      !player.dead &&
      !player.detached &&
      (projectile.owner !== PLAYER_TARGET || afterGrace)
    ) {
      const half = 0.3 + PROJECTILE_RADIUS;
      const distance = segmentBox(
        start,
        dir,
        length,
        player.pos[0] - half,
        player.pos[1] - PROJECTILE_RADIUS,
        player.pos[2] - half,
        player.pos[0] + half,
        player.pos[1] + player.height + PROJECTILE_RADIUS,
        player.pos[2] + half,
      );
      if (distance !== null && (!nearest || distance < nearest.distance))
        nearest = { id: PLAYER_TARGET, distance };
    }
    return nearest;
  }

  private hitEntity(
    projectile: Projectile,
    id: number,
    hit: Readonly<Vec3>,
    direction: Readonly<Vec3>,
    speed: number,
  ): void {
    const damage = Math.ceil(speed * getProjectileKind(projectile.kind).damageScale);
    const source: Vec3 = [hit[0] - direction[0], hit[1] - direction[1], hit[2] - direction[2]];
    if (id === PLAYER_TARGET) {
      const player = this.getPlayer();
      if (!player || !hurtPlayer(player as Player, damage, `projectile:${projectile.kind}`, source))
        return;
      player.vel[0] = direction[0] * PROJECTILE_KNOCKBACK;
      player.vel[1] = direction[1] * PROJECTILE_KNOCKBACK;
      player.vel[2] = direction[2] * PROJECTILE_KNOCKBACK;
      player.onGround = false;
      return;
    }
    const combat = this.ecs.get(id, CombatC),
      fresh = !combat || combat.invulnerableTicks <= 0,
      ownerPos = this.ownerPosition(projectile.owner, source);
    if (!hurtMob(this.ecs, id, damage, { ref: projectile.owner, pos: ownerPos }, false) || !fresh)
      return;
    const body = this.ecs.get(id, MobBodyC);
    if (!body) return;
    body.vel[0] = direction[0] * PROJECTILE_KNOCKBACK;
    body.vel[1] = direction[1] * PROJECTILE_KNOCKBACK;
    body.vel[2] = direction[2] * PROJECTILE_KNOCKBACK;
    body.onGround = false;
  }

  private ownerPosition(owner: number, fallback: Readonly<Vec3>): Vec3 {
    if (owner === PLAYER_TARGET) {
      const player = this.getPlayer();
      if (player) return [...player.pos];
    } else {
      const pos = this.ecs.get(owner, TransformC)?.pos;
      if (pos) return [...pos];
    }
    return [...fallback];
  }

  private setOrientation(transform: { yaw: number; pitch?: number }, dir: Readonly<Vec3>): void {
    transform.yaw = Math.atan2(dir[2], dir[0]);
    transform.pitch = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  }
}

function segmentBox(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  length: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let near = 0,
    far = length;
  const min = [minX, minY, minZ],
    max = [maxX, maxY, maxZ];
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis]!,
      d = direction[axis]!;
    if (Math.abs(d) < EPSILON) {
      if (o < min[axis]! || o > max[axis]!) return null;
      continue;
    }
    let a = (min[axis]! - o) / d,
      b = (max[axis]! - o) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return near <= length && far >= 0 ? Math.max(0, near) : null;
}

registerProjectileKind({
  id: 'arrow',
  model: ARROW_MODEL_ID,
  gravity: 0.05,
  drag: 0.99,
  damageScale: 2,
  pickup: true,
});

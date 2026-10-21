# M13d — Projectiles & bows

Decisions followed from the M13d task prompt.

## 1. Shared ECS projectile module

- `src/entity/projectiles.ts` defines `ProjectileC` with `{ owner, kind, stuck, ageTicks, pickup }`, plus `ProjectileVelocityC` for velocity and an internal stuck-block anchor.
- A projectile is a regular M13a ECS entity with `EntityKindC`, `TransformC`, and `RenderableC`; its `EntityKindC.type` is its kind id, so `getEntities({ type: 'arrow' })` includes arrows.
- Kinds are data `{ id, model, gravity, drag, damageScale, pickup }` registered with `registerProjectileKind`. M13d registers only `arrow`.
- `fireProjectile(ecs, { kind, from, dir | aimAt, speed, owner })` creates the entity. The system is installed once per player ECS by `PlayerController` and is shared by later projectile kinds.
- Projectiles have no `BodyC`, so they do not press plates or tripwire. Their swept entity collision uses M13a `BodyC` boxes directly.

## 2. Arrow model and orientation

- The arrow is one M13a model with shaft, metal head and two feather fletchings. Its 64×16 skin is drawn in code from three four-color ramps following ART.md.
- Transform pitch is optional for ordinary entities. Projectiles set pitch from their flight velocity; `computePose` interpolates it and rotates the model around its local X axis after yaw. The model faces +Z, matching the M13a model convention.
- The entity renderer still submits one draw per projectile entity.

## 3. Physics and collisions

- Each 20 Hz step subtracts kind gravity from vertical velocity, then multiplies all velocity axes by kind drag. Water uses drag `0.6`; the arrow's air drag is `0.99` and gravity is `0.05` blocks/tick².
- A `VoxelRaycaster` tests the segment from the old position to the candidate position against block collision shapes. This reuses the exact DDA and shape table used for block interaction, so full-speed shots cannot tunnel through blocks.
- Entity collision uses a swept segment against expanded AABBs for living ECS entities and the player. The owner is skipped for the first 5 ticks. A block wins a distance tie.
- A block hit places the arrow 0.05 blocks back from the hit point and freezes its current orientation. The block cell is stored as the anchor. When that cell has no collision shape, the arrow drops its kind as a normal `ItemEntity` with downward velocity. A stuck arrow with pickup allowed also spawns its item when the player is within 1 block; ordinary item pickup handles inventory insertion.
- Projectiles expire at 1200 ticks. Stuck projectiles therefore meet the required despawn limit.

## 4. Damage

- Damage is `ceil(speed × damageScale)` at the collision point.
- Mob damage calls M13c `hurtMob`, preserving its invulnerability window and attacker state. Default radial knockback is disabled for that call, then the projectile applies the M13c knockback magnitude along its flight direction on the first landed hit.
- Player damage calls M13c `hurtPlayer`, preserving shield frontal blocking and armor reduction. A landed hit applies velocity along the flight direction.
- Entity hits consume the projectile even when invulnerability or a raised shield blocks health loss.

## 5. Aim solver

- `solveAimDirection` uses the lower ballistic solution for the configured gravity and launch speed. If the target is out of range, it uses a 45° direction toward the target's horizontal bearing. With zero gravity it aims directly at the target.
- Drag is omitted from the aim equation; runtime physics still applies drag every tick.

## 6. Bow charge and HUD

- `BowController` starts charging on `use` only when the held item is a bow and survival inventory contains an arrow (creative needs none). The charge increments once per simulation tick and clamps at 20 ticks.
- Release fires at charge ≥ 0.1 with speed `3 × (c² + 2c) / 3`, from the player's eye along the look direction. Survival consumes one arrow from inventory; every fired shot uses one bow durability. Creative shots have `pickup: false`.
- Bow use consumes the use action before M13c combat and block interaction, preventing the same press from feeding a creature or placing a block.
- The HUD replaces the M13c cooldown meter with the same 14-pixel inset fill while a bow is charging, including at full charge.

## 7. Debug and tests

- `getProjectile(id)` returns `{ pos, vel, stuck, owner, kind }`; `getEntities` reports the projectile type through M13a ECS snapshots.
- `tests/unit/m13d-projectiles.test.ts` covers the closed-form gravity/drag integration, full-speed wall collision, mob damage and invulnerability, block-break drops, charge speed, ballistic aim, arrow and bow use, creative pickup rules, player shield/armor and HUD charge quantization.
- `tests/e2e/m13d.spec.ts` fires by holding and releasing the real `use` action, samples the arrow every tick until it embeds in a wall 20 blocks away, then walks into the stuck arrow and checks inventory pickup.
- M13d does not connect M13c's ranged goal; M13f supplies a kind and uses the shared API.

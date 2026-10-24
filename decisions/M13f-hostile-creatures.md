# M13f — Hostile creatures

Decisions given by the orchestrator in the task prompt (1–12), followed by choices made while building them.

## 1. Built on M13e's kit

- One file per creature: `src/entity/mobs/hollow.ts`, `thornling.ts`, `skitterer.ts`, `sporeburst.ts`. Type ids: `hollow`, `thornling`, `skitterer`, `sporeburst`. `src/entity/mobs/index.ts` imports them.
- Each file exports its model, skin, palette and `CreatureDefinition`, and registers them with `registerCreature()`. Drops go through `definition.drops`.
- `PRIORITY` in `creature.ts` gained the hostile keys: `target 0, climb 0, swell 1, avoidSunlight 1, leap 2, attack 3`. Targeting, climbing and leaping claim flags of their own (`target`, `jump`), so they run beside the move goals.
- `CreatureDefinition.climbing` (new, default false) is passed to `addMob`, for the Skitterer.

## 2. Designs and skins

- Flat skins (ART.md): each region is 2–3 shades of a hand-picked ramp, lit from above. Patterns are deliberate shapes only (bark grain strokes, knots, seams, warts), never noise.
- Every texel is in the creature's exported palette, and each skin's luminance gap is at least 60 (unit-tested, as for M13e).
- Designs, all original:
  - **Hollow**: a gaunt husk of dark, grey-brown bark wound in faded linen strips:
    - the torso is hunched 28° forward, and the head juts forward on a thick neck;
    - deep sockets with ember eyes, and a dark mouth crack under a linen jaw wrap;
    - long arms with twig fingers hang forward;
    - linen bands on the knees.
  - **Thornling**: a walking knot of dark green briar on four splayed legs:
    - pale, red-tipped thorns stick out of it, with a few dark berries;
    - one gold eye with a slit pupil and a glint;
    - a briar lid slides over the eye every 70 ticks (the `blink` clip).
  - **Skitterer**: a low, glossy, deep blue-green crawler:
    - a thorax and a long domed abdomen, with a bright sheen streak, amber seams between segments and a spiked ridge;
    - four pale eyes and hooked mandibles;
    - six two-segment legs moving in a tripod gait;
    - drawn 1.2× its model size.
  - **Sporeburst**: a waddling mushroom:
    - a three-tier mauve cap with cream warts and dark gills underneath;
    - a pale fibrous stem with two small eyes and a slit mouth;
    - two stubby root legs with toes;
    - while it swells it grows by 35 % and flashes to a pale copy of its model (`sporeburst_flash`) every 4 ticks.
- Collision: Hollow 0.7 × 1.95, Thornling 0.8 × 1.1, Skitterer 0.95 × 0.7, Sporeburst 0.8 × 1.4. Every width is at most 0.95.

## 3. Behaviour

- **Hollow**: `TargetPlayerGoal`, `AvoidSunlightGoal` (M13c), `MeleeAttackGoal` (3 damage), `WanderGoal`. In daylight it seeks a cell with sky light < 15 within 16 blocks.
- **Thornling**: `RangedAttackGoal` with min 8 and max 12 blocks. It strafes and fires a `thorn` projectile every 40 ticks:
  - The projectile kind is registered with M13d's `registerProjectileKind`: gravity 0.05, drag 0.99, damage scale 2.5, `pickup: false`.
  - `fireThorn()` launches it at 0.9 blocks per tick through `fireProjectile` with `aimAt`, and passes `pickup: false` explicitly.
  - Its model is `projectile_thorn`.
- **Skitterer**: `ClimbWallGoal` (M13c movement climbs walls) and a new `LeapGoal` (`src/entity/ai/goals/leap.ts`):
  - It leaps from 1.5–4 blocks with 0.5 horizontal and 0.4 vertical speed, then waits 40 ticks before the next leap.
  - `MeleeAttackGoal` deals 2 damage.
  - `SkittererTargetGoal` only targets the player when the Skitterer is not in daylight, or once the player has hit it. Daylight means the sun is up and the sky light at its cell is ≥ 12.
- **Sporeburst**: a new `ApproachGoal` (`src/entity/ai/goals/approach.ts`) walks up to 1.5 blocks without attacking. `SporeSwellGoal` extends M13c's `SwellGoal` (power 3, fuse 30, start within 3 blocks, cancel beyond 7):
  - It adds the growth and the flash.
  - On the burst tick it leaves a spore cloud, then M13c's `blast()` hurts the player and the Sporeburst is removed. Nothing is removed from the world.
  - A burst drops nothing, because `runtime.remove` skips the death and its drops. A killed Sporeburst drops its table.
- **Spore cloud** (`src/entity/mobs/spore-cloud.ts`) is a minimal local effect:
  - It is an entity with a transform, renderable and animator but no body or health, so blasts, projectiles and attacks ignore it.
  - It lasts 100 ticks, with drifting puffs that grow in and fade out.
  - While the player's feet are within 2.5 blocks horizontally of its centre (and −2…+1 vertically), it calls the new optional `MobPlayer.slow(0.5, 10)`.
  - Its system is installed once per ECS world, by the first cloud.
- **Player slowing** (`src/entity/player-slow.ts`): a module-level map keyed by the player:
  - The strongest factor and the longest duration win. `Player.tick` multiplies its walking speed by `takePlayerSlow(this)`, except while flying.
  - When the map is empty this returns 1 straight away. Nothing is added to the Player object.
  - The player controller wires `slow` into its `mobPlayer`. There is no general status-effect system.

## 4. Player i-frames (M13c follow-up)

- `PLAYER_INVULNERABLE_TICKS = 10` in `src/gameplay/combat.ts`. After `hurtPlayer` takes health, further `hurtPlayer` calls do nothing for 10 ticks. This covers mob melee, projectiles (thorns, arrows) and blasts, all of which go through `hurtPlayer`.
- A raised shield is checked first, so it still blocks and wears during the window.
- Environmental damage (`survival.damage`: fall, lava, cactus, drowning…) is unchanged.
- The ticks are kept in a `WeakMap` beside the player and counted down at the start of `PlayerCombat.tick()`.
- `playerInvulnerableTicks(player)` reads them.
- **Change to M13c's test (owner-approved, 2026-10-23, option A, relayed by the orchestrator):**
  - `tests/unit/m13c-combat.test.ts` › "blocks frontal hits with a raised shield in either hand and wears it" dealt four hits in the same tick, and two of them now fall inside the i-frames.
  - The test now runs `PlayerCombat.tick()` 10 times before the hit from behind and before the last hit. Every assertion and value stays the same.
  - M13f adds its own test that a second entity hit within 10 ticks does nothing and one after 10 ticks lands.

## 5. No natural spawns; data for M13g

The four types spawn only through `spawn` and `summon`. `CreatureDefinition` has no spawn rules, and no rule is registered. M13g should register these `SpawnRule`s (`src/entity/spawning.ts`). The weights and group sizes below are suggestions:

| type       | category | where (Appendix B)               | biomes                       | weight | group size |
| ---------- | -------- | -------------------------------- | ---------------------------- | ------ | ---------- |
| hollow     | hostile  | dark areas                       | all (`[]`)                   | 100    | [2, 4]     |
| thornling  | hostile  | dark areas                       | all (`[]`)                   | 80     | [1, 3]     |
| skitterer  | hostile  | dark areas, caves                | all (`[]`)                   | 80     | [1, 2]     |
| sporeburst | hostile  | dark areas, mushroom-heavy caves | all (`[]`); more in mushroom caves | 60     | 1          |

- "Dark areas" is the spawner's existing hostile light rule (`HOSTILE_MAX_SKY`, effective sky light < 8), so caves are covered.
- The Skitterer's daylight neutrality is behaviour, not a spawn rule.
- Sporebursts in mushroom-heavy caves: weight them up where the spot's surrounding blocks include Glowcap or mushroom blocks, or add a cave-biome rule once such a biome id exists. The current `SpawnRule` only filters by biome.

## 6. Performance

- Nothing runs until the first creature spawns. The creature system and the spore-cloud system are each installed once per ECS world.
- With no slowed player, the player's tick does one map size check.
- No properties are added to or redefined on World, Player or other shared objects.
- Pathfinding goes through M13c's navigator and budgets.

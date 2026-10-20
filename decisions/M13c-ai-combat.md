# M13c — AI, spawning & combat

Decisions given by the orchestrator in the task prompt (1–6), followed by choices made while building them.

## 1. AI architecture

- Goals live in `src/entity/ai/goals/`, one file each. `GoalSelector` (`src/entity/ai/goal.ts`) holds `{priority, goal}` entries. A goal has `canStart()`, `shouldContinue()`, `start()`, `tick()` and `stop()`, and claims flags (`move`, `look`, `jump`, plus `target` for the goal that picks the target).
- Each tick:
  1. Running goals whose `shouldContinue()` fails are stopped.
  2. In rank order, an idle goal whose flags are free, or held only by lower-ranked goals, and whose `canStart()` holds stops those holders and starts.
  3. Every running goal ticks.
- A lower priority number ranks higher. Equal priorities go to the earlier registration (`add()` keeps a stable order).
- The selector runs inside the ECS as the AI system at order −500. Navigation follows at −400, movement at −300 and natural spawning at −200, all between M13a's snapshot (−1000) and animation (1000) systems. The ECS ticks at 20 Hz.
- Components (`src/entity/ai/components.ts`):
  - `AiC`: the selector.
  - `MobBodyC`: movement abilities, velocity in blocks per tick, and this tick's wish, jump and climb intent.
  - `TargetC`: target, last attacker, its position and the hurt time.
  - `LoveC`: love ticks, breeding cooldown, baby flag.
  - `MobC`: category and foods.
  - `NavC`: the navigator, added lazily.
  - `CombatC`: invulnerability frames and the last damage.
- `addMob(ecs, id, options)` adds these to an entity from `spawnModelEntity`. The goal factory runs on the mob's first AI tick, so entity-type spawners don't need the runtime.
- Target references: `0` (`PLAYER_TARGET`) is the player, otherwise an ECS id (always ≥ 2²⁰). This matches the debug API's `kill(0)`.

## 2. Movement and paths

- `moveMob` (`src/entity/ai/movement.ts`) moves mobs with the existing `CollisionWorld` sweep (`BlockCollision` from `physics.ts`):
  - gravity 0.08 b/tick² unless flying
  - a 0.6-block step-up
  - a 0.42 b/tick jump (one block)
  - swimming
  - wall climbing at 0.2 b/tick
- A mob in an unloaded column freezes. The movement and AI systems skip it.
- One shared `WorldAdapter` and `Pathfinder` per world (`worldPaths()` in `runtime.ts`), because each adapter chains `world.onBlockEdited`.
- Column load and unload call `adapter.invalidate()` through a new `world.columnListeners` hook. `WorldManager` announces each applied column with `world.notifyColumnLoaded(cx, cz, generated)`, and `World.removeColumn` announces the unload.
- `PathScheduler` (`navigation.ts`):
  - Runs M13b's incremental searches with a global budget of 2000 expanded nodes per tick (`PATH_NODE_BUDGET`), charged as `nodesExpanded` deltas.
  - Steps searches round-robin. Each pass splits the remaining budget evenly between the active searches, and the start of the rotation moves every pass.
  - **Choice:** at most 3 searches are active at once (`MAX_ACTIVE_SEARCHES`), and the rest queue. Each concurrent M13b search holds its own pooled `SearchContext` of several MB, so 30 concurrent contexts would cost about 100 MB.
  - **Choice:** a search that reaches 4000 nodes (`MAX_SEARCH_NODES`) is disposed and reported as `limit`.
- `PathSearch.dispose()` is called on every search that is:
  - abandoned (`Navigator.stop`)
  - replaced (a re-path)
  - capped
  - owned by a removed or dying entity (`scheduler.prune` each tick)
  - left over when the runtime is disposed
- Re-path policy (`Navigator.moveTo`):
  - From idle, a path is requested at once.
  - While moving, a re-path happens only when the goal moved more than 2 blocks from the one the path was made for **and** at least 20 ticks passed since the last request.
- **Choice:** chasing goals (melee, ranged approach, breeding) pass `direct: true`. Until a path exists, or when none does, they steer straight at the goal and re-path every 20 ticks. Flyers always steer directly; A* is for walkers.

## 3. Goals

| Goal (name)                   | Behaviour                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WanderGoal` (wander)         | Idles 60–200 ticks, then walks to a random standable cell 2–10 blocks away.                                                                                                                                                                                                                                          |
| `FleeGoal` (flee)             | Starts the tick after a hurt with an attacker position. Runs 8 blocks away from the attacker for 100 ticks at 1.25× speed. A new hurt restarts it.                                                                                                                                                                  |
| `FollowFoodGoal` (follow_food) | Follows a player within 8 blocks who holds one of the mob's foods, stopping 2 blocks away.                                                                                                                                                                                                                         |
| `BreedGoal` (breed)           | `feedMob()` sets love for 600 ticks. Two adults of the same type in love, off cooldown and within 8 blocks walk together. Within 1.5 blocks they spawn one baby through the type's factory with `{ baby: true }`, and both get a 6000-tick cooldown.                                                                   |
| `MeleeAttackGoal` (melee_attack) | Paths to the target. While the bounding boxes are within 1 block it hits every 20 ticks (the first hit lands at once) through `runtime.hurtTarget`.                                                                                                                                                              |
| `RangedAttackGoal` (ranged_attack) | Approaches beyond 12 blocks, backs off inside 8 and strafes in between. Calls an injected `fire(aimPoint, shooterId)` every N ticks while within 12. M13d supplies the projectile.                                                                                                                            |
| `AvoidSunlightGoal` (avoid_sunlight) | When the sun is up (`sunElevationSin > 0`) and sky light at head height is 15, walks to the nearest standable cell within 16 whose head cell has sky light below 15. Searches square rings, ±4 blocks vertically, and waits 20 ticks after a failed search.                                                  |
| `ClimbWallGoal` (climb_wall)  | Claims only `jump`, so it runs alongside a chase goal. Starts when the mob can climb, is blocked horizontally and its target is more than 0.5 above it. Moves up at 0.2 b/tick without A*. Continues while still blocked and not more than 0.5 above the target, so the feet clear the top. When the wall ends the mob walks on or falls. |
| `SwellGoal` (swell)           | Within 3 blocks of the target it swells for 30 ticks. A target farther than 7 blocks cancels it. Then `blast(center, power)` and the mob is removed with no death animation.                                                                                                                                         |
| `FlockGoal` (flock)           | Flyers only. Boids: separation inside 1.5 blocks, alignment and cohesion with same-type mobs within 4. Pulled toward the nearest torch, wall torch or lumite block within 8, circling it when close. Keeps lift off the ground.                                                                                    |
| `TargetPlayerGoal` (target_player) | Claims `target`. Targets a targetable player (alive, in survival) within 16 blocks and lets go beyond 24.                                                                                                                                                                                                       |

- **Choice:** there is no line-of-sight check for targeting.
- `src/gameplay/blast.ts` only damages entities and the player. There is no block removal (M14).
  - Radius = 2 × power.
  - Damage = (i² + i) × 2 × power, where i = 1 − d / radius, measured to the middle of each body.
  - The bursting mob is spared.
  - The player is hurt through the `MobPlayer.hurt` hook, so the shield and armor apply.

## 4. Spawning (`src/entity/spawning.ts`)

- Rules are data: `registerSpawnRule({type, category, biomes, groupSize, weight})`. M13c registers none.
  - `biomes: []` means every biome.
  - `groupSize` is a count or an inclusive `[min, max]`.
  - Rules whose type isn't registered are skipped.
  - The runtime takes its own `SpawnRuleRegistry`, which unit tests use with test-only types.
- Hostile spots:
  - a solid block below and 2 free cells
  - block light 0
  - sky × `skyLightMultiplier(time)` below 8
  - a horizontal distance of 24–128 from the player
- Each tick makes 4 hostile and 4 ambient attempts at random annulus points, alternating between the surface and a random height.
- **Choice:** when the streamer lights columns lazily (`onlyLitColumns`), an unlit column is never judged dark.
- Passive mobs spawn:
  - on a column's first generation (`world.unpopulatedColumns`, up to 8 columns per tick)
  - and every 400 ticks with a 1/10 chance per loaded column
  - on `grass_block`, in the rule's biomes
- **Choice:** ambient spots need 2 free air cells 24–128 blocks away, with no light condition.
- Caps (Appendix B): passive 12, hostile 40, ambient 10. They count mobs whose column is loaded.
- Despawn uses 3D distance:
  - Hostiles more than 128 blocks away are removed at once.
  - At 32–128, each has a 1/800 chance per tick.
  - Passive and ambient mobs never despawn.
- **Choice:** the set of populated columns lives in memory only, because creature persistence is out of scope.

## 5. Combat (`src/gameplay/combat.ts`)

- `PlayerCombat` runs before `BlockInteraction` each tick.
  - An attack raycasts living ECS entity boxes (reach 3 in survival, 5 in creative). If an entity is nearer than the targeted block, the entity takes the click and mining is held off for that press.
  - `use` on a mob with its food feeds it; survival consumes one item.
- Cooldown period: sword 12 ticks, axe 20, anything else 5.
  - Swinging, hitting or not, and changing the held item reset the meter.
  - Damage = base × (0.2 + 0.8c²).
- Crit: falling (vel.y < 0, not on ground, not in fluid) with c > 0.9 gives ×1.5.
- Knockback sets the mob's velocity to 0.4 b/tick horizontally away from the attacker and 0.36 up.
  - **Choice:** only mobs are knocked back; player knockback is out of scope.
- Invulnerability: 10 ticks. Inside them a bigger hit applies only the difference, with no knockback and no restart of the frames.
- Sweep: a sword with c = 1, on the ground and not sprinting hits every other living entity whose box is within 1 block of the target's and that stands within 3 of the player, for 1 damage plus knockback.
  - `Player.isSprinting` is new: true when the last tick moved at sprint speed.
- Shield: a shield in the main hand or the offhand (slot 40) with `use` held blocks a source in front (dot of facing and source direction > 0).
  - **Choice:** each blocked hit costs 1 durability, and the shield breaks at 336.
- Mob melee and blasts reach the player through `hurtPlayer()`: shield, then armor, then `survival.damage(amount × (1 − min(20, armor)/25), 'mob:<type>' | 'blast')`.
- Armor has one source, `armorPoints` in `data/items/armor.json`.
  - `ARMOR_DEFENSE` in `tools.ts` is now derived from the item data.
  - The HUD's armor bar uses `getTotalArmorDefense`.
- The HUD draws the cooldown meter (a 16×4 inset with an accent fill, quantised to 14 steps) under the crosshair while it recharges, in both modes, and hides it at full charge.
- **Known limitation:** weapons take no durability loss on hits.

## 6. Debug API

- `getEntityAI(id)` returns `{goal, target, pathLength, love, invulnerableTicks}` (`src/debug/api/entities.ts`).
  - `goal` is the highest-ranked running goal that claims `move`, otherwise the highest-ranked running goal. A hostile chasing the player therefore reports `melee_attack`, not `target_player`.
  - `target` is `0` for the player.
- `getEntities` state values are unchanged.
- `EntityQuery` results gain an optional `category`. `hostileWithin` (beds) accepts `category === 'hostile'` as well as the old `type === 'hostile'`.

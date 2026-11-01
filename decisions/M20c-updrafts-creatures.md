# M20c — Updrafts, creatures & close-out

1. **Updrafts are a pure seed field with O(1) lookups.** `src/world/updrafts.ts` `UpdraftField`
   divides the Hollowdeep into 48-block cells. A cell may hold one vertical cylinder (radius 5–9,
   75 % of cells before the biome check), placed by `hash3(deriveSeed(seed, 'hollowdeep:updrafts'))`
   wholly inside its cell. A cylinder exists only where M20b's own height field
   (`hollowdeepHeights(deriveSeed(seed, 'hollowdeep:shape'))`) puts a Driftstone Expanse floor
   (< 32) under its centre. It spans y 41–176, above the magma sea and under the ceiling. Lookups
   read one cell from a 1,024-slot direct-mapped cache of typed arrays, so loaded columns are never
   scanned and nothing is allocated per tick.
2. **One shared gravity factor, zero Overworld cost.** `gravityFactor(world, x, y, z)` returns 0.4
   inside an Updraft and 1 elsewhere. Only one world (the active Hollowdeep) holds a field, set by
   `WorldManager.attachDimension`. Every other world returns 1 after two comparisons. The player
   (32 b/s²), mobs (`MOB_GRAVITY`), item entities (12 b/s²) and primed Blast Charges (0.04/tick)
   multiply their gravity by it. Blast Charges are the game's only falling-block entity; no
   falling sand or gravel exists. No properties are added to World or Player; the dimension tag is
   a WeakMap (`src/world/world-dimension.ts`).
3. **Soft glow.** `src/render/updraft-glow.ts` draws the Updrafts in the 3×3 cells around the
   camera, at most 4 zones, as one `POINTS` draw of 40 motes per zone. The motes are placed in the
   vertex shader from the vertex id and time, so there are no buffers and no per-frame
   allocations. Motes rise 1.6 b/s through a 28-block band around the camera, and one in four is
   a wide, faint halo, so the column reads as softly glowing. It is drawn only in the Hollowdeep
   with particles on, and makes 0 draws when no zone is within 56 blocks. No screen tint was
   added.
4. **Glowwing** (`src/entity/mobs/glowwing.ts`): hostile flyer, health 14, 0.9 × 0.45.
   - Model: an M13e-kit model on a 128 × 64 skin. The pale membrane wings, seam and eyes, and
     trailing light ribbons are emissive parts; the body disc is not. Still one draw call.
   - Behaviour: it circles 6 blocks out and 5 above the player for 60–110 ticks, then dives at
     0.42 b/tick. A hit (4 damage through `hurtTarget`, so the player's i-frames apply) or 50
     ticks ends the dive, and it climbs out for 30 ticks.
   - Drops Luminous Membrane ×1–2.
5. **Flight pathfinding** (`src/entity/ai/flight-path.ts`): a bounded, incremental 6-neighbour A*
   over air cells inside a 41³ local cube.
   - Budget: 160 node expansions per tick are shared by every flyer of a world, and one search may
     use at most 2,400. Scratch g-scores, parents, generation stamps and the heap are allocated
     once and reused.
   - Results: an unreachable goal yields a partial path to the closest cell reached, if that cell
     is more than one block closer, otherwise `failed`.
   - When it searches: a Glowwing flies straight while the 6 cells ahead are open air, so open
     caverns cost no searches. Otherwise it follows its cached path. It re-plans only when the goal
     moves ≥ 4 blocks or the next waypoint becomes solid, at most once per 10 ticks, and never
     every tick.
6. **Magmaw** (`src/entity/mobs/magmaw.ts`): hostile aquatic, health 24, 0.9 × 0.6. Its model is
   an armoured eel of three plated segments with emissive seams and eyes.
   - Swimming: in lava it swims (`flying` while in lava, so no gravity) toward random lava cells
     within 8 blocks. It refuses any step whose next cell is not lava.
   - Lunge: with the player within 6 blocks and the 60-tick cooldown elapsed, it leaps toward
     them. Contact deals 5 damage through `hurtTarget` (i-frames) and sets them on fire for 100
     ticks through the new `MobPlayer.ignite`, which raises `survival.burningTicks` (the existing
     burn path, survival mode only).
   - Out of lava it crawls straight back to the last lava cell it was in, never wandering.
   - No mob takes lava or fire damage in this codebase, so it is immune by construction; a unit
     test pins this.
   - Drops Emberite Scale ×1–2.
7. **Dimension-aware spawning.**
   - Registries: `spawnRulesFor(dimension)` keeps one rule registry per dimension. The Overworld's
     is the unchanged `spawnRules` (M13g's test pins its exact contents);
     `registerSpawnRule(rule, 'hollowdeep')` adds to the Hollowdeep's.
   - Spot tests: a rule may bring its own `spot` test.
     - Glowwing: open air at y > 44 with 3 free cells below, 1 above and 4 around; all biomes;
       groups of 1–2; weight 20.
     - Magmaw: lava with lava below at y ≤ 40, in Magma Sea or Driftstone Expanse; group 1;
       weight 12.
     For such categories the spawner picks a random height instead of the roof.
   - The `PlayerController` builds each world's `MobRuntime` with its own dimension's rules, so
     Overworld creatures never spawn in the Hollowdeep and vice versa. The M13g per-tick attempt
     budget, the caps and `spawning: false` are unchanged.
8. **Glowcap Stew**: shapeless Glowcap + Bowl in `data/recipes/hollowdeep.json`.
   - Eating it sets `survival.nightVisionTicks = 600` (30 s), which counts down in
     `Survival.tick`. It is saved in the player record as an optional field, written only when
     > 0, and cleared on death and on reset.
   - While it is active the renderer raises the shared light-curve floor
     (`UnderwaterView.brightnessFloor`, used by chunks, entities and the player model) to 0.72.
   - There is no general status-effect system. Like the other stews, it leaves no bowl.
9. **Fog.** The entity and player-model shaders take a `u_dimensionFog` (rgb + enable) uniform:
   M20b's cavern fog colour in the Hollowdeep, disabled (one `uniform4f`) in the Overworld. Drops
   have no fog term at all, so they need no change.
10. **Voices and music.** M16a already shipped `creature.glowwing.*` and `creature.magmaw.*`
    recipes, and M16b's unit test iterates `creatureTypeIds()`, so it covers both creatures
    without an edit. The Hollowdeep mood already played (`scheduleMusic` uses the player's
    dimension). M20c adds only `sound.lastMusicContext` and a debug getter, and an e2e test that
    asserts `'hollowdeep'`.

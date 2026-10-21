# M13e — Passive creatures

Decisions given by the orchestrator in the task prompt (1–10), followed by choices made while building them.

## 1. One file per creature

- `src/entity/mobs/tuftbuck.ts`, `rootboar.ts`, `dapplefowl.ts`, `mossback.ts` and `glimmer-moth.ts`. Type ids: `tuftbuck`, `rootboar`, `dapplefowl`, `mossback`, `glimmer_moth`.
- Each file exports its model (at most 24 parts), its skin generator, its palette and its `CreatureDefinition`, and registers them with `registerCreature()`. That one call does `registerEntityModel`, `registerEntityType`, the `'use'` handler and `registerSpawnRule`.
- `src/entity/mobs/index.ts` imports the five files. `src/engine/player-controller.ts` imports it once, so the types exist whenever a world does.
- Shared code:
  - `src/entity/mobs/creature.ts`: the definition type, spawning, babies, drops and the creature system.
  - `src/entity/mobs/kit.ts`: building models without hand-written UVs, and the skin painter.

## 2. Designs and skins

- Every model is written without UVs. `buildModel()` packs each cube's box unwrap into the skin (tallest first, one texel apart) and throws if they do not fit. All cube sizes are whole pixels, so every face maps to whole texels.
- `SkinPainter` paints per cube with a hand-picked ramp (ART.md):
  - Faces are lit from the top-left: top lighter, bottom darker, side faces darkening downwards and slightly lighter on the left.
  - Shades are chosen with a 4×4 ordered dither, so transitions are dithered bands, not gradients.
  - Patterns:
    - `clumps`: 2–3 texel clusters in interlocking rows.
    - `strands`: 1-texel strands, 2–3 long, for fur, wool and bristles.
    - `spots`: 2×2 dapples.
    - `fringe`: ragged transparent ends on hanging hair; the renderer discards alpha < 0.5.
  - Details such as eyes, nostrils and eyespots are set texel by texel.
  - Skins are seeded; the renderer uses seed 1.
- Each creature exports its palette (its ramps plus its detail colours). The unit tests check that every skin texel is in it and that the darkest-to-lightest luminance gap is at least 60.
- Designs (all original; the owner judges them from the probe screenshots):
  - **Tuftbuck**: a stocky, dark, short-coated grazer:
    - a shaggy dark mane over the shoulders that hangs down the chest
    - a long face with a dark blaze and a beard
    - amber eyes with horizontal pupils, ears sticking out sideways
    - pale ridged horns that rise, arch back over the crown and curl forward to a tip above the eye
    - a short upright tail
    - The **fleece** is long hair hanging from the back and flanks (a saddle, two side curtains and a rump curtain), with ragged ends. It is not a wool box around the body: an earlier full-body fleece read like a sheep and was dropped.
  - **Rootboar**: a low, dark, grizzled boar:
    - shoulders higher than the haunches
    - a crest of stiff bristle spikes along the spine, tallest at the shoulders, near-black with rusty tips
    - a long tapering snout, dark leather rather than pink, ending in a small dark nose instead of a flat disc
    - pale tusks curving up and back, pointed upright ears, a thin tail
  - **Dapplefowl**: a round bird:
    - a slate-teal body rounded by a middle band and caps above and below, with cream 2×2 dapples
    - a tall fan of ember-orange crest plumes, an ochre beak and legs
    - feather-row wings, a fanned tail
    - No comb, wattle or white body.
  - **Mossback**: a slow tortoise:
    - a stepped, three-tier shell of ochre-brown plates with dark seams
    - moss in patches on each tier's top with drips over the edges
    - a small garden: two moss tufts, a fern frond, and pink, gold and white flowers
    - thick, scaly, olive-grey legs and a blunt head
  - **Glimmer Moth**: a tiny moth:
    - warm gold wings with darker veined rims and lumite-cyan eyespots on both sides
    - a fuzzy umber body and feathery antennae
- **Tuftbuck fleece by biome** (`tuftbuckWool`), chosen when it spawns:

  | Fleece | Biomes |
  | --- | --- |
  | cream | `plains`, `meadow` |
  | umber | `pine_taiga` |
  | snow | `snowy_tundra`, `frost_peaks`, `frozen_ocean` |
  | tan | `savanna`, `badlands`, `desert` |
  | ash (grey-beige, the default) | every other biome |

- **Choice:** the renderer has one skin per model, so the Tuftbuck has six models that share one geometry: five fleece variants and `tuftbuck_sheared`. The sheared skin leaves the fleece transparent, so shearing changes the model id and grazing restores the one it spawned with.
- Health (Appendix B): Tuftbuck 10, Rootboar 12, Dapplefowl 4, Mossback 30, Glimmer Moth 2.

## 3. Behaviours

- Goal priorities (`PRIORITY` in `creature.ts`; lower ranks higher):

  | Goal | Priority |
  | --- | --- |
  | withdraw | 0 |
  | flee | 1 |
  | breed | 2 |
  | follow food | 3 |
  | forage, lay egg | 4 |
  | wander, flock | 5 |

- Goal lists:

  | Creature | Goals | Food |
  | --- | --- | --- |
  | Tuftbuck | flee, breed, follow food, graze, wander | `wheat` |
  | Rootboar | flee, breed, follow food, root, wander | `tuber` |
  | Dapplefowl | flee, breed, follow food, lay egg, wander | `seed` |
  | Mossback | withdraw, amphibious wander | none, no breeding |
  | Glimmer Moth | flock (M13c), flying | none |

- New goals in `src/entity/ai/goals/`:
  - `ForageGoal` (`forage.ts`), shared by grazing and rooting:
    - Every min–max ticks, a mob standing (on the ground) on one of its ground blocks stops and plays its clip with its head down, then acts on that block.
    - A failed attempt (wrong block, or in the air) rolls a new wait.
    - Its timer counts down only while its flags are free, so not while the mob flees, breeds or follows food.
  - `LayEggGoal` (`lay-egg.ts`): claims no flags, so it never interrupts walking. Adults only.
  - `WithdrawGoal` (`withdraw.ts`).
  - `AmphibiousWanderGoal` (`amphibious-wander.ts`), reported as `wander`.
- **Tuftbuck:**
  - Graze: every 600–1200 ticks, on `grass_block`, it lowers its head for 40 ticks (clip `graze`). Then the block becomes `dirt` and the fleece regrows.
  - Shears: `'use'` with a shears-type tool on an unsheared adult drops 1–3 `wool` as one item entity and sets it sheared. The held shears lose 1 durability.
  - **Choice:** shears wear only in survival, like tools that break blocks.
  - Shears do nothing to a baby or to a sheared Tuftbuck.
- **Rootboar:** every 1200–2400 ticks, on `dirt` or `grass_block`, it roots for 30 ticks (clip `root`, the snout down and wiggling) and drops one `tuber` item entity at its snout.
- **Dapplefowl:**
  - It lays one `egg` item entity every 6000–12000 ticks.
  - `MobBody.maxFallSpeed` (new, `Infinity` by default, set from the `maxFallSpeed` option of `addMob`) caps its fall at 0.1 blocks per tick in `moveMob`, and it plays a `flap` clip while falling.
  - **Note:** no mob takes fall damage (M13c's movement has none), so "no fall damage" holds by construction. The unit test lands it from 20 blocks and checks its health.
- **Mossback:**
  - `WithdrawGoal` notices a hurt as a drop in health since its last look (any source). It then runs for 100 ticks:
    - It claims move, look and jump, and stops navigation.
    - Each tick it zeroes the wish and horizontal velocity, so knockback cannot move it, and cancels any upward hop.
    - It adds `DamageScaleC { scale: 0.2 }`, removed when it stops.
    - It plays the 100-tick `withdraw` clip: head, legs and tail pulled into the shell over 4 ticks, out again over the last 8.
  - A new hit while withdrawn restarts the 100 ticks and keeps the clip in its pulled-in hold.
  - The hit that causes the withdrawal lands in full; later hits are ×0.2.
  - `hurtMob` (M13c, `combat.ts`) multiplies incoming damage by `DamageScaleC` before the invulnerability check, so it applies to melee, mob attacks and blasts alike.
  - Amphibious wander: idle 60–200 ticks, then from land it heads for a water surface cell (water with air above), and from water for dry standable land, within 12 blocks. With nothing of the other kind in reach it wanders normally. It swims with M13c's movement.
- **Glimmer Moth:**
  - M13c's `FlockGoal` with `flying: true`, which circles torches, wall torches and lumite within 8 blocks.
  - A looping `flutter` clip starts at spawn.
  - `EntityModel.emissive` (new) makes the renderer pass light (1, 1, 1) instead of sampling the world. It is still one draw call, and the hurt tint and fog still apply.

## 4. Babies

- `AgeC { baby, ageTicks }` (`src/entity/ai/components.ts`) is on every creature.
  - **Choice:** adults spawn with `ageTicks = 24000`, so `ageTicks` is the creature's age in ticks.
- A baby (`{ baby: true }`, from breeding) gets:
  - model scale 0.5 (`Renderable.scale`, new, used by `computePose`)
  - half the body width and height
  - `LoveC.baby = true`, so it cannot breed
- The creature system adds 1 to `ageTicks` each tick. At 24000 ticks the creature grows up: full size, scale 1, `LoveC.baby = false`.
- `'use'` with its food on a baby adds 2400 ticks (10 % of 24000) and consumes the item in survival. On an adult the same food goes to M13c's `feedMob` (breeding).
- Breeding is M13c's `BreedGoal` (600 love ticks, 6000 cooldown). The baby comes from the type's factory with `{ baby: true }`.
- **Choice:** a baby drops nothing when it dies.
- `getEntityAI(id)` gains:
  - `baby`
  - `ageTicks` (null for a mob without `AgeC`)
  - `vel` (blocks per tick, for the knockback test)
  - `yaw` (used to frame the probe screenshots)

## 5. Spawn rules

- Every rule has groups of 2–4.

  | Creature | Category | Biomes | Weight | Extra |
  | --- | --- | --- | --- | --- |
  | Tuftbuck | passive | `plains`, `meadow`, `savanna` | 10 | |
  | Rootboar | passive | `oakwood_forest`, `birch_grove`, `pine_taiga` | 10 | |
  | Dapplefowl | passive | `plains`, `savanna` | 8 | |
  | Mossback | passive | `swampland`, `river`, `beach` | 6 | `ground`: `grass_block`, `sand`, `dirt`, `gravel` |
  | Glimmer Moth | ambient | any | 10 | `where`: `mothSpawnSpot` |

- `mothSpawnSpot` holds when the sun is below the horizon, the cell is `air`, and its block light is at least 8.
- Every biome id comes from `OVERWORLD_BIOME_IDS`, and a unit test checks that.
- **Choice:** two optional fields on M13c's `SpawnRule` (`src/entity/spawning.ts`):
  - `ground`: the blocks a passive mob spawns on. It defaults to `grass_block`, so existing rules are unchanged. Beach and river surfaces are sand.
  - `where(world, x, y, z)`: an extra spot test.
- How the spawner uses them:
  - `pickRule` takes the spot and keeps only rules whose ground and `where` fit it.
  - A passive attempt accepts the union of the passive rules' grounds.
  - Group members are tested against the chosen rule.

## 6. Drops

- Drops are rolled once, on the first tick of the death tip-over. They spawn as item entities at the middle of the body through `ItemEntityManager.spawn`.
  - Tuftbuck: `wool` ×1 if unsheared, plus `raw_tuftbuck_shank` ×1.
  - Rootboar: `raw_boar_chop` ×1–3.
  - Dapplefowl: `feather` ×0–2 and `raw_fowl` ×1.
  - Mossback: `shell_plate` ×1.
  - Glimmer Moth: nothing.
- No items or blocks were added. `tests/unit/m10a-reachability.test.ts` is unchanged.
- Rolls, spawn yaw and shear counts use one PRNG per ECS world, seeded from the world seed (`deriveSeed(seed, 'creatures')`). Timers use the mob runtime's PRNG.

## 7. `'use'` on a mob

- `src/entity/ai/interactions.ts` (new) is a registry of `'use'` handlers per mob type. A handler returns:
  - `'consume'`: one held item is used up.
  - `'wear'`: the held tool loses 1 durability and breaks at its limit.
  - `null`: nothing happened.
- `PlayerCombat.tick` (M13c) calls it before M13c's `feedMob`. Either way it cancels the block 'use' of that press.
- A creature's handler runs its own `interact` (shearing), then feeding a baby.

## 8. Performance

- **No new per-frame work, and no new shared-object properties:**
  - Nothing is added to or redefined on `World`, `Player` or any other hot shared object.
  - The creature system (order −450: after AI, before navigation) is added to an ECS world by the first creature spawned there (`contextFor`). A world that never had a creature runs nothing new each tick.
  - The renderer's only additions are a cached `emissive` flag per model and a scale read in `computePose`, both inside the existing per-entity loop.
- **Spawning:** with rules now registered, M13c's spawner works as designed:
  - first-generation passive attempts, up to 8 columns per tick
  - 4 ambient attempts per tick, which fail at once by day (the moth `where`)
  - the 400-tick passive scan
- The M04b streaming tests were timed on master and on this branch (handoff notes).
- **Draw calls:** a unit test renders 30 creatures (all five types, babies among them) in an unlit world. It checks one draw call each and full-bright light for the moths only.

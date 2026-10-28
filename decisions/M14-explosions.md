# M14 — Explosions

## Rays and atomic edits

- Cast the boundary rays of a 16×16×16 direction grid from the centre. Vectors are precomputed. Seeded intensity starts at `power * (0.7 + random * 0.6)`, loses 0.225 per 0.3-block step, and loses `(blastResistance + 0.3) * 0.22` on entering each occupied voxel. Resistance comes from `data/blocks`. Charging resistance once on voxel entry gives the specified power-4 stone crater size.
- Blackglass (1200) and Foundation Stone terminate rays and are never removed. Supported power is finite and bounded to (0, 8], with at most 48 steps per ray. Per-explosion cell samples cache palette/resistance reads across rays, and removal records are allocated once per destroyed voxel. Coordinates are deduplicated; block states are revalidated before committing a traced result.
- `World.removeBlocksSteps` writes the complete removal set before notifying block entities, Current, fluids or navigation. It adds prototype methods, not instance fields, to World.
- Damage, block removal, chain priming, loot and effects form the physical detonation. Lighting cleanup has a separate queue, so it cannot postpone another charge's physical detonation. Each explosion retains one light transaction and one final batch notification for meshing.

## Lighting and meshing

- Ray tracing yields every 64 rays. Light seeding and height work yield in bounded groups; flood-fill queues yield every 256 entries. The normal synchronous lighting API drains the same algorithms.
- A cached pool of LightEngine work contexts has independent BFS cursors, sharing the world's existing light storage and height cache. Ordinary edits and overlapping explosion transactions cannot overwrite one another's queue state. Touched sections are retained across yields, including RGB channels.
- Catch-up ticks share a nominal 32 ms simulation window for explosion work per rendered frame, checked between bounded slices; each tick also has a 6 ms work allowance. The window includes earlier simulation work, so catch-up cannot repeatedly spend a fresh allowance. Manual fixed-tick advancement retains the per-tick allowance. The system is removed when no primed charges or pending explosion work remain; idle worlds have no explosion scan or registered tick system.
- The final mesh notification deduplicates section keys, including geometry boundaries and smooth-light/AO neighbours. It uses the existing edit-mesh/version path, coalesces superseded work, and spreads snapshots and uploads through the existing frame budget. Only streaming-border or already-in-flight light regions use the streamer's bulk-light fallback.
- `waitForTerrain` also waits for queued edit snapshots, results and uploads. The weather heightmap updates once per x/z, scanning down from the previous cached surface instead of rescanning world height for every removed block.

## Drops and exposure

- Roll a seeded 1/power chance per destroyed block, then use `rollBlockLoot` and the existing `world.itemSpawner`. Loot tables retain transformations such as stone → cobblestone. Destroyed Blast Charges prime instead of dropping.
- The drop manager retains the same pool, physics, merge order, age and half-block merge radius. Resetting optional pooled fields to `undefined` replaces property deletion, preserving object shapes under a chain's drop load. Squared-distance comparisons avoid repeated square roots in stack merging.
- Exposure is the clear fraction of 27 shape-aware rays from the centre to points inside the entity's box. Skip targets outside the finite damage radius before doing any traversal. Evaluate exposure against intact cover. Preserve M13c's damage curve with `impact = max(0, 1-distance/(2*power)) * exposure`; knockback points away from the centre and scales with impact.
- Mobs use `hurtMob`; players still use `hurtPlayer`, preserving shield, armor and invulnerability behavior. Player velocity receives the impulse in its existing units.

## Sporeburst and Blast Charge

- `SwellGoal` routes bursts through `explode`. Sporeburst remains power 3, and `spawnSporeCloud` remains on its last swell tick. The only M13f test edit is the authorized block-removal assertion.
- State ID 820 is appended after 819 in `data/block-state-ids.json`; previous entries are unchanged. Flag this append in the PR.
- New block/item/loot registry entries and an original recipe: copper igniter above a sand core, with three Spore Powder packets (` C ` / `PSP` / ` P `).
- Original generated art: mauve pressed spore cakes inside copper framing, with a cream seal on the sides and fuse slot on top. Eight declared colors, deterministic seeded textures, and the existing generated isometric inventory icon.
- Priming is event-driven through existing world listeners: adjacent fire or received Current gives an 80-tick fuse; another explosion gives a seeded inclusive 10–30 tick fuse.
- Primed entities use ECS fuse/velocity components. They flash white every four ticks, fall with swept collision, and receive piston and explosion pushes. No properties are added or redefined on World, Player or other already-created shared objects.

## Effects and sound

- Brief flash and expanding smoke use free slots in the existing particle pool: at most 24 particles per blast and 96 active smoke particles. Smoke never evicts debris or embers. Existing debris replacement remains unchanged.
- Brief camera shake scales with distance. The local sound bridge uses the existing SynthesisEngine's low-pass noise and bass oscillator helpers, resumes on a real gesture, and coalesces calls within 100 ms. Full positional/reverberant mixing and the voice model remain M16b.

## Tests and owner-approved exception

- M14's unit tests own stone size, protected blocks, exposure, atomic edits, interleaved light transactions, weather-height batching, priming/fuses, physics/pushes, shape-stable pooled loot, loot chance, recipe and art checks.
- The chain E2E runs the real fixed-tick loop: its frame counter includes simulation, catch-up and drawing. The physical detonation deadline is 200 ticks; frame measurements continue through pending light and mesh cleanup. Other E2E checks own Blackglass shielding/open damage and the skylit crater screenshot.
- The owner approved exactly one M10a test edit: `blast_charge: { task: 'M14', reason: 'Crafted from spore_powder (Sporeburst drop)' }` beside the creature-drop exemptions. Nothing else in that file changes. M14's own recipe test supplies Spore Powder, checks craft count, and checks failure without it. The temporary blocker was removed before any commit.
- Owner verification rule: `MILESTONE=M14 npm run verify:quick` plus affected milestone E2E; Full verify: PR CI. Post the concrete publish gate and screenshot, then wait for the owner's reply before the first push. All remote operations use the GitHub plugin.

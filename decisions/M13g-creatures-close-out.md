# M13g — Creatures close-out

## Spawn rules

Natural rules use M13c's `registerSpawnRule` registry and the spawn data in the M13e, M13f and M13h decisions files.

| Creature | Category | Biomes | Weight | Group | Spot conditions |
| --- | --- | --- | ---: | --- | --- |
| Tuftbuck | passive | plains, meadow, savanna | 10 | 2–4 | Grass below |
| Rootboar | passive | oakwood_forest, birch_grove, pine_taiga | 10 | 2–4 | Grass below |
| Dapplefowl | passive | plains, savanna | 8 | 2–4 | Grass below |
| Mossback | passive | swampland, river, beach | 6 | 2–4 | Sand or grass below, water within a fixed local probe |
| Glimmer Moth | ambient | all Overworld biomes | 10 | 2–4 | Night, air at feet, block light ≥ 8 |
| Hollow | hostile | all Overworld biomes | 100 | 2–4 | M13c hostile spot, including block light 0 |
| Thornling | hostile | all Overworld biomes | 80 | 1–3 | M13c hostile spot, including block light 0 |
| Skitterer | hostile | all Overworld biomes | 80 | 1–2 | M13c hostile spot, including block light 0 |
| Sporeburst | hostile | all Overworld biomes | 60 | 1 | M13c hostile spot; weight 180 in mushroom-heavy caves |
| Cinderwraith | hostile | all Overworld biomes | 10 | 1 | M13c hostile spot, including block light 0 |

Sporebursts use a fixed 3×3×3 local mushroom probe. Three or more brown, red or Glowcap mushroom blocks below the cave surface raise weight from 60 to 180. Hostile spots retain M13c's effective-sky check as well as block light 0, so open noon does not produce hostiles while dark night spots can.

Appendix B caps remain passive 12, hostile 40 and ambient 10 across loaded columns. Hostiles beyond 128 blocks despawn; those beyond 32 blocks have a 1/800 per-tick chance. Spawn groups and their retries have fixed upper bounds.

## Bounded work and the spawning switch

- The spawner has eight shared candidate-attempt slots per tick, rotated among categories with rules. A passive periodic candidate replaces one of those slots every 400 ticks; it does not enumerate loaded columns.
- Generated passive columns queue in insertion order until each receives its first-generation attempt. The queue contains only generated columns that are still loaded, drains through the fixed attempt budget, and removes entries when columns unload or spawning is disabled; overflow is never dropped. The recently populated-key set evicts its oldest key at 256 entries. There are no per-column-load scans or unbounded historical column sets.
- Every member of a selected spawn group is checked with the full rule, biome, and category conditions. This applies species-specific `where` checks, including the Glimmer Moth's nighttime and block-light requirements, to followers as well as the initial candidate.
- There is no scan of `loadedColumns()` in the spawning path. `World` only receives the existing column notification, with an optional flag that skips the queue when spawning is off. No properties were added to `World`, `Player` or other hot shared objects.
- `createWorld({ spawning })` defaults to true. With `spawning: false`, column notifications do not queue work and the ECS spawn system is not installed. The debug `setSpawning(enabled)` method toggles the active runtime and clears pending work when disabled.
- Natural spawning uses the existing per-world mob runtime and PRNG; there are no test-condition branches.

## Creature and player follow-ups

- A climbing mob can hold its vertical position against a ceiling while its climb goal remains active, move along the underside using its pursuit wish, and release near its target or after leaving the ceiling. This is stored on the mob-body component.
- Player entity-damage immunity clears on death and again on respawn. `hurtPlayer` also avoids restoring immunity after a lethal hit callback.

## M04 culling performance A/B

The unchanged test `tests/e2e/m04.spec.ts` filtered to `at render distance 8 only the columns in view`,
with `--retries=0`, was run against GitHub `master` (`67f5596dea1974930415484eb27b157e4c8aae5b`),
this implementation, and this implementation with `createWorld({ spawning: false })` in a temporary
copy of the spec. The test assertions and timeouts were unchanged.

| Run | Result and time | Final streaming stats |
| --- | --- | --- |
| GitHub `master` | Failed at the 120 s idle deadline (~2m27 total) | 1 mesh queued; 275 uploads deferred; 247/289 meshes uploaded |
| M13g, spawning on | Passed in 2.7 min | Culling counts: east 664, west 630, total 2,053 |
| M13g, spawning off | Failed at the 120 s idle deadline (~2m27 total) | 199 uploads deferred; 259/289 meshes uploaded |

An earlier full E2E batch also timed out in the culling test on this branch with 8 deferred uploads;
the isolated on-run passed, while both master and spawning-off runs timed out with substantially
more uploads deferred. This is variable container behavior, not evidence that natural spawning
slows M04. No spawn code change was made from this A/B. The full M04 suite still needs GitHub CI
evidence, including the expected container-sensitive failures recorded in the handoff.

## Existing test edits approved by the owner

On 2026-10-25, the owner approved only the `spawning: false` option in these E2E setups:

- `tests/e2e/m07b.spec.ts`: `spawning: false` in its `beforeEach` world setup.
- `tests/e2e/m08c.spec.ts`: `spawning: false` in `stage()`.
- `tests/e2e/m17b.spec.ts`: `spawning: false` in `newWorld()`.

On 2026-10-26, the owner approved replacing the obsolete negative spawn assertion at line 112 in
`tests/unit/m13h-cinderwraith.test.ts`. It now expects exactly one Cinderwraith rule with hostile
category, group size 1 and rare weight 10. Hostile category uses M13c's shared dark-spot test
(block light 0 and effective sky light below 8); M13g unit coverage verifies that condition for
Cinderwraith. No other part of that test file was changed.

## Tests and visual review

- Unit tests cover the ten registrations, biome eligibility, ground, moth time/light/air and follower checks, hostile block light and noon, cave-biased Sporeburst weight, group sizes, filling and enforcing caps, despawning, draining more than 128 generated columns, disabled-system behavior, ceiling movement and death/respawn immunity.
- M13g E2E tests cover a nonzero hostile population that remains at or below 40 after 2,000 night ticks, no noon hostiles, and the three Visual Review captures.
- `docs/screenshots/M13g/m13-creatures.png`: a daylight row containing Tuftbuck, Rootboar, Dapplefowl, Mossback, Glimmer Moth, Hollow, Thornling, Skitterer, Sporeburst and Cinderwraith; their silhouettes and color palettes are distinct. Glowwing and Magmaw are Hollowdeep creatures in M20, so they are not in this Overworld row.
- `docs/screenshots/M13g/m13-combat.png`: a Hollow caught immediately after a sword hit, with the red hurt tint visible.
- `docs/screenshots/M13g/m13-night.png`: a Hollow and Skitterer moving toward the player under an unlit night sky.

## Verification and handoff

- `MILESTONE=M13 npm run verify:quick` passed: typecheck, lint, placeholders, 1,134 unit tests and 16 M13 E2E tests.
- Required additional E2E command covered M04, M06, M07b, M08c, M11 and M17b: 28 passed, 7 expected container failures (M04 lines 66, 131, 221 and 277; M17b's autosave-slice checks at lines 232 and 543, plus the line-588 sleep-time timeout in untouched code). The M04 line-131 culling timeout reproduced on GitHub master and with spawning off; the isolated branch run passed.
- Do not run full `npm run verify`.
- **Full verify: PR CI** — all M13 specs must be green there. The CI shard 2 streaming run should remain around 15–23 minutes with no flaky tests.
- Status and PR title become `verified` only after PR CI is green. The first push waits for the owner's publish-gate reply with these items and screenshots.

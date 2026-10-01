# M03b-fix — Terrain proportions, rivers & full-height meshing

Status: verified
Depends on: M03b, M05a-fix
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 107 passed · e2e 13 passed · console errors 0

## Acceptance criteria mapped to tests

- Noise fixes, persistent 0.5 / lacunarity 2.0, ridged peaks remapping to [0, 1] -> `tests/unit/terrain.test.ts` › "proportions test over sample windows for standard and alt seeds"
- Proportions targets across 3 combined $2048 \times 2048$ windows for standard and alt seeds -> `tests/unit/terrain.test.ts` › "proportions test over sample windows for standard and alt seeds"
- River recipe, domain warping, central differences gradient, carving profile and banks -> `tests/unit/terrain.test.ts` › "river shape test over 512x512 windows for both seeds"
- 3D density noise scaling (full 22 at $y \ge 110$, fading to 0 at sea level / river channels) -> `tests/unit/terrain.test.ts` › "agreement test between sampler and real generated columns"
- Export `sampleTerrainClimate(terrainStageSeed, wx, wz, out)` -> `tests/unit/terrain.test.ts` › "proportions test over sample windows for standard and alt seeds"
- Agreement test ($\ge 300$ real columns over both seeds with $\ge 95\%$ agreement, $\ge 100$ river columns with $\ge 90\%$ water top block) -> `tests/unit/terrain.test.ts` › "agreement test between sampler and real generated columns"
- River-shape test (3 $512 \times 512$ windows for both seeds, 4-neighbour BFS distances, 8-connected components, elongation) -> `tests/unit/terrain.test.ts` › "river shape test over 512x512 windows for both seeds"
- Lighting reference test order-independence fix and overhang cavity test (c) -> `tests/unit/region-lighting-reference.test.ts` › "(c) cross-column overhang cavity lighting correctness"
- Full-height meshing up to `sy = 19` and neighbor-aware uniform opaque section skipping -> `src/world/world-manager.ts` (`meshRadius`) & `tests/e2e/m03.spec.ts`

## Screenshots

- Screenshots: none (this task has no Visual Review)

## What was built

- Updated `src/gen/terrain.ts`:
  - Passed persistence 0.5, lacunarity 2.0 in all FBM and ridged noise calls.
  - Remapped ridged peaks values to $[0, 1]$ using `(v + 1) / 2`.
  - Implemented the river recipe using domain-warped Simplex 2D noise, central differences gradient estimation $d = |n| / |\nabla n|$, channel half-width $hw = 4$ shrinking to 0 for un-carved heights from y 100 to y 120, flat water channel carving at `SEA_LEVEL - 1 - round(3 * strength)`, and smoothstep bank transitions up to $hw + 6$.
  - Retuned continentalness, erosion, and peaks splines to achieve all required proportion targets.
  - Scaled 3D density noise to full 22 at un-carved $y \ge 110$, fading smoothly to 0 near sea level ($y \le 72$) and 0 in river channels/banks ($d < hw + 6$).
  - Implemented and exported allocation-free `sampleTerrainClimate(terrainStageSeed, wx, wz, out)`. Refactored `generateTerrainShape` to use `sampleTerrainClimate`.
- Updated `src/world/world-manager.ts`:
  - Expanded `meshRadius` to iterate through all sections up to `sy = 19`.
  - Skipped all-air sections.
  - Implemented uniform opaque section skipping rule: a uniform opaque section is skipped only when all 6 neighbor sections are loaded and uniform opaque.
- Updated `tests/unit/region-lighting-reference.test.ts`:
  - Converted `ReferenceLightEngine` to an order-independent three-phase algorithm (vertical pass across all columns, seeding pass across all columns, single queue processing pass).
  - Added test `(c)` verifying cross-column overhang cavity lighting correctness.
- Updated `tests/unit/terrain.test.ts`:
  - Added `proportions test over sample windows for standard and alt seeds`.
  - Added `agreement test between sampler and real generated columns`.
  - Added `river shape test over 512x512 windows for both seeds`.

## Decisions

- **Sampler 2D surface delegation:** `generateTerrainShape` delegates its 2D surface and river strength calculations directly to `sampleTerrainClimate`, ensuring 100% agreement between climate sampling and voxel generation.

## Shared-file edits explained

- `src/gen/terrain.ts`: Main terrain generation file owned by M03b.
- `src/world/world-manager.ts`: Updated section meshing loop in `meshRadius` to iterate up to `sy = 19` and apply neighbor-aware uniform opaque section skipping.
- `tests/unit/region-lighting-reference.test.ts`: Fixed reference lighting engine order-dependence and added test `(c)`.
- `tests/unit/terrain.test.ts`: Added owned terrain proportion, agreement, and river-shape unit tests.

## Known limitations

- `initializeColumnLight` in `src/world/lighting.ts` has the same per-column order bug and must not be reused for M04a streaming.
- Perimeter sections of the loaded area mesh their outer faces because unloaded neighbor columns do not count as opaque.
- `genMsP95` relative to the 6 ms budget in SPEC §2.3: measured `genMsP95` is ~0.15–0.28 ms, well within the 6 ms budget.

## Notes for dependent tasks

### Sampler API and field meanings
- `sampleTerrainClimate(terrainStageSeed: number, wx: number, wz: number, out: TerrainClimateSample): void`
  - `continentalness`: fBm 2D noise in $[-1, 1]$.
  - `erosion`: fBm 2D noise in $[-1, 1]$.
  - `peaks`: ridged 2D noise remapped to $[0, 1]$.
  - `river`: river channel strength in $[0, 1]$ (1 = channel centre, 0 outside channels).
  - `surfaceHeight`: final 2D surface height (block Y level) including river channel and bank carving.
  - Stage seed used by sampler is `deriveSeed(worldSeed, 'terrain_shape')`.

### River recipe parameters
- Base noise: `makeSimplex2D(deriveSeed(stageSeed, 'rivers'))` at `(wx * 0.0012, wz * 0.0012)`.
- Domain warp: amplitude 0.35 with 2-octave `makeFbm2D(persistence 0.5, lacunarity 2.0)` noises seeded `'river_warp_x'` and `'river_warp_z'` at `(wx * 0.0024, wz * 0.0024)`.
- Channel half-width $hw = 4$, shrinking to 0 for un-carved heights from y 100 to y 120.

### Measured terrain numbers for BOTH seeds

#### Standard Seed (`blockcraft-test-seed-42`)
- Combined Ocean: **30.81%** (target 25–45%)
- Window Oceans: **28.64%, 30.82%, 32.98%** (target 10–70%)
- River Channels: **2.99%** (target 1–6%)
- Land Median Surface Height: **75.3** (target 66–90)
- Columns $\ge y\ 120$: **3.16%** (target $\ge 2\%$)
- Max Height: **175.4** (target $\ge 150$)
- River/Land Cell Ratio: **3.11%** (target 1.5–5%)
- River Width p50: **4** (target 3–12)
- River Width p90: **8** (target $\le 20$)
- River Width max: **12** (target $\le 32$)
- River cells in components with elongation $< 4$: **1.00%** (target $\le 10\%$)

#### Alt Seed (`blockcraft-alt-seed-7`)
- Combined Ocean: **33.89%** (target 15–55%)
- Window Oceans: **34.96%, 34.76%, 31.94%** (target 10–70%)
- River Channels: **2.29%** (target 1–6%)
- Land Median Surface Height: **77.9** (target 66–90)
- Columns $\ge y\ 120$: **5.94%** (target $\ge 2\%$)
- Max Height: **171.3** (target $\ge 150$)
- River/Land Cell Ratio: **3.09%** (target 1.5–5%)
- River Width p50: **6** (target 3–12)
- River Width p90: **8** (target $\le 20$)
- River Width max: **12** (target $\le 32$)
- River cells in components with elongation $< 4$: **7.54%** (target $\le 10\%$)

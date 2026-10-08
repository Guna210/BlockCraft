# BlockCraft — Technical Specification & Build Plan (Jules edition)

> **Audience:** Google Jules, working on this repository one task per session. Each session implements exactly one task from Appendix E and ends in one pull request.
> **Goal:** a feature-complete, original, voxel sandbox survival game that runs entirely in the browser, built task by task, with every task proven by automated tests and visual evidence.
> **Binding operating rules:** `AGENTS.md` at the repository root. Read it in full at the start of every task. Where this file and `AGENTS.md` disagree about process, `AGENTS.md` wins; where they disagree about what to build, this file wins.

---

## 0. How This Specification Is Executed

### 0.1 Tasks, not one long session

The game is divided into 24 milestones (M00–M23), and every milestone is divided into one or more **tasks** (M00a, M00b, M01a, …). A task is the unit of work for one Jules session: one fresh VM, one branch cut from `main`, one pull request. The repository owner reviews and merges each PR, then starts the tasks whose dependencies are now all merged.

- Each milestone in Section 6 ends with a **Task breakdown** table saying which part of the milestone's Scope each task builds and which Acceptance Criteria and Visual Review items each task owns.
- Appendix E lists every task with its dependencies and the earliest round in which it can run. Tasks whose dependencies are all merged can run concurrently.
- A milestone is complete when all of its tasks are merged with `— verified` PR titles.

### 0.2 Cross-task rules that shape the code

- **Introduce what you use.** A task that adds a block or item also adds its texture generator, its registry entry, its icon (from M09b onward), and any debug API method its tests need.
- **No forward stubs.** Never create placeholder modules for later tasks; `lint:placeholders` applies to every task. If a later task will extend something, build the part your task needs completely and describe the extension point in your handoff notes.
- **Extend, never weaken, earlier tests.** A few tasks are told to add an assertion to an earlier milestone's e2e spec (M14 and M16b). That is the only sanctioned way to edit another milestone's tests.
- **Parallel-safe layout.** Data lives in per-category files (`data/blocks/*.json`, `data/items/*.json`, `data/recipes/*.json`, `data/loot/*.json`) loaded with `import.meta.glob`; the debug API is one module per domain under `src/debug/api/`; process records are one file per task in `progress/`, `decisions/`, and `blockers/`. Details in `AGENTS.md` §8.
- **Continuity lives in the repository.** Each task starts in a fresh VM. The handoff notes in `progress/<TASK-ID>.md` are how one task tells the next what exists, where it lives, and what to watch out for. Read the notes of every task yours depends on, and write yours for the task that comes after you.

---

## 1. Product Overview

**BlockCraft** is a browser-based voxel sandbox survival game. Players explore an infinite procedurally generated world made of blocks, gather resources, craft tools, build structures, survive hostile creatures at night, wire up logic circuits, travel to a second dimension, and optionally play together over a network.

### 1.1 Originality requirements (mandatory)

BlockCraft is an **original game** inspired by the voxel sandbox genre. It must not copy any existing game's protected assets or identity:

- **All textures are generated procedurally by code** in this repo (see M01). Do not download, embed, or reference texture packs, sprite sheets, or image assets from any existing game or the internet.
- **All sounds and music are synthesized procedurally** with the Web Audio API (see M16). No downloaded audio files.
- **All creature designs, names, UI layouts, logos, fonts, and splash text are original.** Use the names given in this spec (Appendix A, B). Do not use the names, visual designs, or trade dress of creatures, items, or characters from existing games.
- The logo is text-based, rendered with an original pixel font drawn in code.

Genre mechanics (block breaking/placing, crafting grids, day/night, hunger, etc.) are fine; copying specific assets and characters is not.

### 1.2 Target experience

- Launch the page → animated main menu → create world (name, seed, mode) → spawn in a lush, varied, believable landscape within 3 seconds on a mid-range laptop.
- Smooth 60 FPS gameplay at render distance 8 on a mid-range laptop with integrated graphics.
- Survival mode and Creative mode.
- Worlds persist across page reloads.

---

## 2. Technology Stack & Constraints

### 2.1 Required stack

| Concern            | Choice                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Language           | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true`                         |
| Build / dev server | Vite                                                                                     |
| Rendering          | **Custom WebGL2 renderer. No game engines, no Three.js, no Babylon.**                    |
| Math               | `gl-matrix` (the only allowed runtime rendering dependency)                              |
| Noise              | **Implemented from scratch** in this repo (seeded OpenSimplex2 or Simplex + value noise) |
| Concurrency        | Web Workers (worker pool) + transferable `ArrayBuffer`s                                  |
| Persistence        | IndexedDB (hand-written wrapper, no Dexie/localForage) + `CompressionStream`             |
| Audio              | Web Audio API, fully procedural                                                          |
| UI                 | DOM overlay (vanilla TS, no React/Vue) with CSS; pixel-art styling generated in code     |
| Multiplayer server | Node.js 20+, `ws` package, shares simulation code with client                            |
| Unit tests         | Vitest                                                                                   |
| E2E tests          | Playwright (Chromium) + `pngjs` for pixel analysis                                       |
| Lint               | ESLint + typescript-eslint, Prettier                                                     |

Allowed runtime dependencies: `gl-matrix`, `ws` (server only). Any other runtime dependency requires a written justification in a `decisions/` record and must not provide core game functionality (rendering, meshing, noise, physics, pathfinding, lighting, persistence, audio synthesis).

### 2.2 Runtime constraints

- The game must make **zero network requests** at runtime other than loading its own bundle and, in multiplayer mode, the WebSocket connection to its own server.
- Target browsers: latest Chrome, Firefox, Safari (desktop). Must also run in headless Chromium using SwiftShader for automated tests.
- Must never block the main thread for more than 50 ms after the initial world load.

### 2.3 Performance budgets

Measured on real hardware in headed mode via `npm run bench` (informational), and on CPU-side counters in automated tests (enforced):

| Metric                                                                  | Budget                            | Enforced in CI?            |
| ----------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| Main-thread CPU time per frame (update + draw submission, excludes GPU) | p95 ≤ 8 ms at render distance 8   | Yes (via debug API timers) |
| Chunk mesh upload work on main thread per frame                         | ≤ 3 ms                            | Yes                        |
| Chunk generation + meshing (worker) per 16³ section                     | p95 ≤ 6 ms                        | Yes                        |
| Draw calls per frame at render distance 8                               | ≤ 1500                            | Yes                        |
| Time from "Create World" to first rendered frame with terrain           | ≤ 3 s real HW, ≤ 20 s SwiftShader | Yes (SwiftShader bound)    |
| JS heap growth after walking 2000 blocks and back                       | ≤ 15% vs. start                   | Yes                        |
| Frame rate at render distance 8                                         | ≥ 60 FPS on mid-range laptop      | Informational (bench)      |

---

## 3. Architecture

### 3.1 Directory layout

```
/
├── SPEC.md  AGENTS.md
├── progress/  decisions/  blockers/   # one Markdown file per task (AGENTS.md §8, §12)
├── docs/screenshots/<TASK-ID>/     # Visual Review screenshots committed for the owner
├── .github/workflows/              # verify.yml (§5.6), harness-guard.yml (§5.7)
├── scripts/                       # verify, verify:quick, lint:placeholders implementations
├── index.html
├── src/
│   ├── main.ts                 # bootstrap, menu → game transition
│   ├── engine/
│   │   ├── loop.ts             # fixed 20 TPS simulation, interpolated rendering
│   │   ├── input.ts            # keyboard/mouse/pointer lock, rebindable actions
│   │   ├── events.ts           # typed event bus
│   │   └── rng.ts              # seeded PRNG (xoshiro128**), hash functions
│   ├── world/
│   │   ├── blocks/             # block registry, block states, properties
│   │   ├── chunk.ts            # 16×16×16 sections, palette compression
│   │   ├── column.ts           # 16×16 column of sections (y ∈ [0, 320))
│   │   ├── world.ts            # chunk map, get/set block, neighbor queries
│   │   ├── streaming.ts        # load/unload by distance + frustum priority
│   │   ├── lighting.ts         # sky + block light BFS, cross-chunk propagation
│   │   ├── fluids.ts           # water/lava simulation
│   │   └── ticks.ts            # scheduled block ticks, random ticks
│   ├── gen/
│   │   ├── noise.ts            # from-scratch noise implementations
│   │   ├── terrain.ts          # density, heightmaps, biomes
│   │   ├── caves.ts            # noise caves + worm carvers
│   │   ├── features.ts         # trees, ores, plants, lakes
│   │   ├── structures.ts       # ruins, dungeons, outposts
│   │   └── hollowdeep.ts       # second dimension generator
│   ├── mesh/
│   │   ├── greedy.ts           # greedy mesher
│   │   ├── models.ts           # non-cube block models (torches, plants, stairs...)
│   │   └── ao.ts               # per-vertex ambient occlusion + smooth light
│   ├── render/
│   │   ├── gl.ts               # context, error checking, resource tracking
│   │   ├── shaders/            # GLSL ES 3.00 sources
│   │   ├── atlas.ts            # procedural texture atlas + mipmaps
│   │   ├── textures/           # one generator function per block/item texture
│   │   ├── passes.ts           # opaque, cutout, translucent, sky, particles, UI-3D
│   │   ├── culling.ts          # frustum + cave (visibility graph) culling
│   │   ├── sky.ts  clouds.ts  weather.ts  particles.ts
│   │   └── entities.ts         # box-model entity renderer, skeletal animation
│   ├── entity/
│   │   ├── ecs.ts              # lightweight entity-component system
│   │   ├── physics.ts          # swept AABB, gravity, fluids, climbing
│   │   ├── player.ts
│   │   ├── mobs/               # one file per creature (Appendix B)
│   │   ├── ai/                 # goal-based AI, A* pathfinding on voxel grid
│   │   └── projectiles.ts
│   ├── gameplay/
│   │   ├── items.ts  inventory.ts  crafting.ts  smelting.ts
│   │   ├── tools.ts  survival.ts  combat.ts  explosions.ts
│   │   └── current/            # logic circuit system ("Current")
│   ├── ui/                     # DOM overlays: HUD, menus, inventory, chat, debug
│   ├── audio/                  # procedural synthesis, positional audio, music
│   ├── persist/                # IndexedDB, region files, serialization
│   ├── net/                    # protocol, client prediction, interpolation
│   ├── workers/                # gen.worker.ts, mesh.worker.ts, light.worker.ts
│   └── debug/api/              # window.__blockcraft (Section 4): one module per domain + index.ts
├── server/                     # Node multiplayer server (shares src/world, src/gameplay)
├── data/                       # one JSON file per category, loaded with import.meta.glob
│   ├── blocks/  items/  recipes/  loot/
└── tests/
    ├── unit/                   # Vitest
    ├── e2e/                    # Playwright, one spec per milestone: m00.spec.ts ...
    └── harness/                # READ-ONLY after M00b: fixtures, pixel analysis, error capture
```

### 3.2 Core design decisions (binding)

- **Coordinates:** right-handed, +Y up. World height 0–319. Sea level 64. Chunk columns are 16×16; sections are 16×16×16.
- **Block storage:** each section stores a palette (`Uint16` block-state IDs) plus a bit-packed index array whose bits-per-entry grows with palette size (1, 2, 4, 8, 16). Uniform sections (all air, all stone) store no index array.
- **Simulation:** fixed 20 ticks per second. Rendering interpolates entity positions between ticks. Simulation must be deterministic given seed + input log (enables replay tests and multiplayer).
- **Threading:** world generation, meshing, and bulk light propagation happen in a worker pool sized `max(2, navigator.hardwareConcurrency - 1)`. Workers receive section data as transferable buffers and return typed-array meshes.
- **Rendering passes (in order):** sky → opaque (front-to-back) → cutout (alpha-tested: leaves, plants) → entities → particles → translucent (back-to-front sorted: water, glass, ice) → block outline → first-person hand/item → post (underwater tint, damage vignette).
- **Vertex format:** packed into two `uint32`s per vertex where possible (position within section, normal index, UV index, AO, sky light, block light, tint index). Record the bit layout in a `decisions/` record.
- **Missing texture sentinel:** any block or item whose texture fails to resolve renders as a **magenta (#FF00FF) and black checkerboard**. The test harness detects this color; it must never appear in a correct build.
- **Debug mode:** `?debug=1` in the URL enables the debug API (Section 4), WebGL error checking once per frame (after every draw call when the URL also has `&glcheck=draw`), and the F3 overlay. Debug mode must not change gameplay behavior.

---

## 4. Debug API Contract (`window.__blockcraft`)

Available only when the page is loaded with `?debug=1`. This is the **only** way tests interact with game internals. Each method is added by the task that introduces its feature (see the Task breakdown tables) and lives in a domain module under `src/debug/api/`. Every method must be fully functional, not stubbed. All methods returning data must return plain JSON-serializable objects.

```ts
interface BlockCraftDebugAPI {
  // Lifecycle
  ready(): Promise<void>; // resolves when menu is interactive
  createWorld(opts: { name: string; seed: string; mode: 'survival' | 'creative'; type?: 'default' | 'flat' }): Promise<void>; // type defaults to 'default'
  loadWorld(name: string): Promise<void>;
  waitForTerrain(radiusChunks: number): Promise<void>; // resolves when all chunks within radius are generated, lit, meshed, and uploaded
  save(): Promise<void>;

  // Time control
  pause(): void;
  resume(): void;
  tick(n: number): Promise<void>; // advance simulation n ticks while paused
  setTimeOfDay(ticks: number): void; // 0 = sunrise, 6000 = noon, 12000 = sunset, 18000 = midnight
  setWeather(w: 'clear' | 'rain' | 'thunder'): void;

  // World queries & edits
  getBlock(x: number, y: number, z: number): { id: string; state: Record<string, string | number> };
  setBlock(
    x: number,
    y: number,
    z: number,
    id: string,
    state?: Record<string, string | number>
  ): void;
  fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: string): void;
  getLight(x: number, y: number, z: number): { sky: number; block: number };
  getBiome(x: number, z: number): string;
  getHeight(x: number, z: number): number; // highest non-air, non-fluid block
  locate(
    kind: 'ore' | 'structure' | 'biome',
    id: string,
    near: [number, number, number]
  ): [number, number, number] | null;
  worldHash(x1: number, z1: number, x2: number, z2: number): string; // stable hash of all block states in region

  // Player
  getPlayer(): {
    pos: [number, number, number];
    vel: [number, number, number];
    yaw: number;
    pitch: number;
    health: number;
    hunger: number;
    saturation: number;
    air: number;
    onGround: boolean;
    inFluid: string | null;
    mode: string;
    dimension: string;
    selectedSlot: number;
  };
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void;
  setGameMode(m: 'survival' | 'creative'): void;
  giveItem(id: string, count: number): void;
  getInventory(): Array<{ slot: number; id: string; count: number; durability?: number } | null>;
  input(action: string, down: boolean): void; // same action names as keybinds: 'forward', 'jump', 'sneak', 'attack', 'use', ...
  look(yaw: number, pitch: number): void;
  raycast(): { hit: boolean; block?: [number, number, number]; face?: string; entity?: number };

  // Entities
  spawn(type: string, x: number, y: number, z: number): number;
  getEntities(filter?: {
    type?: string;
    radius?: number;
  }): Array<{
    id: number;
    type: string;
    pos: [number, number, number];
    health: number;
    state: string;
  }>;
  kill(id: number): void;

  // UI
  openScreen(
    name: 'inventory' | 'crafting' | 'kiln' | 'chest' | 'pause' | 'settings' | 'creative'
  ): void;
  getScreen(): string | null;
  uiClickSlot(slot: number, button: 'left' | 'right', shift?: boolean): void;

  // Rendering diagnostics
  getRenderStats(): {
    fps: number;
    frameCpuMsP95: number;
    uploadMsP95: number;
    drawCalls: number;
    triangles: number;
    chunksLoaded: number;
    chunksMeshed: number;
    chunksVisible: number;
    glErrors: number;
    textureAtlasSize: [number, number];
    missingTextures: string[];
  };
  getWorkerStats(): { genMsP95: number; meshMsP95: number; queueLength: number };
  setRenderDistance(chunks: number): void;

  // Audio diagnostics
  getAudioStats(): { contextState: string; activeVoices: number; lastSounds: string[] };

  // Network (M21)
  getNetStats(): {
    connected: boolean;
    rttMs: number;
    playerCount: number;
    predictionCorrections: number;
  };
}
```

---

## 5. Verification Harness

### 5.1 Commands

| Command                     | Does                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`               | Vite dev server                                                                                                              |
| `npm run build`             | Production build to `dist/`                                                                                                  |
| `npm run typecheck`         | `tsc --noEmit`                                                                                                               |
| `npm run lint`              | ESLint + Prettier check                                                                                                      |
| `npm run lint:placeholders` | Fails if `TODO`, `FIXME`, `XXX`, `stub`, `not implemented`, `throw new Error('unimplemented')` appear in `src/` or `server/` |
| `npm run test:unit`         | Vitest                                                                                                                       |
| `npm run test:e2e`          | Builds, serves `dist/` with `vite preview`, runs Playwright                                                                  |
| `npm run verify`            | All of the above in order; exits non-zero on any failure; prints a summary table                                             |
| `npm run verify:quick`      | With `MILESTONE=Mxx`: typecheck, lint, placeholders, unit, and only that milestone's e2e specs. For iterating; never a substitute for `verify` |
| `npm run bench`             | Headed Chromium, fixed flight path, prints real FPS + frame-time histogram                                                   |

### 5.2 Playwright configuration requirements

- Use Playwright's **bundled** Chromium only (installed with `npx playwright install chromium`), per `AGENTS.md` §9. No system Chrome/Edge, no remote debugging connections, no persistent profiles.
- Chromium must run with WebGL2 available in headless mode. Use launch args:
  `--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`, `--ignore-gpu-blocklist`, plus `--js-flags=--expose-gc` (used by the M04b heap test).
- Viewport 1280×720, `deviceScaleFactor: 1`.
- Timeouts sized for SwiftShader (it is slow): per-test timeout 180 s.
- Tests run against the **production build**, not the dev server. Playwright's `webServer` builds and serves `dist/` with `vite preview` and shuts it down afterwards.

### 5.3 The shared fixture (`tests/harness/fixture.ts`)

Every e2e test uses a fixture that automatically:

1. Records every `console.error`, `console.warn` containing "WebGL", uncaught `pageerror`, and failed request (`requestfailed` or HTTP status ≥ 400).
2. Loads `/?debug=1` and awaits `__blockcraft.ready()`.
3. After the test body, **fails the test** if any recorded errors exist, or if `getRenderStats().glErrors > 0`, or if `getRenderStats().missingTextures.length > 0`.

### 5.4 Pixel analysis utilities (`tests/harness/pixels.ts`)

Implemented with `pngjs`. Every screenshot assertion saves the PNG to `artifacts/<milestone>/<name>.png` before asserting, so it exists for visual review even on failure. The screenshots named in a task's Visual Review are also copied by that task into `docs/screenshots/<TASK-ID>/` and committed, so the repository owner can review them in the pull request.

- `assertNotBlank(png)`: fails if > 98% of pixels are within ΔE 3 of a single color.
- `assertNoMissingTexture(png)`: fails if > 0.05% of pixels are within RGB distance 30 of `#FF00FF`.
- `assertColorVariance(png, minStdDev)`: luminance standard deviation above threshold (textures actually rendered, not flat-shaded).
- `regionMeanColor(png, rect)`: average color of a rectangle, for sky/ground/water checks.
- `assertHueInRange(png, rect, [hMin, hMax], minFraction)`: e.g. top of screen at noon is mostly sky-blue.
- `diffFraction(pngA, pngB)`: fraction of differing pixels, for "something changed" and "nothing changed" checks.

### 5.5 Canary test (proves the harness works)

`tests/e2e/m00-canary.spec.ts` must include tests that are **expected to fail** and are asserted to fail (using `test.fail()`):

- A page that throws an error → fixture must catch it.
- A canvas filled with magenta checkerboard → `assertNoMissingTexture` must fail.
- A solid black canvas → `assertNotBlank` must fail.

If the canaries stop failing, the harness is broken.

### 5.6 Continuous integration

`.github/workflows/verify.yml` (created in M00a) runs on every pull request and every push to `main`:

- `ubuntu-latest`, Node 22 with npm cache; `npm ci`; `npx playwright install --with-deps chromium`, with the browser cache keyed on the Playwright version.
- Runs `npm run verify`, the same command a task runs in its VM.
- Uploads `artifacts/` and the Playwright HTML report as workflow artifacts (7-day retention) whether the job passes or fails.
- Job timeout starts at 90 minutes. Raising it later is a harness change (§5.7).

A task whose PR shows a red CI check is not verified, whatever its own VM run reported.

### 5.7 Harness guard

`.github/workflows/harness-guard.yml` (created in M00b) runs on `pull_request_target` for the event types `opened`, `synchronize`, `reopened`, `labeled` and `unlabeled`, so the copy of the guard on `main` runs rather than the PR's copy. It reads the PR's changed-file list through the GitHub API (it never checks out or executes PR code) and fails if any of the following changed, unless the PR carries the label `harness-change`:

- `tests/harness/**`
- `.github/workflows/**`
- `playwright.config.*` and `vitest.config.*`
- `scripts/verify*` (covers `verify.*` and `verify-quick.*`) and `scripts/lint-placeholders.*`
- `SPEC.md` and `AGENTS.md`
- the `package.json` scripts `typecheck`, `lint`, `lint:placeholders`, `test:unit`, `test:e2e`, `verify` and `verify:quick`

Only the repository owner applies `harness-change`. It is expected on M21b (Playwright must start the multiplayer server) and on any PR where the owner agrees CI needs a longer timeout.

---

## 6. Milestones

Each milestone lists **Depends on**, **Scope**, **Acceptance Criteria** (automated, must be implemented as tests), and **Visual Review** (the agent must open the screenshots and confirm each point in writing), followed by a **Task breakdown** that splits it into Jules-sized tasks. Each Acceptance Criterion and Visual Review item is owned by one task; the two criteria split across tasks say so in their text.

Standard seed for all tests unless stated: `"blockcraft-test-seed-42"`.

---

### M00 — Scaffold & Verification Harness

**Depends on:** nothing

**Scope**

- Vite + TypeScript strict project, ESLint, Prettier, Vitest, Playwright, all `npm run` scripts from Section 5.1.
- `tests/harness/` fixture, pixel utilities, and canary tests (Section 5.3–5.5).
- Minimal `index.html` with a full-window canvas, WebGL2 context creation, clearing to a sky-blue color.
- Debug API skeleton: `ready()` and `getRenderStats()` fully working; other methods added in the milestones that introduce their features.
- Graceful error screen if WebGL2 is unavailable (original styled message, not a blank page).
- `progress/`, `decisions/`, `blockers/` and `docs/screenshots/` directories, each with a short README; CI workflow (§5.6) and harness guard (§5.7).

**Acceptance Criteria**

- [ ] `npm run verify` runs every stage and prints a summary table.
- [ ] Canary tests fail as expected (asserted via `test.fail()`).
- [ ] E2E: page loads with 0 errors; screenshot top-center region mean color is sky-blue (hue 190–215°).
- [ ] `lint:placeholders` detects a planted `TODO` in a temporary file (test creates, runs, deletes it).

**Visual Review**

- `m00-clear.png`: uniformly sky-blue canvas filling the viewport.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M00a** — Toolchain & scaffold | Vite + TypeScript strict project; ESLint, Prettier, Vitest; Playwright config per §5.2 (including `--js-flags=--expose-gc`, so M04b needs no config change); every script in §5.1 including `verify:quick` and the summary table, with `verify` and `lint:placeholders` implemented in `scripts/`; minimal `index.html` with full-window canvas, WebGL2 context and sky-blue clear; WebGL2-unavailable error screen; `src/debug/api/` module layout with `ready()` and `getRenderStats()`; `.gitignore` (`node_modules`, `dist`, `artifacts`, `test-results`, `playwright-report`); `progress/`, `decisions/`, `blockers/`, `docs/screenshots/` each with a short README; CI workflow (§5.6); a smoke e2e spec that loads `/?debug=1`, awaits `ready()` and fails on console errors (M00b moves it onto the shared fixture) | "`npm run verify` runs every stage and prints a summary table"; "`lint:placeholders` detects a planted `TODO`" |
| **M00b** — Verification harness | `tests/harness/` fixture (§5.3) and pixel utilities (§5.4); canary spec (§5.5); `m00.spec.ts` on the shared fixture; harness guard workflow (§5.7). Once this task is merged the harness is read-only. | Canary criterion; sky-blue e2e criterion; Visual Review `m00-clear.png` |

Order: M00a → M00b.

---

### M01 — Renderer Foundation & Procedural Texture Atlas

**Depends on:** M00

**Scope**

- WebGL2 abstraction: shader compilation with readable error reporting (file + line), buffer/VAO/texture wrappers with resource tracking and disposal, debug-mode `gl.getError()` once per frame (after every draw with `&glcheck=draw`).
- Perspective camera, free-fly controls (WASD + mouse with pointer lock), FOV 70 default.
- **Procedural texture system:** one generator function per texture producing 16×16 pixel art with deterministic seeded noise, dithering, and hand-tuned palettes. Must include at least: grass top, grass side (with dirt and overhanging grass fringe), dirt, stone, cobblestone, sand, gravel, oak/birch/pine logs (top + side), leaves ×3, planks ×3, glass, water (animated, 32 frames), lava (animated), all ores in Appendix A.
- Texture atlas packer with 4 px edge padding per tile and a **manually built mip chain** (mips generated per tile, not across tiles) to prevent bleeding.
- Render a test scene: a 5×5 grid of cubes, one per texture type, each correctly textured on all six faces.

**Acceptance Criteria**

- [ ] Unit: every block in the registry resolves to a texture; atlas contains no duplicate tile rects; texture generators are deterministic (same seed → identical pixel hash).
- [ ] Unit: mip level k tile size = 16 >> k, with no pixel sampled from a neighbor tile.
- [ ] E2E: test scene screenshot passes `assertNotBlank`, `assertNoMissingTexture`, `assertColorVariance(minStdDev=18)`.
- [ ] E2E: `getRenderStats().missingTextures` is empty.
- [ ] E2E: rotating the camera 90° produces `diffFraction > 0.3`.

**Visual Review**

- `m01-texture-grid.png`: each cube shows a distinct, recognizable material; grass sides have dirt below and a green fringe on top; no blurry seams or colored bleeding at tile edges.
- `m01-atlas.png` (atlas dumped to an image): tiles laid out cleanly with padding.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M01a** — WebGL2 core & camera | `render/gl.ts`: context and wrappers for shaders (compile errors report file + line), buffers, VAOs and textures, with resource tracking and disposal; debug-mode `gl.getError()` once per frame (after every draw with `&glcheck=draw`) feeding `getRenderStats().glErrors`; perspective camera (FOV 70); free-fly WASD + mouse with pointer lock; `engine/input.ts` with named, rebindable actions | Its own unit tests (resource tracking, shader error formatting) |
| **M01b** — Procedural textures & atlas | one generator per texture listed in the M01 Scope (16×16, seeded, dithered, hand-tuned palettes; animated water with 32 frames; animated lava); atlas packer with 4 px padding; per-tile manual mip chain; atlas dump to `m01-atlas.png` | Unit: generator determinism and no duplicate tile rects; Unit: mip-level tile size and no neighbor sampling; Visual Review `m01-atlas.png` |
| **M01c** — Texture test scene | 5×5 cube grid, one material per cube on all six faces; magenta/black missing-texture sentinel; `missingTextures` and `textureAtlasSize` in `getRenderStats()` | Unit: every texture-bearing block resolves to a texture (M02a re-points this test at the real registry); all M01 E2E criteria; Visual Review `m01-texture-grid.png` |

Parallel: M01a ∥ M01b (both can also run alongside M03a and M16a). M01c needs both.

---

### M02 — Chunk Data Structures & Meshing

**Depends on:** M01

**Scope**

- Block registry (`data/blocks/*.json` + typed registry), block states (e.g. log axis, stair facing).
- Palette-compressed sections (Section 3.2), columns, world map with `getBlock/setBlock` across chunk boundaries.
- **Greedy meshing** in a worker: merges coplanar faces with identical texture/light/AO into quads; face culling against neighbors including neighbors in adjacent sections (mesher receives a 18×18×18 padded copy).
- Separate mesh buckets per render pass (opaque / cutout / translucent).
- Flat test world (stone to y=60, dirt to 63, grass at 64) rendered at render distance 4.

**Acceptance Criteria**

- [ ] Unit: palette grows and shrinks correctly (1→2→4→8→16 bits), round-trip of random block data is lossless across 10,000 random writes.
- [ ] Unit: greedy mesh of a solid 16³ cube produces exactly 6 quads; checkerboard of alternating blocks produces the correct naive face count; no faces generated between two opaque neighbors across a section boundary.
- [ ] Unit: memory of an all-air section ≤ 64 bytes.
- [ ] E2E: flat world screenshot from y=80 looking at the horizon: top region sky hue, bottom region green hue (80–140°), `assertNoMissingTexture`.
- [ ] E2E: `getWorkerStats().meshMsP95 ≤ 6`.

**Visual Review**

- `m02-flat.png`: continuous grass plane with no gaps, cracks, or flickering seams between chunks.
- `m02-wireframe.png` (debug wireframe mode): large merged quads visible, confirming greedy meshing.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M02a** — Blocks & chunk storage | block registry loaded from `data/blocks/*.json` plus typed registry and block states; palette-compressed sections (§3.2); columns; world map with cross-boundary `getBlock`/`setBlock`; debug `getBlock`, `setBlock`, `fill` | Unit: palette growth/shrink and 10,000-write round-trip; Unit: all-air section ≤ 64 bytes |
| **M02b** — Greedy mesher | pure greedy mesher over an 18×18×18 padded copy; face culling including across section boundaries; opaque / cutout / translucent buckets; packed vertex format with its bit layout recorded in `decisions/` | Unit: solid cube = 6 quads, checkerboard face count, no faces between opaque neighbors across a boundary |
| **M02c** — Mesh workers & flat world | worker pool sized `max(2, hardwareConcurrency − 1)` with transferable buffers; mesh upload; flat test world at render distance 4; debug wireframe mode; `createWorld` (flat for now), `waitForTerrain`, `getWorkerStats` | E2E flat-world hue criterion; E2E `meshMsP95 ≤ 6`; Visual Review `m02-flat.png`, `m02-wireframe.png` |

Order: M02a → M02b → M02c.

---

### M03 — Procedural Terrain Generation

**Depends on:** M02

**Scope**

- From-scratch seeded noise: 2D/3D OpenSimplex2 (or Simplex), fractal Brownian motion, domain warping, ridged noise.
- Terrain from 3D density with continentalness, erosion, and peaks/valleys splines → oceans, plains, hills, mountains with overhangs, and cliffs.
- **Biomes** from temperature + humidity + continentalness (at least 12, Appendix C) with smooth color blending of grass/foliage tints across borders.
- Surface rules per biome (sand beaches, snowy peaks, gravel shores, red sand in badlands, clay patches in rivers).
- Rivers carved by a separate noise channel.
- **Caves:** noise "cheese" caverns, "spaghetti" tunnels, and worm carvers; underground aquifers at local water levels; lava lakes below y=12.
- Ores per Appendix A with depth distributions and vein shapes.
- Features: 5 tree types with procedural variation (including large 2×2 pines), tall grass, flowers, cacti, sugar reeds, pumpkins, mushrooms, boulders, ice spikes.
- Indestructible Foundation Stone floor at y=0–4 with noisy transition.
- All generation deterministic and runs in workers.

**Acceptance Criteria**

- [ ] Unit: `worldHash` of region (0,0)-(64,64) for the standard seed is identical across 3 runs and across worker counts 1, 2, 4.
- [ ] Unit: across a 2048×2048 sample, at least 10 distinct biomes appear; ocean coverage between 20% and 50%.
- [ ] Unit: ore counts per 1,000,000 blocks fall within ±25% of Appendix A targets; no ore above its max height.
- [ ] Unit: caves: ≥ 3% of underground (y 10–60) volume is air; at least one connected cave system ≥ 500 blocks in a sampled 128³ region.
- [ ] Unit: no floating single blocks of terrain (excluding features) in a sampled region.
- [ ] E2E: screenshots from 6 fixed viewpoints (plains, mountains, ocean, desert, snowy, underground cave with debug light) each pass `assertNotBlank` + `assertNoMissingTexture` + `assertColorVariance(20)`.
- [ ] E2E: `getBiome` at each viewpoint returns the expected biome.

**Visual Review**

- `m03-mountains.png`: tall, varied peaks with snow caps and exposed stone cliffs; not a smooth sine-wave landscape.
- `m03-biome-border.png`: grass color blends smoothly between biomes rather than changing abruptly at chunk borders.
- `m03-cave.png`: organic cave shapes, visible ores in walls.
- `m03-ocean.png`: water surface at sea level with sandy/gravel seabed visible nearby.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M03a** — Noise & RNG | `engine/rng.ts` (`xoshiro128**`, hash functions) and `gen/noise.ts` from scratch: 2D/3D OpenSimplex2 or Simplex, value noise, fBm, domain warping, ridged noise. Pure modules with no rendering dependencies | Its own unit tests: determinism per seed, output ranges, no NaNs, rough isotropy |
| **M03b** — Terrain shape & pipeline | `gen/pipeline.ts` as an ordered list of generation stages that later tasks append to; 3D density with continentalness, erosion and peaks/valleys splines (oceans, plains, hills, mountains, overhangs, cliffs); rivers; Foundation Stone floor at y 0–4; runs in the gen worker; `createWorld` uses it by default and gains an optional `type: 'default' \| 'flat'`, where `'flat'` is M02c's flat world; M03b changes `tests/e2e/m02.spec.ts` only to pass `type: 'flat'` to its `createWorld` calls; `worldHash`, `getHeight` | Unit: `worldHash` identical across 3 runs and worker counts 1, 2, 4 |
| **M03c** — Biomes & surface rules | ≥ 12 biomes from Appendix C chosen by temperature, humidity and continentalness; smooth grass/foliage tint blending; per-biome surface rules; `getBiome`, `locate('biome', …)` | Unit: ≥ 10 biomes in 2048×2048 and ocean coverage 20–50 % |
| **M03d** — Caves & aquifers | cheese caverns, spaghetti tunnels, worm carvers; aquifers at local water levels; lava lakes below y=12 | Unit: ≥ 3 % cave air and a connected system ≥ 500 blocks |
| **M03e** — Ores | every Overworld ore in Appendix A.4 with depth distributions and vein shapes; `locate('ore', …)` | Unit: ore counts within ±25 % and none above max height |
| **M03f** — Surface features | 5 tree types with procedural variation (including 2×2 pines), tall grass, flowers, cacti, sugar reeds, pumpkins, mushrooms, boulders, ice spikes, with per-biome densities | Unit: no floating single terrain blocks |
| **M03g** — Terrain close-out | the six fixed-viewpoint e2e tests; full milestone verification | Both M03 E2E criteria; all four M03 Visual Review items |

Parallel: M03a can start as early as round 3, alongside M01. After M03b: M03c ∥ M03d ∥ M03e. M03f needs M03c. M03g comes last.

---

### M04 — Infinite World Streaming

**Depends on:** M03

**Scope**

- Load/generate chunks in a spiral around the player within render distance (2–32, default 8); unload beyond distance + 2.
- Priority queue: distance, then in-frustum first, then direction of travel.
- Worker pool with cancellation of stale jobs when the player moves fast.
- Main-thread upload budget (≤ 3 ms/frame); remaining uploads deferred.
- Chunks fade in (dither dissolve) rather than popping.
- Memory bounds: GPU buffers for unloaded chunks are freed.

**Acceptance Criteria**

- [ ] E2E: fly 1000 blocks in a straight line at 30 blocks/s: `frameCpuMsP95 ≤ 8`, `uploadMsP95 ≤ 3`, no frame's main-thread work > 50 ms.
- [ ] E2E: after flying, `chunksLoaded` ≤ (2·(rd+2)+1)² columns.
- [ ] E2E: heap-growth test: fly 2000 blocks out and back; `performance.memory.usedJSHeapSize` growth ≤ 15% after forced GC (`--js-flags=--expose-gc`).
- [ ] E2E: tracked GL buffer count returns to within 10% of baseline after returning to spawn.
- [ ] E2E: screenshot at render distance 12 shows terrain reaching the horizon, no holes.

**Visual Review**

- `m04-horizon.png`: continuous terrain to the fog line; no missing chunks or holes.
- `m04-fast-flight.png` (mid-flight): at most a few chunks still loading at the far edge, near terrain fully present.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M04a** — Streaming core | spiral load/unload (render distance 2–32, default 8, unload beyond RD + 2); priority by distance, then in-frustum, then travel direction; stale-job cancellation; ≤ 3 ms/frame upload budget with deferral; GPU buffer freeing; `setRenderDistance`; a reusable scripted flight-path helper in `tests/e2e/helpers/` | E2E flight budgets; E2E `chunksLoaded` bound; E2E GL buffer count returns to baseline |
| **M04b** — Fade-in & memory | dither-dissolve chunk fade-in; heap-growth test with forced GC | E2E heap growth ≤ 15 %; E2E RD 12 horizon; Visual Review `m04-horizon.png`, `m04-fast-flight.png` |

Order: M04a → M04b.

---

### M05 — Lighting, Smooth Shading & Ambient Occlusion

**Depends on:** M04

**Scope**

- Two light channels, levels 0–15: **sky light** (propagates down unobstructed at 15, then diffuses with −1 per step) and **block light** (emitters: torches 14, lava 15, lumite 12, lamps 15, glowcaps 9).
- BFS flood-fill propagation and removal (two-queue algorithm), cross-chunk and cross-section, incremental on block edits.
- Per-vertex smooth lighting (average of 4 samples) and ambient occlusion (0–3), with **quad flipping** to avoid anisotropy artifacts.
- Light applied with a gamma curve; sky light brightness modulated by time of day (M12 will animate this; for now a uniform).
- Colored block light tint: torches warm orange, lumite cool cyan (mixed by max-per-channel).

**Acceptance Criteria**

- [ ] Unit: placing a torch in a dark enclosed 31³ room gives light 14 at the torch, 13 at distance 1 (Manhattan), 0 at distance ≥ 14.
- [ ] Unit: removing the torch returns all light in the room to 0 (removal queue correctness).
- [ ] Unit: light correctly crosses chunk borders (torch at x=15 lights x=16).
- [ ] Unit: covering a column with a roof removes sky light below; removing the roof restores 15.
- [ ] Unit: light updates for a single block edit touch ≤ 3 sections unless light actually propagates further.
- [ ] E2E: underground dark room screenshot mean luminance < 15; after placing a torch, mean luminance increases by > 40 and the torch-adjacent region's hue is orange (15–45°).
- [ ] E2E: corners of a placed 3-block-high wall show visible AO darkening (sampled pixel luminance at the inner corner < 75% of the wall center).

**Visual Review**

- `m05-cave-torch.png`: warm pool of light fading smoothly with distance; no hard per-block banding.
- `m05-ao.png`: soft shadows in inner corners and under overhangs; no diagonal seam artifacts across quads.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M05a** — Light engine | sky and block light (0–15) with BFS add/remove (two-queue algorithm), across sections and chunks, incremental on edits; light worker for bulk initial propagation; `getLight` | All five M05 unit criteria |
| **M05b** — Smooth lighting & AO | light integrated into generation and streaming; per-vertex smooth light and AO (0–3) with quad flipping in the mesher; gamma curve; sky-brightness uniform; emitters (torch 14, lava 15, lumite 12, lamp 15, glowcap 9) with warm/cool tint mixed max-per-channel; Torch block and texture | Both M05 E2E criteria; Visual Review `m05-cave-torch.png`, `m05-ao.png` |

Parallel: M05a is an early start. It needs only M02c, so it runs alongside M03b–M04b. M05b needs M04b and M05a.

---

### M06 — Player Physics & Controls

**Depends on:** M05

**Scope**

- Player entity 0.6×1.8×0.6, eye height 1.62; sneaking lowers to 1.5 height.
- Swept AABB collision against blocks resolved per axis; step-up for slabs (0.6 height); corner cases (stuck-in-block ejection).
- Walk 4.3 b/s, sprint 5.6 b/s (double-tap forward or sprint key), sneak 1.3 b/s; sneak prevents walking off edges.
- Jump with gravity 32 b/s², terminal velocity, air control, head bonk against ceilings.
- Swimming (buoyancy, slower movement, swim up with jump), ladders/vines climbing, soul-sand-style slowdown block ("Mire").
- Fall damage: (fall distance − 3) half-hearts, negated by water and hay bales.
- Creative flight: double-tap jump toggles; fly up/down with jump/sneak.
- Camera: sprint FOV +10% eased; subtle view bobbing (toggle in settings); smooth third-person view (F5 cycling front/back) with camera collision against terrain.
- Rebindable actions through `input.ts`.

**Acceptance Criteria**

- [ ] Unit: physics is frame-rate independent (same result at simulated 30, 60, 144 FPS render rates since simulation is fixed-tick).
- [ ] E2E: holding forward for 100 ticks on flat ground moves the player 21.5 ± 0.5 blocks.
- [ ] E2E: player cannot pass through a 1-block wall at sprint speed; cannot fit through a 1-block-high gap standing, but can through a 1.5-block gap while sneaking.
- [ ] E2E: sneaking toward a cliff edge for 60 ticks leaves the player on the edge (`onGround` true, y unchanged).
- [ ] E2E: falling 10 blocks deals 7 half-hearts; falling 10 blocks into water deals 0.
- [ ] E2E: jumping under a 2-block ceiling does not clip into the ceiling.
- [ ] E2E: in water, `inFluid === 'water'` and holding jump raises y.

**Visual Review**

- `m06-third-person.png`: player model visible from behind; camera not clipping into terrain.
- `m06-underwater.png`: blue tint and short fog distance underwater.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M06a** — Tick loop & movement | fixed 20 TPS loop with interpolated rendering; player entity (0.6×1.8×0.6, eye 1.62, sneak height 1.5); swept AABB per axis, 0.6 step-up, stuck-in-block ejection; walk/sprint/sneak speeds and sneak edge-stop; jump, gravity 32, terminal velocity, air control, head bonk; fall damage with water and Hay Bale negation; creative flight; debug `getPlayer`, `teleport`, `input`, `look`, `pause`, `resume`, `tick`, `setGameMode` | Unit: frame-rate independence; E2E: 100-tick walk, walls & gaps, sneak edge, fall damage (including into water), ceiling jump |
| **M06b** — Swimming, climbing & camera | swimming and buoyancy, ladders and vines, Mire slowdown; sprint FOV ease, view-bobbing toggle, third-person F5 cycling with camera collision, simple player box model; underwater tint and fog | E2E: `inFluid === 'water'` and holding jump raises y; Visual Review `m06-third-person.png`, `m06-underwater.png` |

Order: M06a → M06b.

---

### M07 — Block Interaction, Drops & Particles

**Depends on:** M06

**Scope**

- Voxel DDA raycast (reach 4.5 survival / 5 creative) with correct face detection and non-cube shapes (slabs, torches, plants have custom hitboxes).
- Block selection outline (thin dark wireframe, depth-offset).
- Breaking: progress based on block hardness, tool type/tier, and conditions (in water, airborne); animated crack overlay in 10 stages (procedurally generated textures).
- Placing: against targeted face, respecting player collision, orientation rules (logs by axis, stairs by facing/half, torches on walls).
- Drops: item entities with physics, bobbing/rotating 3D rendering of the block or a flat sprite for items, merge nearby stacks, magnetic pickup within 1.5 blocks, 5-minute despawn.
- Break particles using the block's texture, with physics and lighting.
- Creative mode: instant break, no drops, middle-click pick block.

**Acceptance Criteria**

- [ ] Unit: DDA raycast matches a brute-force reference raycast over 10,000 random rays.
- [ ] E2E: breaking stone with bare hands takes 7.5 s ± 0.2 s of held attack and drops nothing; with a wooden pick it takes 1.15 s ± 0.1 s and drops cobblestone.
- [ ] E2E: breaking a log drops a log item entity that is picked up within 1 s when the player stands on it; inventory count increments.
- [ ] E2E: placing a block where the player stands is rejected; placing adjacent succeeds.
- [ ] E2E: placing a log while looking along +X yields `axis: 'x'`.
- [ ] E2E: breaking a block causes the chunk to re-mesh within 2 frames and lighting to update (sky light below the hole becomes 15 when exposed to sky).

**Visual Review**

- `m07-cracking.png`: crack overlay at roughly mid-progress on the targeted block; outline visible.
- `m07-drops.png`: floating, rotating item entity; break particles visible and textured.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M07a** — Raycast, breaking & placing | voxel DDA raycast (reach 4.5 / 5) with custom hitboxes; selection outline; break progress per Appendix A.1 with 10 procedural crack stages; placing against faces with collision checks and orientation rules; creative instant break and pick block; `raycast()`; re-mesh and light update on edit | Unit: DDA vs brute force; E2E: placing into own space rejected; log axis; re-mesh within 2 frames and sky light below the hole; Visual Review `m07-cracking.png` |
| **M07b** — Drops, pickup & particles | item registry and inventory storage core (`giveItem`, `getInventory`) that M09a completes, with the tool items this task's tests need; item entities (physics, bobbing/rotating render, stack merging, 1.5-block magnetic pickup, 5-minute despawn); textured, lit break particles | E2E: stone break times and drops; E2E: log pickup; Visual Review `m07-drops.png` |

Order: M07a → M07b.

---

### M08 — Fluids & Transparent Blocks

**Depends on:** M07

**Scope**

- Water and lava as blocks with levels 0–7 plus source/falling flags.
- Flow simulation via scheduled ticks: water every 5 ticks, lava every 30 (every 10 in the Hollowdeep); spreads up to 7 blocks, prefers paths toward drops (search 4 blocks ahead), infinite source rule (2 adjacent sources over solid → new source).
- Water + lava interactions: flowing lava touching water → cobblestone; source lava touched by water → obsidian-equivalent "Blackglass"; water onto lava source from above → Blackglass.
- Fluid rendering: sloped surfaces from corner heights, flow direction animates the texture, translucent pass with back-to-front sorting per section and within sections for camera-near sections.
- Water surface shader: subtle vertex waves, Fresnel-based sky reflection color, depth-based color absorption using a depth pre-pass.
- Glass, ice, stained glass (8 colors, procedurally generated) in translucent pass; leaves in cutout pass with optional "fast/fancy" setting.
- Waving foliage and leaves shader (wind), respecting settings.

**Acceptance Criteria**

- [ ] Unit: a water source on a flat plane spreads to exactly the Manhattan-distance-7 diamond after it settles.
- [ ] Unit: infinite source rule creates a source in a 2×1 channel between two sources.
- [ ] Unit: lava/water interactions produce the correct blocks in all three cases.
- [ ] Unit: removing a source causes all dependent flowing water to recede to air.
- [ ] E2E: pouring water off a cliff produces a waterfall column reaching the ground within 60 ticks.
- [ ] E2E: screenshot through a glass wall into a lit room: `diffFraction` vs. same shot with the glass replaced by air is < 0.15 (glass is mostly transparent) but > 0.005 (glass is visible).
- [ ] E2E: no z-fighting flicker: two consecutive frames of a static water scene differ by < 1% of pixels when wave animation is paused.

**Visual Review**

- `m08-waterfall.png`: smooth sloped flowing water, animated texture, translucent.
- `m08-lake.png`: lake surface shows depth gradient (lighter shallows, darker depths) and reflection tint.
- `m08-lava-cave.png`: glowing lava lighting nearby stone.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M08a** — Fluid simulation | fluid level/source/falling states; `world/ticks.ts` with prioritized scheduled ticks and random ticks; flow rules (water 5 ticks, lava 30, spread 7, drop-seeking 4 ahead), infinite source rule, lava–water interactions (cobblestone, Blackglass), recession | All four M08 unit criteria; E2E waterfall reaches the ground within 60 ticks |
| **M08b** — Fluid rendering | sloped surfaces from corner heights, flow-direction texture animation, translucent back-to-front sorting per section and within near sections; water shader with vertex waves, Fresnel sky tint, depth pre-pass absorption | E2E no z-fighting; Visual Review `m08-waterfall.png`, `m08-lake.png`, `m08-lava-cave.png` |
| **M08c** — Glass, ice & foliage | Glass, Ice, Packed Ice and 8 Stained Glass colors in the translucent pass; leaves in the cutout pass with fast/fancy option; waving foliage and leaves shader | E2E glass transparency criterion |

Parallel: M08a ∥ M08c (and ∥ M09a). M08b needs M08a.

---

### M09 — Inventory & HUD

**Depends on:** M07

**Scope**

- Item registry (`data/items/*.json`): blocks-as-items, tools, food, materials; max stack sizes (64/16/1).
- Hotbar (9 slots, scroll + number keys), main inventory (27), armor slots (4), offhand (1).
- Inventory screen (E): pixel-art styled panels generated procedurally, item icons rendered from 3D block models (isometric, rendered once into an icon atlas at startup) or 2D sprites for flat items.
- Slot interactions: left click pick/place/swap, right click half-split/place one, shift-click quick move, drag-to-distribute (left drag = even split, right drag = one each), double-click collect all, drop with Q (Ctrl+Q whole stack), item tooltips.
- HUD: crosshair, hotbar with selection frame, health (hearts), hunger, air bubbles (only when submerged), armor bar, XP bar, item name popup on slot change.
- F3 debug overlay: FPS, frame times graph, position, chunk, facing, biome, light levels, target block, render stats, worker stats.
- UI scales with window size (integer scale factors for crisp pixels).

**Acceptance Criteria**

- [ ] Unit: exhaustive inventory operation tests: merge, split, swap, overflow, shift-click routing (hotbar ↔ main, armor into armor slots only), drag distribution math for 1–9 slots.
- [ ] E2E: via `uiClickSlot`, move 64 dirt from slot 0 to slot 20; split to 32/32 with right click; results match `getInventory()`.
- [ ] E2E: inventory screenshot passes `assertNoMissingTexture`, and every visible item icon slot region has `assertColorVariance(10)`.
- [ ] E2E: F3 overlay screenshot contains visible text (sampled region variance) and `getBiome` matches the overlay's biome (overlay exposes `data-biome` attribute).
- [ ] E2E: air bubbles appear only when the player's head is underwater.

**Visual Review**

- `m09-inventory.png`: clean, readable, original-styled inventory; 3D block icons shaded on three visible faces.
- `m09-hud.png`: hearts, hunger, hotbar crisp and aligned at bottom center.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M09a** — Items & inventory logic | complete item registry in `data/items/*.json` (blocks-as-items, tools, food, materials; stack sizes 64/16/1); full inventory model (hotbar 9, main 27, armor 4, offhand 1) with every slot operation as pure logic: pick/place/swap, half-split, place-one, shift-click routing, drag distribution, double-click collect, drop | Unit: exhaustive inventory operation tests |
| **M09b** — Inventory screen & icons | procedural pixel-art UI kit (panels, slots, tooltips, integer UI scaling); icon atlas (isometric 3D block icons rendered once at startup, 2D sprites for flat items); inventory screen (E) wired to M09a's operations; Q / Ctrl+Q drop; debug `openScreen`, `getScreen`, `uiClickSlot` | E2E move and split via `uiClickSlot`; E2E inventory screenshot and per-icon variance; Visual Review `m09-inventory.png` |
| **M09c** — HUD & F3 | crosshair, hotbar with selection frame, scroll and number-key selection, hearts, hunger, air bubbles, armor bar, XP bar, item-name popup; F3 overlay with frame-time graph and a `data-biome` attribute | E2E F3 overlay; E2E air bubbles; Visual Review `m09-hud.png` |

Order: M09a → M09b → M09c. M09a can run alongside M08a and M08c.

---

### M10 — Crafting, Smelting & Tools

**Depends on:** M09

**Scope**

- `data/recipes/*.json`: shaped (with mirroring), shapeless, and tag-based ingredients (any plank, any log). At least 120 recipes covering every craftable item in Appendix A.
- 2×2 personal crafting grid; 3×3 grid via the Workbench block.
- Recipe matching: O(1)-ish via precomputed index keyed by normalized pattern; shift-click crafts maximum possible.
- **Recipe book** panel: searchable, filter "craftable now", click to auto-fill the grid.
- **Kiln** (furnace equivalent): input, fuel, output slots; fuel burn times; 10 s per smelt; progress arrow and flame UI animate; keeps working when the player is away (block entity ticking in loaded chunks); gives XP.
- **Chest** block entity (27 slots), double chests when placed adjacent.
- Tool tiers: wood → stone → copper → iron → skyshard, with mining speeds, harvest levels, durability, and attack damage per Appendix A. Tools lose durability and break with particles + sound.
- Armor tiers with defense points reducing damage.

**Acceptance Criteria**

- [ ] Unit: every recipe in `data/recipes/` is craftable from its listed ingredients; no two recipes are ambiguous for the same grid; mirrored shaped recipes match.
- [ ] Unit: every item obtainable in survival has at least one acquisition path (crafting, smelting, drop, or loot) — graph reachability test from starting resources.
- [ ] E2E: craft chain via UI clicks only: log → 4 planks → sticks → workbench → wooden pickaxe; final inventory matches expected counts.
- [ ] E2E: kiln smelts 8 iron ore with 1 coal in 80 s of simulated ticks (use `tick()`), output 8 iron ingots, fuel consumed.
- [ ] E2E: a wooden pickaxe breaks after exactly 59 uses; iron ore mined with a stone pickaxe drops iron ore, with a wooden pickaxe drops nothing.

**Visual Review**

- `m10-workbench.png`: 3×3 grid with a valid recipe and the result shown.
- `m10-kiln.png`: kiln UI mid-smelt with flame and arrow partially filled.
- `m10-recipe-book.png`: searchable recipe list with icons.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M10a** — Recipes, tools & block-entity framework | `data/recipes/*.json` with ≥ 120 recipes (shaped with mirroring, shapeless, tag ingredients); indexed matcher; maximum-craft math; tool tiers, durability and damage per Appendix A.2; armor defense points; block-entity framework (per-type state, ticking in loaded chunks) | Unit: every recipe craftable, none ambiguous, mirroring works; Unit: survival reachability graph (every later task that adds items keeps it passing) |
| **M10b** — Crafting screens & chests | 2×2 personal grid; Workbench block with 3×3 grid; shift-click crafts the maximum; recipe book (search, craftable-now filter, click to auto-fill); Chest (27 slots) and double chests with UI | E2E UI-only craft chain; Visual Review `m10-workbench.png`, `m10-recipe-book.png` |
| **M10c** — Kiln & tool wear | Kiln block entity (input, fuel, output, burn times, 10 s smelts, XP, lit light 13, keeps working while the player is away) with animated UI; tool durability loss and breaking with particles; harvest-level drop rules | E2E kiln smelts 8 ores; E2E 59 uses and iron-ore harvest level; Visual Review `m10-kiln.png` |

Parallel: M10a can start right after M09a, alongside M09b. M10b ∥ M10c once M09c and M10a are merged.

---

### M11 — Survival Mechanics

**Depends on:** M10

**Scope**

- Health 20 (10 hearts), hunger 20, saturation, exhaustion accumulating from sprinting, jumping, mining, attacking, regenerating.
- Natural regeneration when hunger ≥ 18; starvation damage at 0 hunger.
- Food items with hunger/saturation values (Appendix A); eating animation (hold use, 1.6 s) with particles.
- Drowning (air 300 ticks), lava/fire damage with burning status, cactus contact damage, suffocation inside blocks, void damage.
- Death screen (original design) with cause of death, drop inventory as item entities, respawn at bed or world spawn.
- Bed: set spawn, skip night if the player sleeps (fade to black, time jumps to morning), cannot sleep with hostiles within 8 blocks.
- Damage feedback: red screen flash, camera tilt, hurt sound, hearts shake at low health.

**Acceptance Criteria**

- [ ] Unit: exhaustion/saturation/hunger model matches the table in Appendix D over a simulated 10-minute sprint scenario.
- [ ] E2E: submerge player for 400 ticks → air depletes to 0 at tick 300, then damage 2 half-hearts per second.
- [ ] E2E: standing in lava for 40 ticks deals damage, player is `burning`; exiting into water extinguishes.
- [ ] E2E: `kill` player → death screen shown (`getScreen() === 'death'`), respawn → at bed position if bed exists, inventory items exist as entities at death location.
- [ ] E2E: sleeping at time 13000 with no monsters nearby advances to ~0 (morning) and sets spawn.

**Visual Review**

- `m11-death.png`: death screen with cause text and respawn button.
- `m11-hurt.png`: red damage vignette visible.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M11a** — Survival model & hazards | health, hunger, saturation and exhaustion per Appendix D; regeneration and starvation; food items and eating (hold use 1.6 s, particles); drowning (air 300 ticks); lava/fire damage and burning; cactus contact; suffocation; void damage | Unit: Appendix D sprint scenario; E2E drowning; E2E lava and water extinguish |
| **M11b** — Death, respawn & beds | death screen with cause; inventory dropped as item entities; respawn at bed or world spawn; Bed block (sets spawn, sleeping skips night, refuses with hostiles within 8 blocks); damage feedback (red flash, camera tilt, heart shake) | E2E kill/death/respawn; E2E sleep; Visual Review `m11-death.png`, `m11-hurt.png` |

Order: M11a → M11b. M11 runs alongside M15.

---

### M12 — Sky, Day/Night Cycle & Weather

**Depends on:** M05

**Scope**

- 24,000-tick day (20 real minutes). Sun and moon (procedurally drawn, moon with 8 phases) on a tilted orbit.
- Sky dome with physically inspired gradient (Rayleigh-style approximation), sunrise/sunset glow toward the sun, stars at night with twinkle, distance fog blended to sky color.
- Sky light brightness curve drives the lighting uniform from M05 (no re-meshing needed for time changes).
- Clouds: layered procedural cloud field at y=192, rendered as extruded 3D cloud volumes with soft shading, drifting with wind; "fast" 2D option.
- Weather: rain (in temperate biomes), snow (cold biomes and high altitude), none in deserts; GPU-instanced particles; rain splashes on surfaces; puddle darkening; thunderstorms with lightning bolts (procedural branching geometry), flash lighting, and fire ignition chance.
- Snow layers accumulate slowly in cold biomes during snowfall; water freezes to ice in cold biomes.

**Acceptance Criteria**

- [ ] E2E: `setTimeOfDay(6000)` screenshot: top region hue sky-blue, luminance > 150. `setTimeOfDay(18000)`: top region luminance < 40 and star pixels present (count of isolated bright pixels > 50).
- [ ] E2E: `setTimeOfDay(12000)` looking west (toward the sun): horizon region hue orange-red (0–45°).
- [ ] E2E: `setWeather('rain')` in a plains biome: consecutive frames differ by > 2% (animated rain) and `getAudioStats().lastSounds` includes a rain sound (the rain-sound assertion is added by task M16b).
- [ ] E2E: same weather in a desert biome shows no precipitation particles near the player.
- [ ] Unit: sky light multiplier is continuous over the full day (no step > 0.05 between consecutive ticks).

**Visual Review**

- `m12-noon.png`, `m12-sunset.png`, `m12-midnight.png`, `m12-storm.png`: each clearly distinct and atmospheric; clouds visible in noon shot.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M12a** — Time & sky | 24,000-tick day; procedural sun and moon (8 phases) on a tilted orbit; sky dome gradient, sunrise/sunset glow, twinkling stars, fog blended to sky; sky-light curve driving the M05 uniform; `setTimeOfDay` | Unit: sky-light continuity; E2E noon and midnight; E2E sunset; Visual Review `m12-sunset.png`, `m12-midnight.png` |
| **M12b** — Clouds | cloud field at y=192 as extruded 3D volumes with soft shading and wind drift; fast 2D option | Visual Review `m12-noon.png` (clouds visible) |
| **M12c** — Weather | precipitation by biome (rain, snow, none), GPU-instanced particles, splashes, puddle darkening; thunderstorms with procedural lightning, flash lighting and fire chance; snow-layer accumulation; water freezing; `setWeather` | E2E rain animation (the rain-sound half is added by M16b); E2E no precipitation in desert; Visual Review `m12-storm.png` |

Parallel: the M12 track needs only M05b, so it runs alongside M06–M11. M12b ∥ M12c after M12a.

---

### M13 — Entities, Creatures & Combat

**Depends on:** M11, M12

**Scope**

- Lightweight ECS; entity box-model renderer with hierarchical parts, keyframed + procedural animation (walk cycle driven by speed, head tracking toward look target), per-entity lighting sampled from the world, hurt red tint, death tip-over animation.
- **All creatures from Appendix B**, each with an original design, procedurally generated skin textures, sounds (M16), drops, and behaviors.
- Goal-based AI: wander, flee, follow held food, breed, attack melee, attack ranged, avoid sunlight, climb walls, swell-and-burst, flock.
- **3D A\* pathfinding** on the voxel grid with jumping (1 block), dropping (≤ 3 blocks), swimming, door handling, avoidance of lava/cactus/cliffs; path caching and a per-tick pathfinding budget.
- Spawning: passive creatures in grass biomes on world gen and rarely thereafter; hostile creatures in light level ≤ 0 (block light) within 24–128 blocks of the player; mob caps; despawn rules for distant hostiles.
- Combat: melee with attack cooldown meter, critical hits while falling, knockback, invulnerability frames (10 ticks), sweeping attacks with swords; shields block frontal damage.
- Bows: charge-up, projectile physics with gravity and drag, arrows stick in blocks and can be picked up.
- Breeding with feed items, baby creatures that grow up over 20 minutes.

**Acceptance Criteria**

- [ ] Unit: A\* finds optimal paths on 50 generated test mazes (including jumps and drops) and respects forbidden blocks; mean solve time < 2 ms for paths ≤ 32 blocks.
- [ ] E2E: spawn a Hollow at distance 10 at night; within 200 ticks it reaches the player and deals damage.
- [ ] E2E: a Hollow placed in direct daylight moves to shade (block with sky light < 15 above it) within 300 ticks when shade exists within 16 blocks.
- [ ] E2E: a Skitterer climbs a 6-block vertical wall to reach the player.
- [ ] E2E: a Sporeburst adjacent to the player swells for 30 ticks then bursts, removing blocks in a radius (the block-removal assertion is added by task M14) and damaging the player; moving away > 7 blocks during the swell cancels it.
- [ ] E2E: striking a Tuftbuck while falling deals 1.5× damage and applies knockback (entity velocity away from player > 0).
- [ ] E2E: 2 Tuftbucks fed wheat within 5 blocks produce a baby within 100 ticks.
- [ ] E2E: at night in an unlit 64×64 area, hostile count stays ≤ the mob cap after 2000 ticks; at noon in the open, no new hostiles spawn.
- [ ] E2E: arrow fired horizontally drops due to gravity and embeds in a wall 20 blocks away.

**Visual Review**

- `m13-creatures.png`: lineup of every Appendix B creature spawned in a row, each visually distinct, textured, lit, and none resembling characters from existing games.
- `m13-combat.png`: hostile flashing red after being hit.
- `m13-night.png`: hostile creatures visible in the dark approaching.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M13a** — ECS & entity rendering | lightweight ECS; box-model renderer with hierarchical parts, keyframed and procedural animation (speed-driven walk, head tracking), world-sampled lighting, hurt tint, death tip-over; `spawn`, `getEntities`, `kill` | Its own unit tests (ECS queries, animation math) |
| **M13b** — A\* pathfinding | 3D A\* on the voxel grid with 1-block jumps, drops ≤ 3 blocks, swimming, doors, lava/cactus/cliff avoidance, path caching and a per-tick budget. Pure module over world queries | Unit: 50 mazes, forbidden blocks, mean solve < 2 ms |
| **M13c** — AI, spawning & combat | goal-based AI with every goal in the M13 Scope; spawning rules, mob caps (Appendix B), despawning; melee combat with cooldown meter, falling crits, knockback, 10-tick invulnerability, sword sweep, shield frontal block | Its own unit tests (goal selection, combat math) |
| **M13d** — Projectiles & bows | projectile physics with gravity and drag; bow charge-up; arrows stick in blocks and can be picked up; shared projectile module that the Thornling reuses | E2E arrow drop and embed |
| **M13e** — Passive creatures | Tuftbuck, Rootboar, Dapplefowl, Mossback, Glimmer Moth: original models, procedural skins, behaviors, drops, breeding, babies growing up over 20 minutes | E2E crit and knockback on a Tuftbuck; E2E breeding |
| **M13f** — Hostile creatures | Hollow, Thornling, Skitterer, Sporeburst: original models, procedural skins, behaviors, drops | E2E Hollow reaches the player; E2E Hollow seeks shade; E2E Skitterer climbs; E2E Sporeburst swell, cancel and damage (the block-removal half is added by M14) |
| **M13g** — Creatures close-out | natural-spawning verification; full milestone verification | E2E mob cap and no noon spawns; Visual Review `m13-creatures.png`, `m13-combat.png`, `m13-night.png` |

Parallel: M13b is an early start. It needs only M06b, so it runs alongside M07–M12. M13d ∥ M13e after M13c. M13f needs M13d.

---

### M14 — Explosions

**Depends on:** M13

**Scope**

- Blast Charge block (primed by fire, Current signal, or another explosion) with a 4 s fuse, flashing white, and physics (it falls, gets pushed).
- Explosion algorithm: ray-cast from the center in a 16×16×16 grid of directions, each ray's intensity decreasing by distance and block blast resistance; blocks removed in a single batched edit (one light update and one re-mesh per affected section).
- Drops: 1/power chance per destroyed block. Entities take damage by exposure (fraction of rays reaching them) and are knocked back.
- Chain reactions of Blast Charges with randomized short fuses.
- Explosion visuals: flash, expanding smoke particles, screen shake scaled by distance; sound.

**Acceptance Criteria**

- [ ] Unit: explosion in solid stone at power 4 removes between 20 and 60 blocks; Blackglass (resistance 1200) is never removed.
- [ ] E2E: 27 Blast Charges in a 3×3×3 cube chain-detonate completely within 200 ticks with no frame main-thread spike > 100 ms.
- [ ] E2E: a player behind a 3-thick Blackglass wall takes 0 damage; a player in the open at distance 3 takes damage.

**Visual Review**

- `m14-crater.png`: irregular, natural-looking crater; lighting correct inside it (sky light reaches the floor).

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M14** — Explosions | the whole M14 Scope; routes the Sporeburst burst through the explosion system and adds the block-removal assertion to the M13 Sporeburst test | All M14 criteria; Visual Review `m14-crater.png` |

---

### M15 — "Current" Logic Circuits

**Depends on:** M10

**Scope**

- Power levels 0–15. Components:
  - **Copper Trace** (wire dust): decays 1 per block; connects visually to neighbors including up/down steps; renders brighter with more power.
  - **Inverter Torch**: outputs 15 unless its attached block is powered; burnout protection if toggled > 8 times in 60 ticks.
  - **Relay** (repeater): 1–4 tick configurable delay, restores to 15, lockable from the side.
  - **Comparator-equivalent "Gauge"**: compare/subtract modes; reads container fullness.
  - Inputs: Lever, Button (stone 20 ticks, wood 30), Pressure Plate (entity detection), Tripwire.
  - Outputs: Lamp, Doors/trapdoors, **Piston** and **Sticky Piston** (push up to 12 blocks, block-entity movement animation, cannot move Foundation Stone/Blackglass/block entities), Dispenser, Note Block (plays procedural tones, M16).
- Strong vs. weak powering of blocks; quasi-connectivity is **not** replicated (keep logic clean and documented in a `decisions/` record).
- Update order deterministic; scheduled tick system with priorities.

**Acceptance Criteria**

- [ ] Unit: trace of length 20 from a lever: power 15 at 0, 1 at 14, 0 at 15.
- [ ] Unit: build via `setBlock` and test truth tables for NOT, AND, OR, XOR, and an RS latch built from components.
- [ ] Unit: 5-tick clock from Inverter Torch + Relays produces a stable period over 1000 ticks.
- [ ] Unit: piston pushes a line of 12 blocks; 13 blocks → does not extend; sticky piston retracts the attached block.
- [ ] E2E: a 2×2 piston door opens within 10 ticks of pressing a button and closes after the button releases; screenshots open vs. closed differ.
- [ ] E2E: a 16-block trace with a lamp at the end: lamp lit only when the trace has a relay in the middle.

**Visual Review**

- `m15-circuit.png`: powered traces visibly glowing brighter than unpowered; lamp emitting light.
- `m15-piston-door.png`: door open with pistons extended.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M15a** — Current core & logic | power levels 0–15, strong vs weak powering, deterministic update order with prioritized scheduled ticks; Copper Trace (connections including up/down steps, brightness by power), Inverter Torch with burnout, Relay (1–4 ticks, lockable), Gauge (compare/subtract, container fullness); Lever, Buttons, Pressure Plate, Tripwire; Lamp | Unit: 20-block trace; Unit: gate truth tables and RS latch; Unit: 5-tick clock; E2E 16-block trace with relay lights the lamp; Visual Review `m15-circuit.png` |
| **M15b** — Pistons & mechanical outputs | Piston and Sticky Piston (push ≤ 12, animated block-entity movement, immovable blocks); powered doors and trapdoors; Dispenser; Note Block emitting a tone event (M16b makes it audible) | Unit: 12 vs 13 blocks and sticky retract; E2E 2×2 piston door; Visual Review `m15-piston-door.png` |

Order: M15a → M15b. The M15 track needs only M10, so it runs alongside M11–M14.

---

### M16 — Procedural Audio

**Depends on:** M13, M14 (explosion sound test)

**Scope**

- All sound synthesized at runtime with Web Audio (oscillators, filtered noise, envelopes, convolution reverb with generated impulse responses). No audio files.
- Sound library: footsteps per material (grass, stone, sand, wood, gravel, snow, water), block break/place per material, item pickup, eating, hurt, death, explosion, rain, thunder, fluid ambience, kiln crackle, piston, button/lever clicks, bow draw/release, arrow hit, each creature's idle/hurt/death voice.
- 3D positional audio via `PannerNode` (HRTF) with distance attenuation and occlusion low-pass when a solid block lies between source and listener (raycast).
- Cave ambience: when the player is underground with low sky light, occasional eerie ambient cues and reverb increases.
- **Generative music**: calm ambient piano/pad compositions generated procedurally from a seeded scale/chord progression system, played at random intervals, different moods per biome and dimension.
- Voice limiting (max 32 voices, priority by distance and importance). Master/music/effects/ambient volume sliders.
- Audio context resumed on first user gesture (autoplay policy).

**Acceptance Criteria**

- [ ] E2E: after a click gesture, `getAudioStats().contextState === 'running'`.
- [ ] E2E: walking 20 ticks on grass then 20 ticks on stone logs different footstep sound IDs in `lastSounds`.
- [ ] E2E: breaking a block logs the correct material break sound; exploding a Blast Charge logs an explosion sound.
- [ ] E2E: `activeVoices ≤ 32` during a 27-charge chain explosion.
- [ ] Unit: synthesized buffers for each sound are non-silent (RMS > 0.01) and do not clip (peak < 1.0), rendered with `OfflineAudioContext`. These run inside Chromium (Vitest browser mode with the Playwright provider, or a Playwright spec), because `OfflineAudioContext` does not exist in Node.
- [ ] Unit: music generator with the same seed produces identical note sequences; different biomes produce different scales.

**Visual Review**

- Not visual; `progress/M16a.md` records which sounds were rendered offline and their RMS/peak values.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M16a** — Synthesis library | synthesis engine (oscillators, filtered noise, envelopes, convolution reverb with generated impulse responses) and every sound in the M16 library as a named, parameterized recipe; offline rendering tests run in Chromium | Unit: RMS > 0.01 and peak < 1.0 for every sound; the M16 Visual Review note (RMS/peak table) in `progress/M16a.md` |
| **M16c** — Generative music | seeded scale and chord-progression composer with moods per biome and dimension, producing note sequences | Unit: same seed gives identical sequences; different biomes give different scales |
| **M16b** — Audio integration | 3D HRTF audio with distance attenuation and raycast occlusion low-pass; every game event wired to its sound (including creature voices, Note Blocks and rain); cave ambience and reverb; music scheduling; 32-voice limit with priorities; volume model (the slider UI comes in M18b); resume on first gesture; `getAudioStats`; adds the rain-sound assertion to M12's spec | All four M16 E2E criteria |

Parallel: M16a (needs only M00b) and M16c (needs only M03a) are early starts that can run almost any time. M16b needs M14, M16a and M16c.

---

### M17 — Persistence

**Depends on:** M15

**Scope**

- IndexedDB schema: `worlds` (metadata), `regions` (32×32 column groups), `players`, `entities`, `blockEntities`.
- Binary region serialization: per column, palette + packed indices per section, compressed with `CompressionStream('deflate')`; only modified columns are saved (generated-but-untouched columns regenerate from seed).
- Save triggers: autosave every 60 s (incremental, spread across frames, no hitches), on pause, on `visibilitychange` hidden, on world exit.
- Player data: position, rotation, inventory, health, hunger, XP, spawn point, dimension.
- Entities and block entities (chests, kilns mid-smelt, pistons) persisted.
- Save format version number with a migration hook.
- World list screen: create, select, rename, delete (with confirmation), duplicate; shows last played time and a thumbnail captured from the game view.

**Acceptance Criteria**

- [ ] Unit: serialize/deserialize round-trip for random columns, block entities, and inventories is lossless.
- [ ] E2E: build a structure (20 random block edits), put items in a chest, start a kiln smelt, save, **reload the page**, load the world: every edited block matches, chest contents match, kiln progress continues, player position within 0.01.
- [ ] E2E: autosave causes no frame main-thread spike > 16 ms (measured over 3 autosaves).
- [ ] E2E: an unmodified world region takes < 1 KB of storage (only metadata), proving regeneration from seed.
- [ ] E2E: deleting a world removes all its IndexedDB records.

**Visual Review**

- `m17-world-list.png`: world entries with thumbnails, names, dates.
- `m17-after-reload.png` vs `m17-before-reload.png`: identical scene.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M17a** — Serialization | binary column format (per-section palette + packed indices); deflate via `CompressionStream`; serializers for block entities, inventories, entities and player data; format version with migration hook | Unit: lossless round-trips |
| **M17b** — IndexedDB & saving | hand-written IndexedDB wrapper and the schema in the M17 Scope; only modified columns saved; incremental autosave every 60 s spread across frames; saves on pause, `visibilitychange` and exit; dimension-keyed storage; `save`, `loadWorld` | E2E reload fidelity; E2E autosave spikes; E2E unmodified region < 1 KB; Visual Review `m17-before-reload.png`, `m17-after-reload.png` |
| **M17c** — World list | world list screen with thumbnails and last-played time; create, select, rename, delete (with confirmation), duplicate | E2E delete removes all records; Visual Review `m17-world-list.png` |

Parallel: M17a is an early start that needs only M10a. M17b needs M15b and M17a.

---

### M18 — Menus, Settings & Game Modes

**Depends on:** M17

**Scope**

- Main menu: animated panorama (a live-rendered slowly rotating view of a generated world), original pixel-art "BLOCKCRAFT" logo rendered in code, randomized original splash text, buttons: Singleplayer, Multiplayer (M21), Settings, Credits.
- Create World screen: name, seed (text → hashed), mode (Survival/Creative), world type (Default / Flat / Amplified / Single Biome), toggles (structures, starting chest).
- Settings: render distance, FOV, mouse sensitivity, invert Y, graphics (fast/fancy leaves, clouds, smooth lighting on/off, particles), GUI scale, brightness, view bobbing, all volume sliders, full keybinding remap with conflict detection. Persisted to IndexedDB.
- Pause menu with Resume, Settings, Save & Quit.
- Creative mode inventory: tabbed categories, search across all items, infinite stacks, delete slot.
- In-game chat/command console (T and /): `/tp`, `/time set`, `/weather`, `/give`, `/gamemode`, `/seed`, `/fill`, `/locate`, `/summon`, with tab completion and history.
- Screenshots (F2) saved as downloadable PNG via a generated link.

**Acceptance Criteria**

- [ ] E2E: full flow via DOM clicks: main menu → Singleplayer → Create World (seed "abc") → world loads → pause → Save & Quit → world list shows the world.
- [ ] E2E: same seed text yields identical `worldHash` across two separately created worlds.
- [ ] E2E: changing render distance from 8 to 4 reduces `chunksLoaded` within 5 s; FOV setting changes the rendered frame (`diffFraction > 0.1`).
- [ ] E2E: rebinding "jump" to K makes K jump and Space no longer jumps; binding two actions to the same key shows a conflict warning.
- [ ] E2E: `/give @s iron_ingot 5` adds 5 iron ingots; `/tp 100 120 100` moves the player; unknown commands show an error message without throwing.
- [ ] E2E: creative search "glass" shows only glass-related items.
- [ ] E2E: Flat world type generates the flat layer structure; Amplified produces max terrain height > 250 in a sampled area.

**Visual Review**

- `m18-main-menu.png`: panorama visible behind the logo and buttons; overall look original and polished.
- `m18-settings.png`, `m18-creative.png`, `m18-chat.png`.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M18a** — Main menu, world creation & pause | live panorama, code-drawn pixel-font logo, original splash texts, menu buttons; Create World screen (name, seed, mode, world type Default/Flat/Amplified/Single Biome, toggles); pause menu with Save & Quit | E2E full DOM flow; E2E same-seed hash; E2E Flat and Amplified; Visual Review `m18-main-menu.png` |
| **M18b** — Settings & keybinds | settings screen with every setting in the M18 Scope, persisted to IndexedDB; full keybinding remap with conflict detection | E2E render distance and FOV; E2E rebind and conflict warning; Visual Review `m18-settings.png` |
| **M18c** — Creative inventory, chat & commands | creative inventory (tabs, search, infinite stacks, delete slot); chat/command console with the listed commands, tab completion and history; F2 screenshot download | E2E commands; E2E creative search; Visual Review `m18-creative.png`, `m18-chat.png` |

Parallel: M18b ∥ M18c after M18a. M18 runs alongside M19.

---

### M19 — Structures & Loot

**Depends on:** M17, M13 (spawners need creatures)

**Scope**

- Structure placement grid with seeded spacing and separation, biome restrictions, and terrain adaptation (foundations fill down to the ground, stilts over water).
- **Jigsaw-style assembly** from piece templates defined in code/JSON with connectors, so structures vary in layout.
- Structures (all original designs):
  - **Wayfarer Hamlets:** clusters of houses, farms with crops, paths that follow terrain, a well, a lookout tower; villagers are **not** included (no trading NPCs) — instead each hamlet has an abandoned feel with loot chests.
  - **Sunken Crypts:** underground dungeons with a creature spawner block, mossy walls, and loot.
  - **Spire Ruins:** crumbling stone towers on mountains, partially decayed via noise.
  - **Buried Caches:** single chests under beaches, found via crafted maps (optional stretch).
  - **Mineshaft Warrens:** branching tunnels with wooden supports, rails (decorative), and cobweb-like "Silkmesh."
- Loot tables (`data/loot/*.json`) with weighted entries, count ranges, and random durability/enchant-like "affixes."
- Spawner blocks spawn their creature type in darkness within radius, with a spinning miniature creature render inside.

**Acceptance Criteria**

- [ ] Unit: structure positions are deterministic per seed and respect spacing (no two hamlets closer than 256 blocks).
- [ ] Unit: jigsaw assembly never produces overlapping pieces over 100 random seeds.
- [ ] E2E: `locate('structure', 'wayfarer_hamlet', [0,64,0])` returns a position within 2000 blocks; teleporting there shows ≥ 4 houses.
- [ ] E2E: a Sunken Crypt contains a spawner and at least one chest with ≥ 3 loot stacks drawn from its loot table.
- [ ] E2E: hamlet paths are continuous (walkable path from well to every house door, verified with the A\* pathfinder).

**Visual Review**

- `m19-hamlet.png`: varied houses sitting naturally on the terrain, not floating or buried.
- `m19-crypt.png`: dungeon room with spawner and chest.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M19a** — Placement, jigsaw & loot engines | seeded placement grid with spacing, separation and biome rules; terrain adaptation (foundations, stilts); jigsaw assembly from connector-based piece templates; loot tables in `data/loot/*.json` with weights, count ranges and affixes | Unit: deterministic positions and hamlet spacing; Unit: no overlapping pieces over 100 seeds |
| **M19b** — Wayfarer Hamlets | houses, crop farms, terrain-following paths, well, lookout tower, loot chests (no NPCs) | E2E locate and ≥ 4 houses; E2E path continuity via A\*; Visual Review `m19-hamlet.png` |
| **M19c** — Crypts, ruins, warrens & spawners | Sunken Crypts with spawner block (spawns in darkness, spinning miniature creature); Spire Ruins; Mineshaft Warrens with Silkmesh; Buried Caches (stretch) | E2E crypt spawner and loot chest; Visual Review `m19-crypt.png` |

Parallel: M19b ∥ M19c after M19a (M19c also needs M13g).

---

### M20 — The Hollowdeep (Second Dimension)

**Depends on:** M19

**Scope**

- Portal: a 4×5 frame of **Lumite Blocks** (corners optional), activated by using **Ember Flint** inside. Interior fills with an animated shimmering portal surface (procedural shader: swirling cyan-violet noise). Standing inside for 4 s triggers travel with a screen-warp effect.
- Coordinate scale 1:4 (1 block in the Hollowdeep = 4 in the Overworld). Portal linking: search for an existing portal within 32 blocks of the scaled coordinate; otherwise generate a new one with a safe platform.
- **Hollowdeep generator:** an enormous enclosed cavern world, height 0–192, solid ceiling and floor. Features:
  - Bioluminescent fungal forests (Glowcap trees, hanging Veilroot vines) casting colored block light.
  - Magma seas at y=40 with lava falls from the ceiling.
  - Floating Driftstone islands held aloft over chasms.
  - **Low-gravity zones** (region-based field): gravity reduced to 40% inside softly glowing "Updraft" areas, affecting players, creatures, items, and falling blocks.
  - Crystal geodes of **Voidglass** (translucent, light-bending tinted rendering).
- Dimension-specific fog, ambient particles (floating spores), music mood, and lava flow speed.
- 2 creatures unique to the Hollowdeep (Appendix B).
- Rare **Skyshard** ore generates only here, required for top-tier tools.
- Each dimension has independent chunk storage, streaming, and persistence.

**Acceptance Criteria**

- [ ] E2E: build a portal frame via `setBlock`, use Ember Flint → portal blocks appear; standing in it for 80 ticks changes `getPlayer().dimension` to `'hollowdeep'`.
- [ ] E2E: returning through the portal lands the player within 8 blocks of the original portal.
- [ ] E2E: entering at Overworld (400, y, 400) creates the Hollowdeep portal near (100, y, 100).
- [ ] E2E: in a low-gravity zone, a jump reaches ≥ 2× the normal jump height.
- [ ] E2E: Hollowdeep screenshot passes all pixel checks, mean hue differs substantially from Overworld screenshots.
- [ ] Unit: Skyshard ore never generates in the Overworld; appears at the Appendix A rate in the Hollowdeep.
- [ ] E2E: saving and reloading while in the Hollowdeep restores the player in the Hollowdeep.

**Visual Review**

- `m20-portal.png`: animated, glowing portal surface in a Lumite frame.
- `m20-hollowdeep-forest.png`, `m20-magma-sea.png`, `m20-floating-islands.png`: atmospheric, clearly a different world, colored lighting visible.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M20a** — Dimensions & portals | per-dimension world, streaming and storage; Lumite frame detection, Ember Flint activation, animated portal shader, 4 s travel with warp effect; 1:4 scaling, link search within 32 blocks, safe portal generation; dimension persisted with the player | E2E activation and travel; E2E return within 8 blocks; E2E (400, y, 400) → near (100, y, 100); E2E save/reload in the Hollowdeep; Visual Review `m20-portal.png` |
| **M20b** — Hollowdeep generator | enclosed cavern world (y 0–192); Glowcap forests and Veilroot; magma sea at y=40 with ceiling lava falls; Driftstone islands; Voidglass geodes; Skyshard ore; dimension fog, spore particles, lava flow speed | Unit: Skyshard never in the Overworld and at the Appendix A rate in the Hollowdeep |
| **M20c** — Updrafts, creatures & close-out | Updraft low-gravity zones (players, creatures, items, falling blocks); Glowwing with 3D flight pathfinding; Magmaw; Glowcap Stew; Hollowdeep music mood | E2E low-gravity jump; E2E Hollowdeep pixel and hue checks; Visual Review `m20-hollowdeep-forest.png`, `m20-magma-sea.png`, `m20-floating-islands.png` |

Parallel: M20a ∥ M20b. M20c needs both, plus M16b for creature voices.

---

### M21 — Multiplayer

**Depends on:** M20, M18 (the multiplayer menu builds on the menu system)

**Scope**

- Node.js authoritative server in `server/` sharing `src/world`, `src/gen`, `src/gameplay`, `src/entity` code (no browser APIs in shared modules; enforce with a lint rule).
- WebSocket binary protocol (hand-rolled, versioned): handshake, chunk data (compressed), block updates, entity spawn/move/remove (delta-compressed), inventory sync, chat, time/weather sync, keep-alive.
- Client-side prediction for player movement with server reconciliation (input sequence numbers; replay unacknowledged inputs on correction).
- Entity interpolation for remote entities (100 ms buffer).
- Server-side validation: reach distance, break speed, movement speed/teleport detection, inventory transaction validation.
- Player name tags above heads, tab-key player list with ping.
- Server persistence reuses the region format on disk.
- Multiplayer menu: server address entry, connect, error display on disconnect.
- `npm run server` starts the server; `npm run test:e2e` starts it automatically for M21 tests.

**Acceptance Criteria**

- [ ] E2E: two browser contexts connect to the same server; each sees the other player's model; player B's block edit appears in player A's world within 500 ms.
- [ ] E2E: with 150 ms artificial latency (server-side delay injection), local movement stays responsive (position changes within 1 frame of input) and `predictionCorrections` stays < 5 over a 30 s scripted walk.
- [ ] E2E: a client attempting to break a block 20 blocks away is rejected and the block remains for both clients.
- [ ] E2E: chat message from A appears in B's chat.
- [ ] Unit: protocol encode/decode round-trip for every message type; fuzz test with 10,000 random byte buffers never crashes the decoder.
- [ ] E2E: killing the server shows a disconnect screen on both clients with no uncaught errors.

**Visual Review**

- `m21-two-players.png`: from player A's view, player B's model with a name tag visible.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M21a** — Shared code & protocol | lint rule forbidding browser APIs in `src/world`, `src/gen`, `src/gameplay` and `src/entity`, plus any refactors it forces; versioned, hand-rolled binary protocol with every message type | Unit: round-trip for every message type; Unit: 10,000-buffer fuzz |
| **M21b** — Authoritative server | Node server on `ws` (`npm run server`); handshake, compressed chunk streaming, block updates, delta-compressed entity updates, inventory/chat/time/weather sync, keep-alive; validation (reach, break speed, movement, inventory transactions); disk persistence in region format; server-side delay injection; Playwright starts the server for M21 specs (needs the owner's `harness-change` label, §5.7) | Its own integration tests with headless Node clients |
| **M21c** — Client networking | multiplayer menu (address entry, connect, disconnect errors); client prediction with input sequence numbers and reconciliation; 100 ms entity interpolation; name tags; tab player list with ping; chat; disconnect screen; `getNetStats` | All five M21 E2E criteria; Visual Review `m21-two-players.png` |

Order: M21a → M21b → M21c.

---

### M22 — Performance, Culling & Polish

**Depends on:** M21

**Scope**

- **Cave culling:** per-section visibility graph (which faces connect through air) computed at mesh time; BFS from the camera section through connected faces to skip sections hidden behind solid terrain.
- Frustum culling at section granularity with a hierarchical (column → section) test.
- Multi-draw or merged buffers to hit the draw-call budget; indirect-style batching by pass.
- Distant terrain LOD (render distance > 12): simplified heightmap meshes for far columns beyond full-detail range.
- Optional post-processing (settings toggle): FXAA, subtle bloom from emissive blocks, and screen-space god rays when looking toward the sun.
- Loading screen with progress bar during initial world load.
- Accessibility: subtitles for sounds (e.g. "Hollow groans, left"), reduced-motion option (disables bobbing, screen shake), high-contrast UI option.
- Crash resilience: a global error boundary that saves the world and shows a recoverable error screen instead of freezing.

**Acceptance Criteria**

- [ ] E2E: at a fixed underground viewpoint, `chunksVisible` with cave culling is ≤ 40% of the count with culling disabled, and screenshots with/without culling differ by < 0.5% of pixels (culling is correct, not just aggressive).
- [ ] E2E: all performance budgets from Section 2.3 marked "Yes" pass at render distance 8 in the benchmark flight path.
- [ ] E2E: render distance 16 with LOD: horizon screenshot shows terrain to the fog line with no holes; `drawCalls ≤ 1500`.
- [ ] E2E: enabling reduced-motion disables camera shake during an explosion (camera transform unchanged frame to frame while standing still).
- [ ] E2E: subtitles appear when a creature makes a sound out of view.
- [ ] E2E: injecting a thrown error inside the game loop (via a debug-only fault injection flag) produces the recovery screen and the world is saved.

**Visual Review**

- `m22-bloom.png`: lumite and lava glow softly with bloom enabled.
- `m22-lod-horizon.png`: distant mountains visible far beyond full-detail range.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M22a** — Culling & batching | per-section visibility graph computed at mesh time; cave-culling BFS; hierarchical frustum culling; merged buffers / multi-draw batching per pass; debug toggle for culling | E2E cave culling ≤ 40 % with < 0.5 % pixel difference; E2E every "Yes" budget in §2.3 |
| **M22b** — LOD & loading screen | heightmap LOD beyond full-detail range for render distance > 12; initial-load screen with progress bar | E2E RD 16 horizon and draw calls; Visual Review `m22-lod-horizon.png` |
| **M22c** — Post-processing | FXAA, emissive bloom, screen-space god rays, settings toggles | Visual Review `m22-bloom.png` |
| **M22d** — Accessibility & resilience | directional subtitles, reduced-motion, high-contrast UI; global error boundary that saves the world and shows a recoverable screen; debug-only fault-injection flag | E2E reduced motion; E2E subtitles; E2E fault injection |

Parallel: M22a ∥ M22c ∥ M22d. M22b needs M22a.

---

### M23 — Final Acceptance: Scripted Survival Playthrough

**Depends on:** all previous milestones

**Scope**

- A single long E2E test, `tests/e2e/m23-playthrough.spec.ts`, that plays the game through **simulated inputs** (`input`, `look`, UI clicks), using debug API calls only for teleporting between prepared locations, time skips, and assertions — never for granting items or setting blocks.

**Scripted scenario (every step asserted):**

1. From the main menu, create a Survival world with the standard seed via DOM clicks.
2. Walk to the nearest tree (found via `locate('biome', ...)` + teleport near it), look at a log, hold attack until 4 logs are collected.
3. Open inventory, craft planks and a Workbench; place it; craft sticks and a wooden pickaxe.
4. Dig down a staircase until stone is reached; mine 8 cobblestone; craft a stone pickaxe, a Kiln, and a stone sword.
5. Mine coal and iron ore (teleport near located ores is allowed; mining must be by input).
6. Place the Kiln, smelt iron, craft an iron pickaxe.
7. Skip to night; fight and kill at least one hostile creature with the sword.
8. Craft a bed (wool from Tuftbucks killed by sword), sleep until morning.
9. Build a lever + trace + lamp circuit by placing items from the hotbar; toggle it; verify the lamp lights.
10. Save & Quit, reload the page, load the world, verify inventory and the circuit persisted.

**Acceptance Criteria**

- [ ] The playthrough test passes 3 times in a row.
- [ ] Zero console errors across the entire run.
- [ ] A screenshot at each of the 10 steps is saved and reviewed.
- [ ] `npm run verify` passes in full, all milestones.

**Visual Review**

- Write a short narrative in `progress/M23.md` of the full playthrough, one sentence per screenshot, describing what is actually visible.

**Task breakdown**

| Task | Builds | Owns |
| --- | --- | --- |
| **M23** — Scripted playthrough | `tests/e2e/m23-playthrough.spec.ts` following the scenario, plus fixes for small defects it exposes | All M23 criteria; the narrative in `progress/M23.md` |
| **M23-fix-N** (as needed) | one task per defect too large to fix inside M23: the fix plus a regression test in the owning milestone's spec | Its regression test |

---

## Appendix A — Blocks, Materials, Tools & Food

### A.1 Mining formula

`breakSeconds = hardness × (canHarvest ? 1.5 : 5) / toolSpeed`
where `toolSpeed = 1` for the wrong tool or bare hand. Multiply time by 5 if underwater without aid, and by 5 if not on the ground. Instant break if `hardness == 0`.

### A.2 Tool tiers

| Tier     | Harvest level | Speed | Durability | Sword damage (half-hearts) | Crafted from     |
| -------- | ------------- | ----- | ---------- | -------------------------- | ---------------- |
| Wood     | 0             | 2     | 59         | 4                          | Planks           |
| Stone    | 1             | 4     | 131        | 5                          | Cobblestone      |
| Copper   | 2             | 5     | 190        | 5                          | Copper Ingot     |
| Iron     | 3             | 6     | 250        | 6                          | Iron Ingot       |
| Skyshard | 4             | 9     | 2000       | 8                          | Skyshard Crystal |

Tools: pickaxe, axe, shovel, hoe, sword, shears (iron only), bow, shield, Ember Flint (flint + iron ingot).

### A.3 Core blocks (minimum set)

| Block                                                                                                                 | Hardness              | Blast res. | Tool / min tier | Light        | Notes                                           |
| --------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- | --------------- | ------------ | ----------------------------------------------- |
| Grass Block                                                                                                           | 0.6                   | 0.6        | shovel / –      | 0            | Spreads to dirt in light ≥ 9; biome-tinted      |
| Dirt / Coarse Dirt / Mud                                                                                              | 0.5                   | 0.5        | shovel / –      | 0            |                                                 |
| Stone                                                                                                                 | 1.5                   | 6          | pickaxe / 0     | 0            | Drops Cobblestone                               |
| Cobblestone / Mossy Cobblestone                                                                                       | 2                     | 6          | pickaxe / 0     | 0            |                                                 |
| Slate (deep stone below y=16)                                                                                         | 3                     | 6          | pickaxe / 0     | 0            | Darker, layered texture                         |
| Foundation Stone                                                                                                      | ∞                     | ∞          | –               | 0            | Unbreakable world floor                         |
| Sand / Red Sand / Gravel                                                                                              | 0.5 / 0.5 / 0.6       | 0.5        | shovel / –      | 0            | Fall when unsupported (falling block entity)    |
| Clay                                                                                                                  | 0.6                   | 0.6        | shovel / –      | 0            | Drops 4 clay lumps                              |
| Clayrock (8 banded colors)                                                                                            | 1.25                  | 4.2        | pickaxe / 0     | 0            | Badlands strata                                 |
| Logs: Oak, Birch, Pine, Rainwood, Acacia                                                                              | 2                     | 2          | axe / –         | 0            | Axis state                                      |
| Planks (5 types), Slabs, Stairs, Fences, Doors, Trapdoors, Ladders                                                    | 2                     | 3          | axe / –         | 0            |                                                 |
| Leaves (5 types)                                                                                                      | 0.2                   | 0.2        | shears/hoe / –  | 0            | Decay when > 6 from a log; drop saplings/apples |
| Glass, Stained Glass (8), Ice, Packed Ice, Snow, Snow Layer                                                           | 0.3–0.5               | 0.3–0.5    | –               | 0            | Glass drops nothing without affix               |
| Water / Lava                                                                                                          | –                     | 100        | –               | 0 / 15       | Fluids (M08)                                    |
| Blackglass                                                                                                            | 50                    | 1200       | pickaxe / 3     | 0            | From lava + water                               |
| Torch / Wall Torch                                                                                                    | 0                     | 0          | –               | 14           | Warm tint                                       |
| Lumite Block                                                                                                          | 3                     | 6          | pickaxe / 2     | 12           | Cool tint; portal frame                         |
| Workbench, Kiln, Chest, Bed                                                                                           | 2.5 / 3.5 / 2.5 / 0.2 | –          | –               | Kiln lit: 13 | Block entities                                  |
| Blast Charge                                                                                                          | 0                     | 0          | –               | 0            | M14                                             |
| Current components (M15)                                                                                              | 0–0.5                 | –          | –               | Lamp: 15     |                                                 |
| Plants: tall grass, ferns, 8 flowers, cactus, sugar reeds, mushrooms, pumpkins, berry bushes, wheat (8 growth stages) | 0–0.4                 | –          | –               | 0            | Cutout pass                                     |
| Silkmesh                                                                                                              | 4                     | 4          | shears/sword    | 0            | Slows movement                                  |
| Mire                                                                                                                  | 0.5                   | 0.5        | shovel / –      | 0            | Slows movement, M06                             |
| Hollowdeep: Duskrock, Driftstone, Glowcap (9), Veilroot, Voidglass, Emberite                                          | varies                | varies     | varies          | varies       | M20                                             |

### A.4 Ores

Target frequency is blocks of ore per 1,000,000 underground blocks (y 5–100 in the Overworld; whole height in the Hollowdeep).

| Ore          | Dimension       | Y range (peak)                           | Target / 1M | Min tier | Drop                                 |
| ------------ | --------------- | ---------------------------------------- | ----------- | -------- | ------------------------------------ |
| Coal Ore     | Overworld       | 0–192 (96)                               | 1200        | 0        | Coal ×1                              |
| Copper Ore   | Overworld       | 0–112 (48)                               | 700         | 1        | Raw Copper ×2–5                      |
| Iron Ore     | Overworld       | 0–80 (16) and 80–256 (mountains)         | 800         | 1        | Raw Iron ×1                          |
| Gold Ore     | Overworld       | 0–32 (16)                                | 90          | 3        | Raw Gold ×1                          |
| Lumite Ore   | Overworld       | 0–40 (20), exposed-to-air bonus in caves | 60          | 2        | Lumite Shard ×2–4 (4 → Lumite Block) |
| Skyshard Ore | Hollowdeep only | 5–60 (20)                                | 25          | 3        | Skyshard Crystal ×1                  |

### A.5 Food

| Food                       | Hunger | Saturation | Source                                   |
| -------------------------- | ------ | ---------- | ---------------------------------------- |
| Wild Berries               | 2      | 0.4        | Berry bushes                             |
| Apple                      | 4      | 2.4        | Oak leaves (0.5%)                        |
| Bread                      | 5      | 6.0        | 3 wheat                                  |
| Raw / Roast Tuftbuck Shank | 2 / 6  | 1.2 / 9.6  | Tuftbuck                                 |
| Raw / Roast Boar Chop      | 3 / 8  | 1.8 / 12.8 | Rootboar                                 |
| Raw / Roast Fowl           | 2 / 6  | 1.2 / 7.2  | Dapplefowl                               |
| Baked Tuber                | 5      | 6.0        | Rootboar dig-ups, smelted                |
| Mushroom Broth             | 6      | 7.2        | 2 mushrooms + bowl                       |
| Glowcap Stew (Hollowdeep)  | 7      | 8.0        | Glowcap + bowl; grants 30 s night vision |

---

## Appendix B — Creatures (all original designs)

Every creature has a procedurally generated skin, a unique silhouette, idle/hurt/death sounds, and a drop table. None may resemble a creature from an existing game.

| Creature         | Type              | Dimension / Spawn                      | Health | Design                                                                                           | Behavior                                                                                                                   | Drops                                  |
| ---------------- | ----------------- | -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Tuftbuck**     | Passive           | Grassy biomes                          | 10     | Stocky goat-like grazer with a shaggy mane and forward-curling horns; wool color varies by biome | Wanders, grazes (turns grass to dirt, regrows wool), flees when hit, follows wheat, breeds                                 | Wool ×1 (shears: ×1–3), Shank          |
| **Rootboar**     | Passive           | Forests, taiga                         | 12     | Long-snouted tusked boar with a bristled back ridge                                              | Roots in dirt occasionally leaving Tubers; follows tubers; breeds                                                          | Boar Chop ×1–3                         |
| **Dapplefowl**   | Passive           | Plains, savanna                        | 4      | Round speckled bird with a tall crest; flutters slowly when falling                              | Lays eggs every 5–10 min; follows seeds; breeds                                                                            | Feathers, Raw Fowl                     |
| **Mossback**     | Passive           | Near water, swamps                     | 30     | Slow tortoise with a garden of moss and tiny flowers on its shell                                | Moves between water and land; withdraws into shell (damage ×0.2) when hurt                                                 | Shell Plate (shield upgrade)           |
| **Glimmer Moth** | Ambient           | Night, near light sources              | 2      | Tiny glowing moth                                                                                | Boids flocking around torches and lumite                                                                                   | None                                   |
| **Hollow**       | Hostile (melee)   | Dark areas                             | 20     | Gaunt, hunched husk of dried bark and cloth wrappings, with glowing ember eyes                   | Pursues players by A\*; in daylight seeks shade rather than burning; breaks wooden doors on hard difficulty                | Bark Strips, occasional iron           |
| **Thornling**    | Hostile (ranged)  | Dark areas                             | 16     | Walking bramble-bush creature with a single blinking eye in its thorns                           | Keeps 8–12 block distance; strafes; fires arcing thorn projectiles (gravity)                                               | Thorns (arrowheads), sticks            |
| **Skitterer**    | Hostile (melee)   | Dark areas, caves; neutral in daylight | 16     | Low six-legged segmented crawler with a glossy carapace                                          | Climbs walls and ceilings; leaps at the player from up to 4 blocks                                                         | Silk (bowstrings), Carapace            |
| **Sporeburst**   | Hostile (burst)   | Dark areas, mushroom-heavy caves       | 20     | Waddling fungus with a swelling cap and stubby root-legs                                         | Approaches silently; within 3 blocks swells for 30 ticks and bursts (power 3 explosion + lingering spore cloud that slows) | Spore Powder (Blast Charge ingredient) |
| **Glowwing**     | Hostile (flying)  | Hollowdeep                             | 14     | Translucent bioluminescent ray with trailing light ribbons                                       | 3D flight pathfinding, circles then dives at the player                                                                    | Luminous Membrane                      |
| **Magmaw**       | Hostile (aquatic) | Hollowdeep magma seas                  | 24     | Armored eel with a glowing seam along its body                                                   | Swims in lava, lunges onto shore at players within 6 blocks, sets them on fire                                             | Emberite Scale                         |

Mob caps (per loaded area around each player): passive 12, hostile 40, ambient 10.

---

## Appendix C — Biomes (minimum set)

Plains, Meadow (flowers), Oakwood Forest, Birch Grove, Pine Taiga, Snowy Tundra (with ice spikes), Frost Peaks, Stony Heights, Desert, Badlands (Clayrock strata, red sand), Savanna (acacia, flat-topped hills), Swampland (Mire, dark water tint, Mossbacks), Rainforest (tall 2×2 Rainwood trees, dense foliage), Beach, Stony Shore, River, Ocean, Deep Ocean, Frozen Ocean.

Hollowdeep sub-biomes: Glowcap Forest, Magma Sea, Driftstone Expanse (floating islands + Updraft zones), Voidglass Geodes.

Each biome defines: temperature, humidity, grass/foliage/water tint, surface rules, feature list with densities, creature spawn weights, precipitation type, fog color, music mood.

---

## Appendix D — Survival Model

| Action                                | Exhaustion |
| ------------------------------------- | ---------- |
| Sprinting (per block)                 | 0.1        |
| Swimming (per block)                  | 0.01       |
| Jump / Sprint-jump                    | 0.05 / 0.2 |
| Breaking a block                      | 0.005      |
| Attacking                             | 0.1        |
| Taking damage                         | 0.1        |
| Natural regeneration (per half-heart) | 6.0        |

- When exhaustion ≥ 4.0: subtract 4.0, then decrease saturation by 1; if saturation is 0, decrease hunger by 1 instead.
- Saturation can never exceed current hunger.
- Hunger 20 and saturation > 0: regenerate 1 half-heart every 10 ticks.
- Hunger ≥ 18: regenerate 1 half-heart every 80 ticks.
- Hunger 0: take 1 half-heart of starvation damage every 80 ticks (never below 1 half-heart on easy).
- Sprinting is disabled when hunger ≤ 6.

---

## Appendix E — Task Graph & Parallelism

A task may start as soon as every task in its **Depends on** column is merged into `main`. **Round** is the earliest a task can start if every earlier task merges promptly; tasks that share a round can run concurrently. With this graph, the most tasks that can usefully run at the same time is four, and the critical path is 38 rounds long.

Milestone-level dependencies are the same as in the original edition, with three implicit ones made explicit: M16 needs M14 (explosion sound test), M19 needs M13 (spawners need creatures), and M21 needs M18 (the multiplayer menu builds on the menu system).

**Early starts.** M03a, M16a, M16c, M05a, M13b, M10a and M17a are pure-logic modules with unit tests. They run alongside the main chain instead of waiting for it.

| Task | Title | Depends on | Round |
| --- | --- | --- | --- |
| M00a | Toolchain & scaffold | — | 1 |
| M00b | Verification harness | M00a | 2 |
| M01a | WebGL2 core & camera | M00b | 3 |
| M01b | Procedural textures & atlas | M00b | 3 |
| M03a | Noise & RNG | M00b | 3 |
| M16a | Synthesis library | M00b | 3 |
| M01c | Texture test scene | M01a, M01b | 4 |
| M16c | Generative music | M03a | 4 |
| M02a | Blocks & chunk storage | M01c | 5 |
| M02b | Greedy mesher | M02a | 6 |
| M02c | Mesh workers & flat world | M02b | 7 |
| M03b | Terrain shape & pipeline | M02c, M03a | 8 |
| M05a | Light engine | M02c | 8 |
| M03c | Biomes & surface rules | M03b | 9 |
| M03d | Caves & aquifers | M03b | 9 |
| M03e | Ores | M03b | 9 |
| M03f | Surface features | M03c | 10 |
| M03g | Terrain close-out | M03d, M03e, M03f | 11 |
| M04a | Streaming core | M03g | 12 |
| M04b | Fade-in & memory | M04a | 13 |
| M05b | Smooth lighting & AO | M04b, M05a | 14 |
| M06a | Tick loop & movement | M05b | 15 |
| M12a | Time & sky | M05b | 15 |
| M06b | Swimming, climbing & camera | M06a | 16 |
| M12b | Clouds | M12a | 16 |
| M12c | Weather | M12a | 16 |
| M07a | Raycast, breaking & placing | M06b | 17 |
| M13b | A\* pathfinding | M06b | 17 |
| M07b | Drops, pickup & particles | M07a | 18 |
| M08a | Fluid simulation | M07b | 19 |
| M08c | Glass, ice & foliage | M07b | 19 |
| M09a | Items & inventory logic | M07b | 19 |
| M08b | Fluid rendering | M08a | 20 |
| M09b | Inventory screen & icons | M09a | 20 |
| M10a | Recipes, tools & block-entity framework | M09a | 20 |
| M09c | HUD & F3 | M09b | 21 |
| M17a | Serialization | M10a | 21 |
| M10b | Crafting screens & chests | M09c, M10a | 22 |
| M10c | Kiln & tool wear | M09c, M10a | 22 |
| M11a | Survival model & hazards | M10b, M10c | 23 |
| M15a | Current core & logic | M10b, M10c | 23 |
| M11b | Death, respawn & beds | M11a | 24 |
| M15b | Pistons & mechanical outputs | M15a | 24 |
| M13a | ECS & entity rendering | M11b, M12b, M12c | 25 |
| M17b | IndexedDB & saving | M15b, M17a | 25 |
| M13c | AI, spawning & combat | M13a, M13b | 26 |
| M17c | World list | M17b | 26 |
| M13d | Projectiles & bows | M13c | 27 |
| M13e | Passive creatures | M13c | 27 |
| M18a | Main menu, world creation & pause | M17c | 27 |
| M19a | Placement, jigsaw & loot engines | M17c | 27 |
| M13f | Hostile creatures | M13d | 28 |
| M18b | Settings & keybinds | M18a | 28 |
| M18c | Creative inventory, chat & commands | M18a | 28 |
| M19b | Wayfarer Hamlets | M19a | 28 |
| M13g | Creatures close-out | M13e, M13f | 29 |
| M14 | Explosions | M13g | 30 |
| M19c | Crypts, ruins, warrens & spawners | M19a, M13g | 30 |
| M16b | Audio integration | M14, M16a, M16c | 31 |
| M20a | Dimensions & portals | M19b, M19c | 31 |
| M20b | Hollowdeep generator | M19b, M19c | 31 |
| M20c | Updrafts, creatures & close-out | M20a, M20b, M16b | 32 |
| M21a | Shared code & protocol | M20c, M18b, M18c | 33 |
| M21b | Authoritative server | M21a | 34 |
| M21c | Client networking | M21b | 35 |
| M22a | Culling & batching | M21c | 36 |
| M22c | Post-processing | M21c | 36 |
| M22d | Accessibility & resilience | M21c | 36 |
| M22b | LOD & loading screen | M22a | 37 |
| M23 | Scripted playthrough | every task above | 38 |

**Merging concurrent tasks.** Concurrent tasks all branch from the same `main`, so they cannot see each other's work. Merge them one at a time in table order. If a later PR then conflicts with `main`, ask Jules in a PR comment to merge `main` into the branch, resolve the conflicts and re-run `npm run verify`; the PR is merged only once CI is green again.

---

_End of specification. Each Jules session implements exactly one task from Appendix E. Start with M00a._

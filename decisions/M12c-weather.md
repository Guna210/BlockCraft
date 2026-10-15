# Decisions — M12c: Weather

## 1. Weather State Machine & Determinism (Decision 1)

- **States**: `clear`, `rain`, `thunder` managed in `src/world/weather.ts` (`WeatherManager`) and rendered in `src/render/weather.ts` (`WeatherRenderer`).
- **Initial Determinism**: Every world starts in `clear` state. To guarantee full determinism for existing M12a/M12b sky and cloud tests, autonomous weather transitions are blocked before tick 12,000 unless manually set via debug API or test hooks.
- **Debug API**: `setWeather('clear' | 'rain' | 'thunder')` implemented in `src/debug/api/weather.ts` and registered with one line in `src/debug/api/index.ts`.
- **Render Stats**: `getRenderStats().weather` exports:
  - `state`: current weather state (`'clear' | 'rain' | 'thunder'`)
  - `activeParticles`: `{ rain: number, snow: number }` within 16 blocks of the camera.

## 2. Climate-Driven Precipitation & Heightmap (Decision 2)

- **Biome Climate Mapping**:
  - `none`: Dry biomes (`desert`, `badlands`, `savanna`).
  - `snow`: Cold biomes (`snowy_tundra`, `frost_peaks`, `frozen_ocean`) and high-altitude columns where `y >= 140` (`SNOW_ALTITUDE`).
  - `rain`: All other biomes below `y = 140`.
- **Top-Solid Heightmap Cover**:
  - `WeatherHeightmap` caches the top solid elevation per column in a 64×64 block window around the player.
  - Automatically invalidated and refreshed on chunk loads and block edits (`world.onBlockEdited`).
  - A precipitation particle whose position `y <= topSolidY` is culled in the vertex shader (`gl_Position = vec4(2.0, 2.0, 2.0, 1.0)`) and excluded from active particle counts.

## 3. GPU-Instanced Particle & Atmosphere Rendering (Decision 3)

- **Particles**:
  - 1,024 GPU instances rendered in a cylindrical wrap volume around the camera using static instance VBOs (`baseX, baseY, baseZ, seed, speed`).
  - Continuous vertical motion animated solely via `u_time` uniform, with zero per-frame CPU allocation.
  - Elongated vertical streaks for rain; fluttering billboard quads with horizontal trigonometric drift for snow.
- **Surface Splashes**:
  - 256 surface splash instances spawned on top solid faces during rain.
- **Atmosphere Darkening & Desaturation**:
  - Sky, fog, and clouds uniforms `u_rainFactor` and `u_lightningFlash` blend toward luminance (desaturate by up to 55%) and darken by up to 55%.
  - Puddles: Outdoor top faces (`normal.y > 0.5` and `skyLight >= 14`) receive a 22% brightness reduction (`v_puddle`) during rain.

## 4. Thunderstorms & Lightning (Decision 4)

- **Procedural Branching Lightning Bolt**:
  - `generateLightningBolt` recursively subdivides midpoint displacements with seeded fork branches, generating billboard ribbon quads.
  - Fully deterministic per seed and start/end coordinates.
- **Sky Flash**:
  - Lightning strikes set `flashIntensity = 1.0`, fading over ticks, which adds bright additive illumination to sky, fog, and cloud shaders.
- **Seeded Fire Ignition**:
  - Strike point has a 60% seeded ignition chance if the ground is solid and non-water with air directly above, placing a `fire` block.

## 5. Weather Accumulation & Data-Driven Blocks (Decision 5 & ART.md)

- **Budgeted Weather Tick**:
  - Since random-tick block updates are not yet implemented in the engine, `WeatherManager.tick` inspects a deterministic budget of 2 loaded columns near the player per tick.
  - In cold biomes (`precip === 'snow'`), exposed ground top faces slowly accumulate `snow_layer`.
  - Exposed still water with direct sky exposure (`skyLight >= 15`) freezes to `ice`.
- **New Block Definitions & Textures**:
  - `ice`: translucent block (`data/blocks/weather.json`), block item (`data/items/weather.json`), palette `PAL_ICE` with 5 distinct shades (contrast 4.09), registered in `src/world/blocks/registry.ts` and `src/render/textures/weather.ts`.
  - `snow_layer`: slab model using existing `"snow"` textures for all faces, avoiding duplicate atlas tiles and maintaining seamless tiling.
  - `fire`: cross cutout block (`data/blocks/weather.json`), palette `PAL_FIRE` with 6 flame colors (contrast 5.76), sorted as `'foundation_stone_fire'` in `BlockRegistry` to maintain stable IDs 0..28.

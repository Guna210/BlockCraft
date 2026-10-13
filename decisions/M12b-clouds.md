# M12b — Clouds and Sun Glare Decisions

## Owner Decisions

1. **Cloud field at y=192 (`src/render/clouds.ts`)**:
   - Seeded, deterministic 2D periodic noise grid on a 32×32 cell grid (each cell 12×12 blocks, region size 384×384 blocks).
   - Rendered as extruded 3D volumes 4 blocks thick (y=192 to y=196) with soft shading:
     - Top faces: `CLOUD_SHADE_TOP = 1.0` (lighter tops).
     - Side faces: `CLOUD_SHADE_SIDE = 0.85` (intermediate sides).
     - Bottom faces: `CLOUD_SHADE_BOTTOM = 0.70` (darker bottoms).
     - Internal faces between adjacent active cells are culled.
   - Wind drift along +X at 1.0 block/s, advanced on the fixed simulation tick (`(worldTime / 20.0) * 1.0` blocks).
   - Coverage roughly 30–40% (quantile threshold set to exactly 35% active cells, 358 out of 1024 cells).
   - Lit by M12 sky brightness (`skyLightMultiplier`) and time of day:
     - Daytime: bright crisp white with subtle cool shading.
     - Dusk / sunset: soft twilight grey.
     - Night: dark grey / navy.

2. **Fast 2D option**:
   - Added `clouds: 'fancy' | 'fast' | 'off'` (default `'fancy'`) to `settings` in `src/engine/settings.ts`.
   - In `'fast'` mode, `CloudRenderer` renders a single flat plane at y=192 textured with a 32×32 pixel texture generated from the identical active cell grid with `NEAREST` filtering and `REPEAT` wrapping, drastically reducing vertex and triangle count.
   - In `'off'` mode, cloud rendering is skipped.
   - Added `setClouds(mode: 'fancy' | 'fast' | 'off')` to the debug API in `src/debug/api/clouds.ts` and registered in `src/debug/api/index.ts`.

3. **Distance fade into sky colour**:
   - Cloud draw distance is tied to render distance (`fogEnd = Math.max(140, (renderDistance - 1) * 16)`).
   - Horizontal distance `length(worldPos.xz - cameraPos.xz)` drives `smoothstep(fogStart, fogEnd, dist)` to seamlessly blend cloud RGB into `skyAtmosphereColor` in the view direction and fade alpha to 0. Fragments with `fogFactor >= 0.999` are discarded.
   - Leaves the band near the horizon pure sky so `tests/e2e/helpers/sky-holes.ts` and horizon classification remain pure sky dome.

4. **SwiftShader performance and GPU buffer reuse**:
   - 3D volume mesh and 2D fast plane mesh are built once at `CloudRenderer` construction time and kept in static GPU VBO/VAO buffers.
   - No per-frame heap allocation or re-meshing.
   - Wind drift and camera tracking are applied via uniform offset `u_regionOffset` across a 3×3 grid of 384-block region instances. Instances outside `fogEnd` are culled on the CPU before drawing.
   - Draws in 1 to 5 draw calls total, well within M04 frame budgets.

5. **Owner-requested sun glare (`src/render/sky.ts`)**:
   - Drawn in the sky shader `SKY_FS` based on view ray alignment with `u_sunDir` and sun height `u_sunDir.y`.
   - When the sun is high (noon, `sunDir.y ≈ 0.966`), draws a large, soft, bright halo that saturates to pure blinding white `vec3(1.0, 1.0, 1.0)` in the center, and the sun billboard quad's alpha is faded to 0 so the pixel sun disc cannot be made out.
   - As the sun nears the horizon (sunset at 12000 ticks, `sunDir.y = 0.0`), the halo shrinks, dims (max intensity ≤ 0.40) and warms to amber-orange (`vec3(1.0, 0.55, 0.15)`), while the sun billboard alpha is fully restored (`0.818`), so the pixel sun disc is clearly readable at sunset.
   - Outside horizontal views at noon (`cosSun <= 0.26`), glare is inactive, leaving the top region of horizontal noon views pure sky blue (`hue ≈ 206°`, `luminance > 150`).

6. **Test integrity & Decision 6 pre-approval**:
   - Distance fade in Decision 3 naturally leaves the horizon band and horizontal top-quarter view pure sky.
   - No lines were added to other milestones' tests.
   - Existing M12a tests pass unchanged.

7. **Visual review screenshots (`docs/screenshots/M12b/`)**:
   - `m12-noon.png`: Looking west at pitch 0.12 from the overlook terrace; foreground grass terrace with two torches, stepped stone mountain on the left in blue horizon fog, and extruded 3D white voxel clouds floating in the upper sky with soft shading.
   - `m12-sun-glare-noon.png`: Looking directly at the noon sun at pitch 75°; a soft, large, blinding white circular glare halo saturating to pure white, completely washing out the pixel sun disc.
   - `m12-sun-glare-sunset.png`: Looking west at pitch 0.05 at sunset (tick 12000); warm orange horizon glow with a shrunk, dimmed amber halo surrounding the crisp pixel-art sun disc.

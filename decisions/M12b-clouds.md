# M12b — Clouds and Sun Glare Decisions

## Round 1 Decisions

1. **Opaque clouds (`src/render/clouds.ts`)**:
   - Drawn fully solid (alpha 1.0, depth-tested against the sky dome, depth write enabled `gl.depthMask(true)`, blending disabled `gl.disable(gl.BLEND)`), with zero translucency.
   - Clouds completely hide the sun disc and its bright glare halo behind them; no glare bleeds through the cloud underside.

2. **Distance fade only far away**:
   - No fade overhead, near the camera, or toward screen edges.
   - Distance metric is horizontal distance across the cloud sheet: `length(worldPos.xz - cameraPos.xz)`.
   - No fade based on view angle or pitch.

3. **Static GPU buffers & Fast 2D option**:
   - Static GPU buffers: mesh generated once at init time. Tiled regions around player are dynamically calculated with CPU bounding-box distance culling against `fogEnd`. Zero per-frame mesh allocation or buffer re-creation.
   - Fast 2D mode: single flat textured plane at y=192 controlled by `settings.clouds: 'fancy' | 'fast' | 'off'`.

4. **Sun glare in sky shader (`src/render/sky.ts`)**:
   - Height-dependent sun glare calculated in `SKY_FS` based on view ray alignment with `u_sunDir` and sun altitude `u_sunDir.y`.
   - High sun: large radius, bright white halo washing out billboard disc.
   - Low sun: shrunken radius, dimmed warm amber halo, crisp legible pixel disc.
   - Opaque clouds depth-test and overwrite the sky dome, completely blocking glare where clouds pass in front of the sun.

5. **Owner-approved lines in existing tests**:
   - `tests/e2e/m12.spec.ts:264`: `window.__blockcraft!.setClouds!('off');` inside the first `page.evaluate` of `M12a-fix RD8 noon and tick 10000 sky remain detectable above the fog edge`.
     - *Reason*: The camera in this test is elevated on an overlook near y=192 and tests the RD8 horizon sky coverage against a strict ≥ 0.98 threshold, which was obstructed by overhead clouds.
   - `tests/e2e/m04.spec.ts:281`: `window.__blockcraft!.setClouds!('off');` inside the first `page.evaluate` of `at render distance 12 the terrain reaches the horizon with no holes`.
     - *Reason*: Eye at 40 blocks above highest ground looking 20° down caused clouds to cover the top screen edge, interfering with the sky-hole detector on attempt 1.
   - Clouds remain enabled in all other tests, including the full M12b suite and all visual review screenshots.

## Round 2 Redesign Decisions (Owner Feedback)

1. **Chunky Compact Shapes & Elimination of 1-Cell Strands**:
   - Replaced old carving/hole-punching terms with lower-frequency noise: period 8 (4-cell wavelength) + period 16 (2-cell wavelength) combined as `v1 * 0.8 + v2 * 0.2`.
   - Applied a 2×2 morphological opening (erode then dilate with periodic grid wrapping). Mathematically guarantees that every cell in a cluster of size >= 4 belongs to at least one 2×2 block of active cells (`strandViolations = 0`), eliminating all thin 1-cell-wide arms, corridors, and maze-like L-shapes.
   - Most clouds are chunky, compact blobs 2–6 cells across in both directions with stepped outlines.
   - A few isolated lone cells (size 1) and small 2–3 cell clumps are added at local noise peaks that do not touch the opened blobs.
   - Zero interior holes. Coverage is 33.7% (345 active cells for seed 12006).

2. **Colour & Softened Contrast**:
   - Underside (`CLOUD_SHADE_BOTTOM = 0.78`): tinted toward sky colour (`mix(vec3(0.72, 0.74, 0.82), skyCol, 0.30)`), matching the lavender-blue tint from the reference.
   - Sides (`CLOUD_SHADE_SIDE = 0.96`): `vec3(0.90, 0.92, 0.95)`, softening the side-to-underside contrast while preserving the bright near-white highlight rim along stepped edges.
   - Top (`CLOUD_SHADE_TOP = 1.0`): pure white (`vec3(1.0, 1.0, 1.0)`).

3. **Dusk and Night Lighting**:
   - Sunrise/sunset: clouds take on warm horizon/sunset colour (orange-pink tint, lighter where the sun is):
     `sunsetCol = mix(vec3(0.85, 0.52, 0.42), vec3(0.98, 0.72, 0.55), sunAzimuth) * (v_shade * 0.35 + 0.65)`, driven by `u_twilightFactor * 0.85`.
   - Night: dim blue-grey `vec3(0.12, 0.15, 0.22) * v_shade` scaled by `(0.20 + 0.80 * u_skyBrightness)`.

4. **Gentle 50% Horizon Fade & Range**:
   - Cloud range reduced to `cloudRange = Math.max(512, 2 * terrainFogEnd)` (512 blocks at RD8).
   - Smooth fade starts earlier at 50% of range (`fogStart = cloudRange * 0.50`), gently blending clouds into the sky dome before reaching `fogEnd`. Clouds never end in a visible line, eliminating flickery far cloud bands.
   - Reduces fancy mode triangle count from ~59,800 to 25,603 triangles.

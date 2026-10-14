# M12b — Clouds and Sun Glare Decisions

## Round 1 Redesign & Owner Decisions

1. **Opaque clouds (`src/render/clouds.ts`)**:
   - Drawn fully solid (alpha 1.0, depth-tested against the sky dome, depth write enabled `gl.depthMask(true)`, blending disabled `gl.disable(gl.BLEND)`), with zero translucency.
   - Clouds completely hide the sun disc and its bright glare halo behind them; no glare bleeds through the cloud underside.

2. **Distance fade only far away**:
   - No fade overhead, near the camera, or toward screen edges.
   - Distance metric is horizontal distance across the cloud sheet: `length(worldPos.xz - cameraPos.xz)`.
   - Clouds stay fully solid until the outer ~30% of cloud range (`fogStart = cloudRange * 0.70`).
   - In the outer ~30%, cloud RGB seamlessly blends into `skyAtmosphereColor` in the view direction (`finalRgb = mix(litCol, skyCol, fogFactor)`). Fragments with `dist >= cloudRange` are discarded.
   - No fade based on view angle or pitch.

3. **Range reaching visibly to horizon**:
   - Cloud range is decoupled from terrain fog: `cloudRange = Math.max(768, 2 * (renderDistance - 1) * 16)` blocks.
   - Reaches visibly to the horizon at any render distance.
   - Static GPU buffers: mesh generated once at init time. Tiled regions around player are dynamically calculated (`radius = Math.ceil(fogEnd / regSize)`) with CPU bounding-box distance culling against `fogEnd`. Zero per-frame mesh allocation or buffer re-creation.

4. **Irregular blocky cloud shapes**:
   - Procedural generation on a 12-block cell grid (`CLOUD_CELL_SIZE = 12`, `CLOUD_GRID_CELLS = 32`, 4 blocks thick `y=192..196`).
   - Uses multi-octave periodic noise (periods 8, 4, 2 cells) with dual-offset carving waves and cellular jitter.
   - Interior hole punching pass carves notches and holes into large clusters (cells with 7+ active neighbors).
   - Results in a natural mix of lone cells (components of size 1), small clumps (sizes 2–5), and larger ragged clusters with notches and interior holes.
   - No single large smooth blob (max cluster size bounded < 200).
   - Strict 30–40% coverage (target exactly 35%, 358 out of 1024 cells).

5. **Shading matching reference image**:
   - Underside (`CLOUD_SHADE_BOTTOM = 0.78`): flat pale blue-grey, ~0.76 of white, subtly tinted toward the sky colour (`mix(vec3(0.76, 0.77, 0.80), skyCol, 0.12)`).
   - Sides (`CLOUD_SHADE_SIDE = 0.96`): near-white (`vec3(0.96, 0.97, 0.99)`), creating a distinct thin bright rim along all outer stepped edges and hole perimeters when viewed from below.
   - Top (`CLOUD_SHADE_TOP = 1.0`): pure white (`vec3(1.0, 1.0, 1.0)`).
   - Scaled by `(0.20 + 0.80 * u_skyBrightness)` and time of day, darkening to muted purple-grey at dusk and dark navy at night.
   - Sun glare is preserved in the sky shader, but completely blocked by opaque clouds passing in front of it.

6. **Owner-approved lines in existing tests**:
   - `tests/e2e/m12.spec.ts:264`: `window.__blockcraft!.setClouds!('off');` inside the first `page.evaluate` of `M12a-fix RD8 noon and tick 10000 sky remain detectable above the fog edge`.
     - *Reason*: The camera in this test is elevated on an overlook near y=192 and tests the RD8 horizon sky coverage against a strict ≥ 0.98 threshold, which was obstructed by overhead clouds.
   - `tests/e2e/m04.spec.ts:281`: `window.__blockcraft!.setClouds!('off');` inside the first `page.evaluate` of `at render distance 12 the terrain reaches the horizon with no holes`.
     - *Reason*: Eye at 40 blocks above highest ground looking 20° down caused clouds to cover the top screen edge, interfering with the sky-hole detector on attempt 1.
   - Clouds remain enabled in all other tests, including the full M12b suite and all visual review screenshots.

7. **Visual review screenshots (`docs/screenshots/M12b/`)**:
   - `m12-clouds-overhead.png`: noon, pitch ~25° up, camera on high ground terrace (well below y=192). Directly comparable to the reference image, showing flat blocky cloud slabs with pale blue-grey undersides, thin bright rims, ragged stepped edges, holes, and perspective receding toward the horizon.
   - `m12-noon.png`: looking west at pitch 0.12. Foreground terrace and torches, misty peak on left in blue fog, and vast 3D blocky cloud canopy stretching across the sky.
   - `m12-sun-glare-noon.png`: looking up at pitch 75° toward the noon sun with cloud cell `(cx=6, cz=2)` passing directly over the sun, visibly and completely blocking the sun disc and intense glare center with its solid pale blue-grey underside and bright rim, while the glare halo shines around the cloud edge.
   - `m12-sun-glare-sunset.png`: looking west at sunset (tick 12000). Darkened dusk clouds overhead, setting sun with crisp pixel disc and warm amber halo, and warm glowing horizon.

# M22c — Post-processing decisions

These decisions are fixed for M22c and implement SPEC §2.3 / M22c.

1. **Settings & UI integration**
   - Add three boolean fields to `Settings` (`src/engine/settings.ts`): `fxaa`, `bloom`, and `godRays`, all defaulting to `false`.
   - Persist and normalize them through `src/engine/settings-persistence.ts`; saved records without these fields load with `false`.
   - Add `"FXAA"`, `"Bloom"`, and `"God rays"` toggles on the Video tab of `src/ui/settings-screen.ts` right after `"Smooth lighting"` and `"Particles"`. All 14 video rows use an `11 px` row pitch (`10 px` row height, matching `KEYS 1`) so every row sits cleanly above the key-conflict alert and bottom action buttons.
   - Toggling any of the three applies live with no page reload and no chunk remeshing.

2. **Zero-cost bypass when all toggles are off**
   - When `fxaa`, `bloom`, and `godRays` are all `false`, `WorldManager.drawTerrain()` renders directly to the default framebuffer (`null`) with no offscreen FBO allocation, no extra shaders, and no post-processing passes. Existing frames, budgets (§2.3), and screenshot comparisons remain bit-identical.

3. **Offscreen target, composite order, and `FluidDepth`**
   - When any toggle is enabled, `PostProcessor` (`src/render/post/post-processor.ts`) lazily allocates a canvas-sized `RGBA8` scene color texture and a `DEPTH_STENCIL` texture whose internal format (`DEPTH32F_STENCIL8` or `DEPTH24_STENCIL8`) matches the default framebuffer's `DEPTH_BITS`, recreated on resize.
   - A small `begin()` / `end()` hook around world drawing in `WorldManager.drawTerrain()` captures sky, terrain, entities, particles, weather, clouds, portals, selection outline, underwater tint, spores, updraft glow, and warp overlay into the offscreen FBO while leaving HUD and DOM UI on the default framebuffer.
   - Active composite passes run in order: **bloom** → **god rays** → **FXAA last**, finishing on the default framebuffer (`null`) without per-frame heap allocations.
   - `FluidDepth.capture(sourceFramebuffer)` (`src/render/fluid-depth.ts`) accepts the active scene framebuffer (defaulting to `null` when post-processing is off) so `gl.blitFramebuffer(DEPTH_BUFFER_BIT)` reads from and restores the offscreen target rather than hardcoding `null`.

4. **Emissive-only subtle bloom**
   - Emissive blocks (`lightEmission > 0` or `lightEmissionWhen` lit states: `lumite_block`, `lumite_ore`, `lava`, `torch`, `wall_torch`, `fire`, `glowcap`, `glowcap_gills`, lit `lamp`, lit `kiln`) are identified by a startup `64×64` `R8` atlas-tile lookup table (`src/render/post/emissive-tiles.ts`) bound on `TEXTURE5`. Blocks whose unlit states share non-glowing casing tiles (e.g., `kiln` top/side/bottom) keep emission `0` on shared casing tiles so only glowing faces emit.
   - Terrain vertex layout, mesh workers, and uploaded chunk meshes are untouched. `ChunkRenderer` compiles `#define BLOOM_EMISSIVE` shader variants lazily only when bloom is used, sampling `u_emissiveMap` in the vertex shader (`texelFetch`) and outputting `layout(location = 1) out vec4 fragEmissive` during opaque, cutout, and translucent terrain passes (`COLOR_ATTACHMENT1`). Non-terrain passes keep `drawBuffers([COLOR_ATTACHMENT0])`.
   - Emissive output is weighted by tile emissivity, distance fog fade, and texel brightness, downsampled to quarter resolution (`4×4` box), smoothed with two separable horizontal + vertical Gaussian blur passes, and subtly added onto scene color so sky, snow, and sunlit sand never bloom.

5. **Screen-space god rays**
   - `computeGodRaysState` (`src/render/post/sun-visibility.ts`) projects `sunDir` into screen UV using the rotation-only view-projection matrix without allocating arrays/matrices.
   - Enabled only in the Overworld (`dimension === 'overworld'`), above horizon (`sunDir[1] > -0.02`), and outside water (`!underwater`), fading smoothly with horizon elevation, daylight/twilight weights, sun-to-camera-forward angle, and rain. Off at night, underwater, and in the Hollowdeep.
   - Reads the depth texture (`depth >= 0.99975`) as a far-plane sky mask so terrain, leaves, and clouds occlude radial shafts toward the sun.

6. **Original single-pass luma FXAA**
   - Implemented from scratch in GLSL ES 3.00 inside `src/render/post/post-processor.ts` (AGENTS §10): computes neighborhood luminance (`M, N, S, E, W, NW, NE, SW, SE`), skips low-contrast regions, detects horizontal vs vertical gradient direction, walks along the edge up to 6 steps to estimate endpoint spans, and blends via linear sub-pixel texture sampling.

7. **Debug API & multiplayer**
   - `getPostFx()` in `src/debug/api/postfx.ts` (registered with one line in `src/debug/api/index.ts`) reports active passes, target size, and pass CPU timings; toggling uses existing `setSetting`.
   - Post-processing is strictly client-side with zero network protocol changes.

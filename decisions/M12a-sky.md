# M12a — Time & Sky Decisions

## Owner Decisions

1. **World Time (`src/world/time.ts`)**:
   - Holds `worldTime` in simulation ticks (`24,000` per day; `0` = sunrise, `6000` = noon, `12000` = sunset, `18000` = midnight).
   - Advances by `1` per simulation tick on M06a's `TickLoop` (`src/engine/loop.ts`), so debug `pause` / `tick(n)` also advance it deterministically through the single `advance(ticks)` entry point.
   - New worlds start at `6000` (noon), so existing screenshot and brightness tests preserve their daytime appearance.
   - `setTimeOfDay(ticks)` per SPEC §4 is implemented in `src/debug/api/time.ts` and registered with one line in `src/debug/api/index.ts`.

2. **Sky-Light Curve**:
   - Smooth cosine-based function of time (`sunElevationSin(ticks) = sin(2π * timeOfDay / 24000) = cos(θ - π/2)`) with `smoothstep` easing across dawn and dusk (`s ∈ [-0.25, 0.25]`).
   - Returns `1.0` through the day and `0.2` at night (moonlight floor).
   - Drives the existing `u_skyBrightness` uniform on `ChunkRenderer` without re-meshing chunks.
   - Maximum step between any two consecutive ticks over a full 24,000-tick day is `~0.000628 <= 0.05`.

3. **Sun & Moon Path and Camera Yaw Convention**:
   - In `src/render/camera.ts`, `forward = [cos(yaw)*cos(pitch), sin(pitch), sin(yaw)*cos(pitch)]`.
   - `yaw = 0` looks East (`+X`, sunrise direction at `0` ticks); `yaw = Math.PI` looks West (`-X`, sunset direction at `12000` ticks); `yaw = -Math.PI / 2` looks North (`-Z`); `yaw = Math.PI / 2` looks South (`+Z`).
   - The sun orbits from East (`+X`) through overhead (`6000`) to West (`-X`) on a plane tilted `15°` (`SUN_ORBIT_TILT_RAD`) around the East-West (`X`) axis:
     `sunDirection(ticks) = [cos(θ), sin(θ) * cos(15°), sin(θ) * sin(15°)]`, and `moonDirection(ticks) = -sunDirection(ticks)`.

4. **Full-Screen Sky Pass (`src/render/sky.ts`)**:
   - Drawn first each frame as a full-screen 3-vertex triangle pass (`gl.disable(gl.DEPTH_TEST)`, `gl.depthMask(false)`).
   - Evaluates `skyAtmosphereColor(dir, sunDir, dayFactor, twilightFactor, nightFactor)` in the fragment shader:
     - Daytime gradient from lighter horizon blue `RGB(132, 212, 255)` to deeper zenith blue `RGB(72, 168, 248)` (hue `195°–212°`, luminance `153.4–198.1 > 150`).
     - Sunrise/sunset directional orange-red glow toward the sun near the horizon (`0–45°` hue looking west at `12000`).
     - Deep navy night sky (`RGB(4..10, 6..14, 15..28)`, luminance `< 15`).
     - Hashed stereographic direction grid (`85×85`) stars with screen-space derivative sizing (`d < 0.48 * fwidth(skyUV)`) and time-driven twinkle, fading in at dusk and producing strictly isolated 1-pixel bright stars (`> 200` in the upper third of a 1280×720 midnight frame).

5. **Sun & Moon Billboard Quads (`src/render/textures/sky.ts`, `src/render/sky.ts`)**:
   - Procedural 16×16 textures `sun` and `moon_0`..`moon_7` follow `ART.md` (declared palettes `PAL_SUN` and `PAL_MOON` with `<= 12` colours, upper-left lighting, luminance contrast `>= 60`, seed variation via `LCG`, and a 1px transparent border so wrap-edge difference is `0`).
   - Moon phase is `dayNumber mod 8` (`Math.floor(worldTime / 24000) % 8`), selecting `moon_0` (full) through `moon_4` (new) to `moon_7` (waxing gibbous).
   - Both billboards are packed into a single 12-vertex dynamic VBO and drawn in one draw call with `textureLod(u_atlas, v_uv, 0.0)`.

6. **Distance Fog (`src/render/chunk-renderer.ts`)**:
   - Linear/smoothstep distance fog from `0.75 * renderDistance * 16` to `1.0 * renderDistance * 16` horizontal blocks from `u_cameraPos`.
   - Evaluates `v_fogColor = skyAtmosphereColor(viewDir, ...) * 0.95` and `v_fogFactor` per vertex in `VS_CHUNK` and blends via a single `mix(litColor, v_fogColor, v_fogFactor)` in `FS_CHUNK` to keep SwiftShader fragment cost minimal.

7. **Sky-Hole Helper Classification (`tests/e2e/helpers/sky-holes.ts`, `tests/unit/sky-holes.test.ts`)**:
   - Updated `isSkyPixel` to recognize both `SKY_RGB` within `SKY_TOLERANCE` and the M12a noon sky gradient band (`b >= 245 && g >= 164 && g <= 216 && r >= 68 && r <= 138 && b - r >= 110`).
   - Because fogged terrain scales `skyAtmosphereColor` by `0.95` (`b <= 242 < 245`), fogged terrain never triggers false sky holes in M04 horizon or fast-flight tests, while genuine missing-chunk holes reveal the background sky pass (`b >= 248`) and are detected as before.

8. **Visual Review**:
   - Saved `docs/screenshots/M12a/m12-sunset.png` and `docs/screenshots/M12a/m12-midnight.png`, plus `docs/screenshots/M12a/m12-noon-ref.png` for reference only (`m12-noon.png` belongs to M12b).

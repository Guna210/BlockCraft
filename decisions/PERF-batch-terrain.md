# PERF-batch — Terrain draw batching decisions

The owner fixed the following decisions for `PERF-batch`:

1. **Cross-column multi-draw (`src/render/chunk-renderer.ts`, `src/render/terrain-batcher.ts`)**
   - After existing column frustum, section frustum, and cave visibility culling, visible sections are bucketed into preallocated per-key lists keyed by `(pass, lightingVariant, arenaPage.id)`.
   - Opaque (`pass = 0`) and cutout (`pass = 1`) order does not matter beyond the key; each non-empty key emits `multiDrawElementsWEBGL` calls chunked only by a fixed maximum draw count per call (`MAX_MULTI_DRAW_BATCH = 4096`).
   - Translucent (`pass = 2`) retains its back-to-front sorted section order (`translucent-sort.ts`) and per-section quad sorting within `TRANSLUCENT_NEAR_DISTANCE`. Only consecutive sorted translucent sections that share `(lightingVariant, arenaPage.id)` are batched into a single `multiDrawElementsWEBGL` call (also capped by `MAX_MULTI_DRAW_BATCH`).

2. **Per-draw data texture without per-batch uniforms (`src/render/terrain-batcher.ts`, `src/render/chunk-renderer.ts`)**
   - `u_drawData[20]` is replaced by one shared 2D `RGBA32F` per-frame data texture (`u_drawDataTex`, bound on texture unit `2`, width `1024`, height `64`, capacity `32,768` draws per frame, grown if needed).
   - Each visible section draw occupies two adjacent `RGBA32F` texels at `texelBase = (u_drawBase + drawIndex) * 2`:
     - Texel 0 (`ivec2((texelBase) & 1023, (texelBase) >> 10)`): `(originX, originY, originZ, fade)`
     - Texel 1 (`ivec2((texelBase + 1) & 1023, (texelBase + 1) >> 10)`): `(tintSlot, 0, 0, 0)`
   - All draws across opaque, cutout, and translucent passes are packed into the CPU staging `Float32Array` during draw-list building and uploaded once per frame via `gl.texSubImage2D` covering only the dirty row span (`rows = ceil(totalTexels / 1024)`).
   - In the vertex shader, `int drawIdx = u_drawBase + gl_DrawID` (or `u_drawBase` when `WEBGL_multi_draw` is unavailable or disabled by `?debug=1&glcheck=draw`) reads Texel 0 and Texel 1 via `texelFetch`. `u_drawBase` is updated with one `gl.uniform1i` per multi-draw submission (or per section draw on the fallback path).

3. **Shared tint atlas texture (`src/render/tint-cache.ts`, `src/render/chunk-renderer.ts`)**
   - Per-column grass and foliage `TEXTURE_2D` bindings are replaced by `ColumnTintCache`'s shared slot-allocated 2D tint atlas (`u_tintAtlas`, `TEXTURE_2D`, bound once per frame on texture unit `1`, `RGB8`, `1024 × H`, 64 `16 × 16` cells per row), with two `16 × 16` cells per allocated column slot (`slot * 2` for grass, `slot * 2 + 1` for foliage). Using a 2D atlas instead of `TEXTURE_2D_ARRAY` avoids WebGL2's `MAX_ARRAY_TEXTURE_LAYERS = 2048` cap when 4,489 columns are loaded at RD32.
   - Slot `0` permanently holds the default plains grass and foliage tints. Loaded columns allocate integer slots from a free-list (`allocateSlot` / `freeSlot`) and upload their `16 × 16` grass and foliage cells via `gl.texSubImage2D`. When a column's last section is removed, its slot is returned to the free-list.
   - Alongside the shared 2D tint atlas, `ColumnTintCache` preserves its legacy `ColumnTintPair` handle and mock-GL fallback when `texStorage2D` is absent in unit-test mocks so existing `tests/unit/tint.test.ts` and `tests/e2e/m02c-fix.spec.ts` contracts continue to hold without modifying any existing tests.
   - Tinted output in the vertex shader (`texelFetch(u_tintAtlas, cellOrigin + tintTexel, 0).rgb`) is pixel-identical to `master`.

4. **Arena pages (`src/render/terrain-arena.ts`)**
   - Freed section ranges are placed into a per-page quarantine queue tagged with the draw frame in which they were last used. At the end of each frame that drew from an arena (`endDrawFrame` / `pollFences`), a `gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)` is recorded for that draw frame.
   - Quarantined ranges are polled with `gl.clientWaitSync(fence, 0, 0)` (zero timeout, never blocking) and returned to `page.quadSpace` only after the fence inserted after their last draw frame has signalled (`ALREADY_SIGNALED` or `CONDITION_SATISFIED`). Ranges from pages never drawn are freed immediately.
   - `TerrainArena.allocate` reuses free ranges in existing pages without skipping pages drawn in the last 4 frames, because quarantined ranges already protect in-flight GPU reads.
   - `ChunkRenderer` configures page capacities starting at `1,048,576` quads (opaque, growing up to `2,097,152`), `524,288` quads (cutout, growing up to `1,048,576`), and `262,144` quads (translucent, growing up to `524,288`), keeping total arena page count across opaque, cutout, and translucent passes small at RD32 with LOD off (compared to ~2,977 pages on `master`).
   - Empty pages are released when their last active allocation is freed, preserving M04a's GPU resource return-to-baseline check and 3 ms per-frame upload deferral.

5. **Program variants and post-processing compatibility**
   - The 4 lighting program variants (`default`, `SKY_ONLY`, `WALL_TORCH`, `SKY_ONLY + WALL_TORCH`) and their lazy `#define BLOOM_EMISSIVE` variants are retained for pixel identity. Because opaque and cutout draws are grouped by variant before page, each pass switches program at most once per active variant (≤ 4 switches in opaque, ≤ 4 in cutout).
   - M22b LOD and M22c bloom `drawBuf1` / `drawBuf2` (`COLOR_ATTACHMENT1`) handling remain unchanged.

# M03g-face-winding — ±X cube faces were wound clockwise

Status: accepted
Task: M03g (owner-sanctioned change to M02b's code, `src/mesh/greedy.ts`)

## Context

While investigating the dark triangles (see `decisions/M03g-face-shading.md`), the GPU index and
vertex buffers of a desert scene (1,181 sections, 227,324 quads) were decoded. The geometric normal
of every triangle (cross product of its edges) was compared with the normal index in its vertices.
All +X and all −X quads pointed the wrong way (148,776 of about 454,000 triangles); ±Y and ±Z were
correct. The corner lists of cases 0 and 1 in `emitQuad` run clockwise seen from outside.

Nothing draws with back-face culling today, so there was no visible effect. Enabling `CULL_FACE`
later (M05b, M22a) would have removed every X-facing wall.

## Decision

`emitQuad` (`src/mesh/greedy.ts`) writes the triangle indices of +X and −X quads in the reverse
order: `(0, 2, 1), (0, 3, 2)` instead of `(0, 1, 2), (0, 2, 3)`. The other four directions are
unchanged. All six directions are now counter-clockwise seen from outside.

Vertices, positions, UVs, tile indices, tints and merging are byte-identical to before; only the
`indices` arrays of +X and −X quads change. The shared diagonal is still corner 0 to corner 2.
The wireframe line buffer (`chunk-renderer.ts`, four edges per quad) is unaffected.

## Alternative tried and rejected

Swapping corners 1 and 3 (positions and UVs together) also gives counter-clockwise faces, but two
existing tests of M02b-fix (`tests/unit/greedy.test.ts`, "1x3x1 grass_block column …" and "X-, Y-,
and Z-axis log bark ridge orientation …") read the UVs by corner index ("vert 3 gets v = 0"), so
they fail. Reversing the index order keeps corner identities and passes them unchanged.

## Not changed

- Cross models (`src/mesh/models.ts`) keep both windings (two quads per diagonal, double sided).
- Back-face culling stays off.

## Test

`tests/unit/winding.test.ts`: every triangle of the opaque, cutout and translucent buckets, in
generated sections (5 × 5 columns of the standard seed, 3 × 3 × 11 sections meshed) and in a random
mixed section of stone, leaves, water, glass and X/Y/Z logs, is counter-clockwise for all six
directions, with at least one quad per direction and bucket checked. Both tests fail on master and
pass with the change.

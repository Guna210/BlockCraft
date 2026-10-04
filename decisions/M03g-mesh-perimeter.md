# M03g-mesh-perimeter — never mesh a section next to a missing column

Status: accepted
Task: M03g (owner-sanctioned change to code owned by M02c and M03b-fix3, `src/world/world-manager.ts`)

## Context

`buildPaddedSection` (`src/world/padded.ts`) fills a column that is not loaded with air. The meshes
of the outermost sections of a loaded area therefore had faces toward columns that did not exist:
solid terrain got hidden outer walls, and water got translucent side walls that show up as dark
polygons seen through the sea surface (ocean viewpoint, standard seed: 383 of 823 translucent side
quads, about 4,700 of 6,000 square blocks of wall). M03b-fix had noted the perimeter faces without
the water effect. Columns that were generated later left their first mesh in place, so the hidden
faces stayed (9,480 in the desert scene).

## Decision

`createWorld` (`loadInitialWorld`) and `meshRadius` (`waitForTerrain`) generate one more ring of
columns than they mesh (`PERIMETER_RING = 1`):

- `loadInitialWorld` generates and lights radius 5 (121 columns) around the origin and meshes
  radius 4 around the camera, as before.
- `meshRadius(r)` generates every missing column within `r + 1` of the camera and meshes only `r`.

`waitForTerrain(r)` keeps its contract: every column within `r` is generated, meshed and uploaded
when it resolves. The epoch checks of M03b-fix3 are unchanged: the same `epoch !== this.worldEpoch`
guards sit after every await, and the extra columns go through the same generation callback.

The ring is generated and (in `createWorld`) lit but never meshed by that call; if a later call
meshes it, its neighbours are generated first.

## Not changed

`padded.ts` still fills a missing column with air. The rule lives in the caller, see the note for
M04a below.

## Rule for M04a (streaming)

**A section must never be meshed while any of the eight neighbour columns of its column is
missing.** Generate the ring first, mesh inside it. When a column arrives later than the sections
next to it, re-mesh those sections (or hold their meshing back). This also removes the need for any
special handling of the loaded area's edge in the renderer.

## Measurements (this VM, default `createWorld`, standard seed, normal frame loop, three fresh pages)

- before: 1,742 / 1,700 / 1,748 ms, 864 draw calls, `worldHash(0,0,64,64)` `dda64d20`
- after: 2,169 / 2,034 / 2,021 ms, 841 draw calls, `worldHash(0,0,64,64)` `dda64d20`

Limit asserted by `tests/e2e/m02c-fix.spec.ts`: 20 s.

Stale hidden faces: in the desert scene (createWorld, camera moved to (64, 120, −208),
`waitForTerrain(4)`, then `waitForTerrain(3)` at the framed view), the comparison of every opaque
quad of 1,181 sections with the block data found 9,480 faces toward a neighbour that is opaque in
the finished world before this change and **0 after**; meshed unit faces equal the faces expected
from the block data exactly (551,613 each), none missing.

## Tests

`tests/e2e/m03g-perimeter.spec.ts` (both fail on master, pass now): after a default `createWorld`,
and after `waitForTerrain(2)` at another place, no side face of any opaque, cutout or translucent
bucket lies on a section border toward a column that `World.hasColumn` reports as not generated;
the second test also asserts that every column within the requested radius is generated and meshed.

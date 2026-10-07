# M03g-face-shading — fixed face shade instead of a clamped directional diffuse

Status: accepted
Task: M03g (owner-sanctioned change to M02c's shader, `src/render/chunk-renderer.ts`, `FS_CHUNK`)

## Context

The dark triangles in `docs/screenshots/M03f/m03f-desert.png` (terrace sides) and
`m03f-forest.png` (stone slope), and in the M03c savanna water, were investigated by decoding the
GPU vertex and index buffers, by rendering the normals as colour, and by a controlled block-removal
experiment (progress/M03g.md). Findings:

1. **Desert and forest: real side faces.** Each dark triangle is the visible part of a real 1 × 1
   side face (for example the −Z face of the sand block (74, 84, −219)) whose other half is
   hidden by the top face of the neighbouring raised block. Removing three neighbouring sand blocks
   turned the triangle into the full wall. The mesh matches the block data exactly: no stray and no
   missing face, correct tiles, planar quads, one normal per quad.
2. **They look black because of the shading.** The shader computed
   `diff = max(dot(v_normal, lightDir), 0.35)` with `lightDir = (0.4, 0.8, 0.5)` normalised. A top
   face got 0.78; −X and −Z faces hit the 0.35 floor (45 % of a top face), +X got 0.39, +Z 0.49. On
   dark stone that is near black. Vertex ambient occlusion is a constant 0, so nothing softens it.
3. **Water: mesh-edge walls**, fixed by `decisions/M03g-mesh-perimeter.md`.

Shading is flat per quad (the normal is the same at all four vertices), so the choice of the
triangle diagonal does not affect it. M03f's note to check the triangles against AO quad flipping
is therefore moot.

## Decision

In `FS_CHUNK` the two lines that computed the directional diffuse are replaced by a fixed face-shade
table chosen from the interpolated normal:

| face | shade |
| --- | --- |
| top (+Y) | 1.0 |
| ±Z | 0.8 |
| ±X | 0.6 |
| bottom (−Y) | 0.5 |

`fragColor = vec4(texColor.rgb * diff, texColor.a)` is unchanged, and nothing else in the shader or
the renderer changed. Faces keep a clear shape-defining contrast (top to side 1 : 0.6–0.8) and the
darkest face is 0.5 instead of 0.35.

## For M05b

Keep this table. Multiply it by world light (sky and block light with the gamma curve) and by
per-vertex AO; do not replace it with a new diffuse term.

## Effect on existing tests

Every pixel of the terrain is brighter (top faces by 1/0.78 = 1.28×, sides by 1.2–1.7×). All
existing unit and e2e tests pass unchanged (full `npm run verify`, progress/M03g.md).

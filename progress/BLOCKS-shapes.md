# BLOCKS-shapes — Stairs, fences, doors and trapdoors

Status: verified (see Known limitations for the two e2e timeouts of the 2-core container)
Depends on: M10a (recipes), M07 (placement and raycast), M02 (mesher)
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 767 passed (95 files) · e2e 104 passed, 2 failed (m04.spec.ts:221 and m04.spec.ts:276, both `Test timeout of 180000ms exceeded`, on the known 2-core container list) · console errors 0 in the BLOCKS-shapes specs

## Acceptance criteria owned

Owner-requested task, so there is no SPEC row. The brief's goals and where they are tested:

- [x] 22 new crafting recipes lift the recipe total to ≥ 120 (now 121 crafting + 17 smelting = 138, including M10b's workbench and chest) → tests/unit/blocks-shapes.test.ts › "brings the crafting recipe total to at least 120"
- [x] Every wood has stairs, fences, doors and trapdoors → tests/unit/blocks-shapes.test.ts › "registers stairs, fences, doors and trapdoors…"
- [x] Box geometry of every shape kind → tests/unit/blocks-shapes.test.ts › "BLOCKS-shapes boxes"
- [x] Placement orientation, fence connection, two-block doors → "BLOCKS-shapes placement rules"
- [x] Door and trapdoor toggle, both halves break together → "BLOCKS-shapes opening and breaking"
- [x] A ray passes through the empty part of a stair → "BLOCKS-shapes targeting"
- [x] Shape vertex format, meshing, quad budget → "BLOCKS-shapes meshing"
- [x] The player walks up a staircase without jumping; a closed door blocks and an open one lets the player through → tests/e2e/blocks-shapes.spec.ts › "walks up a staircase without jumping and a door blocks until opened"

## Screenshots (docs/screenshots/BLOCKS-shapes/)

- shapes-closed.png: five rows (oak, birch, pine, acacia, rainwood) in depth, each with two stairs in front, a two-post fence, a closed door facing the camera and two trapdoors lying on the floor behind; every wood has its own colour and the door shows its panels, small window slats and handle.
- shapes-open.png: the same scene with every door and trapdoor open: the door leaves have swung sideways to their hinge edge and stand edge-on, the open trapdoors stand upright as thin plates.
- shapes-fence-pen.png: a 5×5 oak fence pen seen from a corner with a one-fence gap on one side and a birch fence beside a two-high stone pillar; every post has arms only towards the neighbouring fences, and the fences at the gap end in a post.
- shapes-inventory.png: the inventory with the 22 new items; the stairs show as small stepped isometric blocks, the fences as thin posts with arms (hard to read at 16 px), the doors as upright sprites with panels and the trapdoors as flat slabs.

## What was built

- `src/world/shape-geometry.ts`: pure box geometry (selection and collision) for the four models; `BlockShapes.parts` exposes all boxes.
- `src/mesh/shapes.ts` and `src/mesh/vertex.ts`: a fourth vertex kind for sub-block boxes, culling, smooth light and AO; `src/mesh/greedy.ts` wires it in and picks door and trapdoor tiles per state.
- `src/render/chunk-renderer.ts`: the cutout shader decodes shape vertices.
- `src/entity/physics.ts`, `src/world/raycast.ts`, `src/render/block-selection.ts`: multi-box collision (fences 1.5 high), raycast and outline.
- `src/gameplay/shape-blocks.ts` and `src/gameplay/block-interaction.ts`: placement, fence connection, toggling and breaking.
- `src/render/textures/shapes.ts`, `src/ui/icons.ts`: door, trapdoor and door-sprite textures, multi-box icons.
- `src/debug/api/shapes.ts`: `placeShape`, `toggleShape`, `breakShape`.
- Data: `data/{blocks,items,loot,recipes}/shapes.json`, 376 new state IDs (158–533, after M10b's chest).

## Decisions (links to decisions/ files)

- decisions/BLOCKS-shapes-stairs-fences-doors.md

## Known limitations

- Stairs are straight only: no inner or outer corner shapes.
- Fences connect to fences and full opaque cubes only (not to doors or stairs).
- The model bucket now grows on demand, so a section of only shapes uses more worker memory than before.
- Existing test changed: `tests/unit/m10b-crafting-chests.test.ts` line 42 asserted `getMaxStateId()` equals 157 (the last chest state); it is now `toBeGreaterThanOrEqual(157)`. The exact workbench and chest state IDs it checks are unchanged. The owner should confirm this.
- m04.spec.ts:221 and m04.spec.ts:276 timed out in the full verify; both are on the known 2-core container list and are not related to this task. CI on the PR is the check.

## Notes for dependent tasks

- Add a new shape block by giving its model `stairs`, `fence`, `door` or `trapdoor` in `data/blocks/*.json`; textures, state IDs and meshing follow the registry. New state IDs must be appended in registry order to `data/block-state-ids.json`.
- Tile indices of shape faces must stay below 1024 (the shape vertex has a 10-bit tile).
- `BlockShapes.boxes[id]` is a single box (bounding box for multi-box states); use `parts[id]` for exact geometry.

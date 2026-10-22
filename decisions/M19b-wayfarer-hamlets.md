# M19b — Wayfarer Hamlets

## Decisions

1. **Use the M19a structure pipeline and placement data.** The hamlet is registered with
   `createDefaultPipeline(registrations)` in both the main thread fallback and generation workers.
   `data/structures/placement.json` stays unchanged at `wayfarer_hamlet` spacing 34 and separation
   16. The jigsaw assembly and registration contracts from M19a remain intact.
2. **Build an original abandoned settlement from reusable templates.** A central well and path
   junction attach four different house templates, an irrigated wheat farm, and a ladder lookout.
   The houses vary in footprint, planks, logs, windows, repairs, and pitched roof material. Doors
   are left open; no NPCs or future-facing farming behavior are added.
3. **Keep farming static.** `farmland` and eight age states of `wheat_crop` are registry-backed,
   append-only states. Crops use generated, palette-limited cutout sprites and block-loot data.
   There is no growth tick, hoe, or tilling action. The existing `wheat` item is reused.
4. **Adapt the settlement to the active terrain variant.** The structure stage reads
   `terrainVariant()` while it runs. Default, Amplified, and Single Biome use
   `sampleTerrainTopY`; Flat uses its generated surface at y=64. House and farm floors sit above
   the highest sampled ground in the settlement footprint and receive sparse foundation supports.
   Hamlet placement uses the actual active biome rules; Flat columns use their generated plains
   biome.
5. **Let path tiles follow sampled ground and connect the doors.** Path blocks are gravel,
   cobblestone, and planks. Ordinary path cells start at terrain top + 1; well and door endpoints
   are anchored to the shared floor height. A deterministic relaxation raises lower neighbors
   until adjacent path cells differ by at most one block. Raised path sections receive supports.
6. **Load generated chest loot through the chest-loot loader.** The hamlet chest uses
   `data/loot/chests/wayfarer_hamlet.json` and `rollChestLootById`, seeded by world seed and chest
   coordinates. The block-loot loader remains scoped to `data/loot/*.json`; a unit test verifies
   that nested chest tables are ignored there.
7. **Preserve item variants at every drop boundary.** Item entities retain damage and affix on
   inventory drop, pickup, chest break, kiln spill, and save/restore. Item entities with different
   variants do not merge.
8. **Honor the Structures toggle and keep generation work bounded.** The option is passed with
   worker jobs; disabled jobs use a pipeline with no structure registrations. No World properties
   or per-tick/per-frame hooks were added. The structure stage memoizes biome placement probes,
   assembles templates and samples surfaces only after an eligible start is nearby, and keeps a
   bounded start cache. Generated chest sections alone receive the block-entity initialization
   scan.
9. **Use M13b A* for route acceptance.** A debug-only `findPath` wrapper calls the existing
   `Pathfinder` with a read-only query over `World`; it does not use `WorldAdapter`, which would
   redefine `World.onBlockEdited`. E2E checks route from the well rim to every house door.
10. **Treat the farm block items as non-obtainable in survival.** Farmland drops dirt and wheat
    crops drop wheat; M19b adds `farmland` and `wheat_crop` to the existing reachability exemption
    map because this milestone adds no hoe or tilling action.

## M19a engine extensions required by the hamlet

- `StructureTemplateBlock.surfacePath` marks blocks whose y should follow sampled terrain.
  `surfacePathAnchor` keeps path cells at the shared house-door or well height before the one-block
  step relaxation. These fields let the hamlet express surface roads in the existing template data
  model without changing connector matching or jigsaw assembly.
- `TerrainAdaptationOptions.supportFootprint` optionally limits foundation columns to the local
  X/Z columns occupied by a template. M19a's default remains the full rectangular footprint. The
  hamlet plaza is mostly empty, so its path and well supports must not create a stone slab beneath
  its 33×33 bounding box.
- `createDefaultPipeline(registrations)` and the `StructureRegistration` shape are unchanged.
  Terrain surface selection and path relaxation remain internal to the existing structure stage.

## State ID review note

`data/block-state-ids.json` only appends new IDs after 810: farmland is 811 and wheat crop ages
0–7 are 812–819. Call out this append-only state table change in the PR.

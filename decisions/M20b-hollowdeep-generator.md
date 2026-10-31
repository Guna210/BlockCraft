# M20b — Hollowdeep generator

1. **Generation and environment data only.** `src/gen/hollowdeep/index.ts` exports
   `createHollowdeepPipeline(): TerrainPipeline`; `environment.ts` exports
   `HOLLOWDEEP_ENVIRONMENT`. Stages use the existing stage-name seed derivation, run entirely
   on column data, and hold no mutable module-level state. No dimension switching, portals,
   second World, travel, creatures, Updrafts, stew or music are introduced.
2. **M20a owns integration.** At start, master was `89777d7` (M19b and M19c present; M20a
   absent). Until M20a is on master, leave worker dimension dispatch and runtime environment
   application to M20a. The pipeline uses exactly the existing generation contract, so it can
   run in that worker without a new generation system. Recheck master before the publish gate.
3. **Enclosed height 0–192, inclusive.** Foundation Stone occupies every cell at y 0–4;
   Duskrock forms the floor and ceiling, with a sealed Duskrock roof at y 192. Nothing is
   generated above it. Smooth seeded 2D fields form broad cavern floors and uneven ceilings.
   Lava fills openings through y 40; coherent ceiling shafts fall to that sea. Jittered world
   cells place flattened Driftstone islands above chasms, hollow Voidglass geodes in the floor,
   and Glowcap trees in forest areas. Veilroot hangs from caps and ceilings. Base biome labels follow the terrain: dry floors at or above y 40 are Glowcap Forest
   (including clearings), wet floors at y 32–39 are Magma Sea, and deeper chasms are Driftstone
   Expanse. Feature islands and geodes retain their existing biome overrides. Features use global
   anchors and clip their writes to the requested column, including at negative coordinates.
4. **Skyshard band and whole-height rarity, isolated from Overworld.** Appendix A.4 places
   Skyshard only at y 5–60, with a triangular depth distribution peaking at y 20. The table
   introduction defines the rate denominator across the Hollowdeep's whole height, not the
   placement range. Count mineable terrain at y 5–191 (Duskrock, Driftstone, Emberite and
   Voidglass), excluding foundation, roof, air, lava and plants. Normalize the depth weights
   against that whole-height count to expect 25 ore blocks per million solids in each column.
   Both the count and placement happen during generation; no load-time scans are added.
   Position hashes select rare crystals after features, and the sealed floor and roof stay intact.
   Reuse the existing `skyshard_ore` block, drop and textures; change no Overworld ore code.
   The unit test samples 1,024 widely spaced Hollowdeep columns across four seeds, asserts
   20–30 per million, rejects ore below 5 or above 60, and checks that the busiest five-height
   bin starts at 15 or 20. It scans all section palettes of 256 Overworld columns for absence.
5. **Eight original blocks, append-only ids.** `data/blocks/hollowdeep.json`,
   `data/items/hollowdeep.json` and `data/loot/hollowdeep.json` define self-dropping block items.
   IDs after 824: Duskrock 825, Driftstone 826, Glowcap Stem 827, Glowcap 828, Glowcap Gills 829,
   Veilroot 830, Voidglass 831, Emberite 832. Emberite is a block in Appendix A.3 and forms small
   heat-fused nodules near the magma shore. Glowcap and gills emit level 9 with green-cyan tint
   `[0.55, 1, 0.8]` in the existing RGB emission table. Voidglass uses the existing translucent pass;
   Veilroot uses a cutout cross. Icons use the existing block-icon generator and their own textures.
6. **ART.md materials.** Every tile has a declared five-color hue-shifted palette and wrapped
   shapes lit from the upper left. Duskrock has irregular purple stone plates and short cracks;
   Driftstone has flatter blue-grey layers; Emberite has warm fused plates; Glowcap stem has
   vertical fibres; caps have scalloped clusters; gills have diagonal ribs; Veilroot has attached
   leaves on a hanging stem; Voidglass has sparse diagonal violet facets in a translucent pane.
   Unit coverage checks every generated pixel against its palette, the opaque luminance span,
   determinism, registry ids, item, icon and loot. M20b has no Visual Review; M20c owns terrain images.
7. **Environment settings and performance.** Fog `[0.12, 0.065, 0.19]`, density 0.018,
   sky light 0; spores: 12/s, radius 18, lifetime 8 s, rise 0.18 blocks/s, size 0.035;
   lava flow interval 10 ticks. These are data for M20a's runtime, with no new per-frame,
   per-tick or per-column-load scan. The Overworld pipeline and its stages are unchanged;
   Hollowdeep work occurs only when its pipeline is explicitly invoked. The measurement unit
   writes `artifacts/M20b/generation-cost.json` after four warmup and 48 measured columns per
   pipeline; rate evidence is in `artifacts/M20b/ore-rate.json`. Measured values go in the handoff.
8. **Verification and publishing overrides.** Run `MILESTONE=M20 npm run verify:quick` and
   touched-milestone e2e. Full verify: PR CI. Expected container failures listed by the owner
   are not retried or investigated. Do not edit other tasks' tests without approval, including
   adding the new Hollowdeep-only item exemptions if the reachability test demands them.
   Use the GitHub connector for master, branch, commits, pushing and PR creation; no git commands.
   Wait for the owner's publish-gate approval before updating the branch with task changes.
   Never merge master; the owner uses Update branch if needed.

## Owner-approved test edits

The owner explicitly approved these edits in this chat:

- In `tests/unit/m10a-reachability.test.ts`, add only the eight Hollowdeep-only block item
  exemptions (`duskrock`, `driftstone`, `glowcap_stem`, `glowcap`, `glowcap_gills`, `veilroot`,
  `voidglass`, `emberite`), each with task `M20b` and a reason naming the Hollowdeep.
- In `tests/unit/m19c-structures.test.ts`, remove only the assertion that the global maximum
  state id is 824. Preserve every other assertion, including the exact spawner, Silkmesh and
  decorative rail x/z ids 821–824. Remove the now-unused local `ids` binding and its import
  so lint still passes. No other assertions or thresholds change.

The first complete quick run also exposed seams in new fungal textures. Fix those in
`src/render/textures/hollowdeep.ts`, keeping the existing seamless-tiling test unchanged:
mirror the rib phase across horizontal tile edges and keep Veilroot leaves away from its
vertical tile junction, where the continuous stem joins at the same x coordinate.

## Round 1 corrections

The owner's review corrects the earlier placement interpretation: there is no override of
Appendix A.4's y 5–60 band or peak 20. Implement the band and rate normalization above, widen
Overworld sampling to 256 columns, and test the terrain-based biome labels. The original
PR head's Verify run 40888159167 succeeded; the revision must also pass PR CI. Keep
`Full verify: PR CI` as the full-verify evidence and publish all round 1 fixes in one push.

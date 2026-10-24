# M13h — Cinderwraith

## Owner decisions

- Built with M13e's `registerCreature`, `buildModel`, `SkinPainter`, `PRIORITY` and `definition.drops`.
- Original Appendix B design: hunched ash-grey cinder stone, broad shoulders, long knuckle-walking arms, heavy brow, two glowing red eyes, and rising red embers. Flat, low-noise regions use 2–3 stone shades and deliberate stepped cracks (ART.md). Health 30; collision 0.95 × 1.75 blocks.
- Eyes alone use per-part emission. One additional baked vertex float selects full-bright lighting for those parts, in the same single draw. Legacy whole-model `emissive` still supplies white world light with the original face shading. Existing models default to zero part emission.
- Embers reuse the existing particle pool and batch: red tapered sparks drift up, shrink and alpha-fade. At most 24 live sparks per Cinderwraith; teleport emits at departure and arrival. No separate ember system, pool, global scan or frame callback is installed.
- Neutral until player damage or the player's look ray intersects the posed head box within 64 blocks. Cheap inverse-pose slab test precedes the voxel raycast. Only neutral Cinderwraiths within 64 blocks are gaze-tested. Angry mobs use M13c navigation/A* and melee, through the existing runtime's `hurtPlayer` hook and i-frames. Calm on player death, distance >64, or 600 ticks without clear sight.
- Teleport uses `ctx.random`, a bounded safe-spot search, a 4–16 block displacement, loaded columns, full solid support and two air cells. Fluids and lava cannot be landing cells. Hurt triggers teleport; angry mobs also use it to close distance or recover after navigation failure. Attempts have an 80-tick cooldown, including failed searches.
- No natural spawn rules. For M13g: category hostile (mob cap); dark areas, block light 0; rare (suggested weight 10 against Hollow 100); group size 1; all biomes.
- Cinder Shard drops 0–1; new material registry entry, code-generated texture and automatic inventory icon. No recipe; block-state IDs unchanged.
- Cinderwraith goals and sight scratch exist only on spawned Cinderwraiths. Its type-specific tick runs through the existing lazy creature system. No properties are added dynamically to World, Player or other shared objects.
- Local verification is `MILESTONE=M13 npm run verify:quick` plus touched-milestone e2e. **Full verify: PR CI**. Status and PR title become verified only after green CI. First push requires the owner's publish-gate reply with both screenshots shown.

## Owner-approved existing test edit

The owner explicitly approved adding only
`cinder_shard: { task: 'M13h', reason: 'Dropped by Cinderwraith neutral creature' }`
next to the other M13 drops in `REACHABILITY_EXEMPTIONS` in
`tests/unit/m10a-reachability.test.ts`. No other part of that file is changed.
The reachability graph models mining/crafting/smelting but cannot discover creature
`definition.drops`; this entry follows its existing creature-drop exemptions.
The owner also approved enlarging this task's skin dimensions to fit its unwraps.
This approval does not authorize publishing.

## Seed variation regression

M09a's unchanged registry test found that the first shard generator had only two
seam variants, making seeds 12345 and 99999 identical. The generator now selects
four deliberate seam shapes, varying both position and bend height. The owner
authorized this fix in M13h's own code and clarified that further fixes confined
to new M13h code need no pause. M09a's test remains unchanged.

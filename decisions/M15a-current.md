# M15a — Current core & logic decisions

## Persistent block state

- Block state stores only values needed to keep a component's behavior and appearance. Copper Trace stores `power` from 0 through 15. Side connections and one-block up/down steps are sampled from neighboring blocks when the mesh is built; they are never stored.
- The remaining block states are deliberately small: Relay (`facing`, `delay` 1–4, `powered`, `locked`); Inverter Torch (`attachment`, `lit`); Lever and both Buttons (`face`, `powered`); Pressure Plate (`powered`); Tripwire Hook (`facing`, `powered`) with a stateless Tripwire; Gauge (`facing`, `mode` compare/subtract, `powered`); and Lamp (`lit`). Gauge's numeric output level is held by its block entity.
- `data/block-state-ids.json` is append-only. Existing IDs are preserved, including Kiln's final state at 541. M15a appends its states at 542–698. M11a is in flight and contributes no block states.

## Power simulation and timing

- All M15a simulation lives in `src/gameplay/current/`. It represents power levels 0–15, distinguishes weak output to adjacent components from strong power into supported solid blocks, and deliberately has no quasi-connectivity.
- A strongly powered, full opaque non-Current block re-emits its strong input level to adjacent Current components, excluding the component that supplied that input so a conductor does not reflect its own output straight back. `strongPowerAt` reports only strong inputs: a block receiving weak power from a neighboring component does not re-emit it to Copper Trace.
- Receiver inputs sample a Current component's own output, a full opaque block's strong input, or weak neighboring power at a non-solid input position. A neighboring support block does not override an unlit component occupying the input position.
- Neighbor invalidations follow `+X, -X, +Y, -Y, +Z, -Z`. Combinational components settle in stable Y/Z/X coordinate order. Delayed transitions use the existing `BlockTicks` ordering of due tick, priority, then insertion sequence.
- `settle()` scans and sorts the tracked component positions on each edit: O(n) component work per edit, or O(n²) work while adding an n-component circuit. This is the current implementation cost to preserve when optimizing later.
- Relay delay changes and button releases use scheduled block ticks. Stone Buttons release after 20 ticks and wooden Buttons after 30 ticks. Source timers use priority 0 and relays priority 1.
- Inverter Torches that toggle more than eight times in a rolling 60-tick window turn off for 160 ticks (8 seconds at 20 ticks/second), then recalculate their output. This keeps the requested burnout threshold explicit while allowing circuits to cool and resume.
- The stable oscillator test uses two relay legs with 5 ticks of configured delay per leg. Its inverter edge interval is 10 ticks, and it remains stable over 1000 ticks without tripping the burnout rule.

## Components and integration

- Lamp light is data-driven through M10c's `lightEmissionWhen` rule: `lit: true` emits level 15. There is no Lamp lighting special case.
- Pressure Plates and Tripwire query players and dropped items through one `EntityQuery`; the provider API can accept M13 creature entities later. This task adds no creature code.
- Gauge gets container slots through a generic block-entity container interface. Chest and Kiln block-entity registrations expose slots through that interface; Gauge does not identify either block by name. Compare and subtract modes return a 0–15 output level held in the Gauge block entity.
- Copper Trace brightness uses 16 atlas variants (`copper_trace_0` through `copper_trace_15`) with progressively brighter copper ramps. Mesh-time connection geometry remains independent of the stored power state.
- Every M15a block has a procedural texture generator and palette, a block and item registry entry, a generated inventory icon, a self-drop loot entry, and a recipe made from existing materials. Copper ingot is used by the trace and related recipes.
- The CurrentEngine tracked-component set is populated by `setBlock` changes only; loaded chunk state does not automatically register its components. M17b must re-register or scan current components when chunks load before relying on the engine to simulate them.

## Scope boundary

- M15b owns Pistons, Sticky Pistons, powered doors and trapdoors, Dispenser, and Note Block. M15a does not add those blocks, behavior, or hooks.

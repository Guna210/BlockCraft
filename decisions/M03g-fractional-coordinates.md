# M03g-fractional-coordinates — block lookups take the block that contains a position

Status: accepted
Task: M03g (owner-sanctioned change to M03c's code: `src/world/world.ts`, `src/debug/api/locate.ts`)

## Context

The debug API (SPEC §4) takes block coordinates, and tests will pass the player's position, which is
fractional. On a loaded column `World.getBiome` computed `col.biomes[localZ * 16 + localX]` with
fractional local coordinates, got `undefined` and returned the fallback `plains`, whatever the biome
(13 of the 15 tests of `tests/unit/fractional-coordinates.test.ts` failed on master). Unloaded columns
went through `sampleBiome`, which is correct, so the bug showed only after terrain was loaded.
`locateBiome` rounded its start point (`Math.round`), so from x.5 it started one block east or south
of the block that contains the position.

## Decision

- `World.getBiome` floors `x` and `z` first. A position is the block that contains it, in negative
  coordinates too (`Math.floor(-446.5) = -447`).
- `locateBiome` uses `Math.floor` for its start point. Integer arguments are unchanged.
- `getHeight` was checked and needs no change: on master it already returns the height of the
  containing block for fractions 0.25, 0.5 and 0.99 at nine positions with negative coordinates
  (typed-array index truncation gives the same block). `getBlock` and `setBlock` behave the same way
  and are untouched; the ore locator already floors.

## Test

`tests/unit/fractional-coordinates.test.ts`: `getBiome`, `getHeight` and `locate('biome')` at the
camera columns of the seven fixed viewpoints of `tests/e2e/m03.spec.ts`.

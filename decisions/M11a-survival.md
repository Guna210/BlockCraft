# M11a: Survival Model & Hazards Decisions

## 1. Pure-Logic Survival Engine
All survival simulation logic—including health, hunger, saturation, exhaustion, air, burning timers, natural regeneration, starvation, hazard contacts, and eating progression—is encapsulated in `src/gameplay/survival.ts`. It operates on abstract interfaces (`SurvivalHost`, `Position`, `World`) and has no dependencies on WebGL or browser audio, enabling 100% test coverage via Vitest unit tests.

## 2. Exhaustion Table & Sprint Threshold
Exhaustion values strictly adhere to SPEC Appendix D:
- Sprinting: `0.1` per horizontal block traversed
- Swimming: `0.01` per horizontal block traversed in fluid
- Jumping: `0.05` for normal jump; `0.2` for sprint-jump
- Breaking a block: `0.005` per block broken
- Taking damage: `0.1` per hit taken
- Natural regeneration: `6.0` per half-heart regenerated
- Attacking: `0.1` per hit dealt (hooked into attack actions in M13c)

When exhaustion reaches or exceeds `4.0`, it subtracts `4.0` and decrements saturation by 1 (or hunger by 1 if saturation is 0). Saturation is clamped so that it never exceeds current hunger. Sprinting is disabled whenever `hunger <= 6`.

## 3. Natural Regeneration & Starvation
- **Fast Regen**: When `hunger === 20` and `saturation > 0`, 1 half-heart is regenerated every 10 ticks, adding 6.0 exhaustion.
- **Slow Regen**: When `hunger >= 18` and saturation is 0, 1 half-heart is regenerated every 80 ticks, adding 6.0 exhaustion.
- **Starvation**: When `hunger === 0`, 1 half-heart of starvation damage is dealt every 80 ticks down to a floor of 1 half-heart (easy difficulty setting).

## 4. Hazard Damage Rates & Intervals
Hazard timers tick independently:
- **Drowning**: Max air is 300 ticks. Submerging decreases air by 1 per tick. At air 0, deals 2 half-hearts every 20 ticks. Surfacing immediately resets air to 300.
- **Lava**: 4 half-hearts every 10 ticks; applies burning for 300 ticks.
- **Fire**: 1 half-heart every 10 ticks; applies burning for 160 ticks.
- **Burning Status**: 1 half-heart every 20 ticks while burning ticks > 0 outside of fire/lava. Instantly extinguished (`burningTicks = 0`) when entering water.
- **Cactus Contact**: Touching cactus AABB (expanded by 0.02 blocks) deals 1 half-heart every 10 ticks.
- **Suffocation**: Inside opaque solid block deals 1 half-heart every 10 ticks.
- **Void Damage**: Falling below y < -64 deals 4 half-hearts every 10 ticks.

## 5. Death Flag
Health is clamped to `[0, 20]`. When health reaches 0, `dead` is set to `true`. Full death screen UI, inventory entity spilling, and respawn mechanics are owned by M11b.

## 6. Damage Routing & Armor
All player damage sources (hazards, fall damage, and debug damage) route through `survival.damage(amount, source)`. Armor damage reduction calculations will be integrated in combat (M13c/M10a).

## 7. Food & Eating Mechanics
- Eating requires holding the `use` action for 32 ticks (1.6 s) while holding a food item when `hunger < 20`.
- Player movement speed is slowed (`* 0.2`) while eating.
- Crumb particles are emitted using block state textures that match each food item's primary colors (`FOOD_CRUMB_BLOCKS`).
- Releasing `use` early cancels eating without consuming the item.
- Glowcap Stew restores 7 hunger and 8.0 saturation; night vision status effect is deferred to M20 (Hollowdeep) when potion/status effect infrastructure is built.

## 8. Debug API Extensions
- `getPlayer()` exposes `burning: boolean` (derived from `player.survival.burning`) and includes `saturation`.
- `setVitals` accepts optional `saturation?: number` alongside `health`, `hunger`, and `air`.

## 9. Block Registry Isolation
`data/block-state-ids.json` is untouched. Crumb particles map existing block states (e.g. `hay_bale` for bread, `red_stained_glass` for apples) rather than registering new dummy block IDs, preventing merge conflicts with M15a.

## 10. Initial Saturation Default
Player initial saturation defaults to 0 upon world creation. This preserves test stability across prior milestones (specifically M06 fall damage assertions at tick 40) where starting with saturation > 0 would otherwise cause fast regeneration to alter health before the test assertion. Food items and debug `setVitals` supply saturation as needed.

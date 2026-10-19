# M11b decisions: death, respawn, and beds

- A lethal survival damage event records its source and opens the death screen once. The screen shows a readable cause and only the respawn action; closing it is disabled.
- A death spills every occupied inventory slot, including hotbar, main inventory, armor, and offhand, as existing item entities around the death position. XP level and progress reset to zero. XP orbs are not implemented yet.
- Respawn calls `survival.reset()`. `Player.spawnPoint` is a runtime-only `[x, y, z] | null`; `null` means the world spawn. M17b owns persistence.
- A saved bed spawn is valid only while its foot and head still exist as a matching bed and there are two free blocks above the spawn footprint. Invalid or obstructed beds fall back to world spawn.
- `kill(0)` kills the player through the ordinary damage/death path with source `killed`; nonzero IDs are reserved for creature entities from M13a.
- Beds use a foot/head pair with four horizontal facing states. New block states append at IDs 803–810; prior IDs remain unchanged.
- The existing `wool` item is the wool-like crafting material. A bed recipe uses three wool and three planks; no new wool material is introduced.
- Wool is currently obtained from the M13e Tuftbuck, so the bed remains listed as M13e-gated in M10a's reachability exemptions until that creature is implemented.
- Sleeping can start only from time 12500 through 23500 and only when the world entity query has no `hostile` entity within eight blocks. A successful sleep fades to black, advances time to morning (0), then fades back in. The bed spawn point remains set.
- A bed use sets its spawn point even when sleeping is refused for daytime or a nearby hostile.
- Damage feedback is event-driven from survival damage callbacks: a red vignette, a brief roll toward the hit, and a heart shake at health 4 or below.
- Cause labels map M11a sources to player-facing text: drowning → “Drowned”, lava → “Burned in lava”, fire/burning → “Burned”, fall → “Fell from a height”, starvation → “Starved”; other M11a sources receive direct readable labels.
- The bed block and item receive deterministic generated textures, registry definitions, a bed icon, recipe, and a breaking loot entry.

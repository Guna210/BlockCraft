# M23 — Scripted Survival playthrough

## Targets and inputs

1. Use the Singleplayer DOM button and the world-list canvas to create a Survival world with the standard seed. Leave the settings at their defaults and assert the resulting game mode and render settings.
2. Locate Oakwood Forest and use loaded block reads to find a trunk. Teleport to an adjacent standing position, walk toward the trunk and hold attack on its logs.
3. Fill the inventory and Workbench grids by clicking the reported canvas rectangles. Place the Workbench from its hotbar slot and interact with it using the crosshair.
4. Aim at the next staircase cell, mine the blocks in the way and walk into the excavated step. Count collected cobblestone as well as checking that the player reaches the lower steps.
5. Locate ore and look for a standable adjacent cell with a confirmed raycast. Search for exposed ore near the located deposit when its face is buried. Where the ore is buried, mine down from the surface. Locate Desert, find sand in the loaded terrain and mine it by holding attack.
6. Place the Kiln beside the Workbench. Move fuel and measured batches through the Kiln's visible slots and wait for each output before collecting it and crafting the iron pickaxe.
7. Skip to night, find a living hostile in the natural entity population, close the distance and track its health through sword swings. Retreat by teleport if health gets low.
8. Query living Tuftbucks and use sword attacks to obtain three wool. Place and use a crafted bed, then compare world time, respawn position and the player's position.
9. Craft, place and toggle a floor lever, adjacent trace and lamp. Verify the lamp transitions from unlit to lit.
10. Take an inventory and circuit snapshot before using Save & Quit. Reload the same debug URL, select the saved world from the world list, and compare the restored state.

The debug API is limited to input and look, teleport, time skips, locate and read-only queries. Inventory movement, crafting output, Kiln slots, world creation and saving use mouse or keyboard actions. Item grants, block edits, explicit entity spawns, spawning toggles, vitals changes, difficulty changes, weather changes and manual tick advancement are outside this playthrough.

## Materials

- Four logs yield 16 planks in one crafting batch. Four go into the Workbench, three into the wooden pickaxe, four into two batches of sticks and three into the bed.
- The staircase supplies eight cobblestone for the Kiln, three for the stone pickaxe, two for the stone sword and one for the lever.
- Mine three iron ore, seven copper ore, four sand and three coal. Copper ore can drop multiple raw copper items. Smelt three raw iron, seven raw copper and four sand. Coal supplies up to eight smelts per piece, and the third piece gives margin for burn time lost during batch changes.
- Kill Tuftbucks for three wool. Use three copper ingots for the trace and four copper ingots plus four glass for the lamp.

## Waiting

Poll for UI screens, block edits, ground contact, pickups, the Kiln's output, and persisted blocks. Check moving entities on animation frames and cap combat and the overall scenario. Capture each step through the shared fixture so console and rendering checks apply throughout the run.

## Defects

Sleeping originally advanced the clock while leaving the player at the interaction point. The sleep callback in `src/main.ts` now uses the existing bed-position resolver during the fade. Step 8 compares the actual wake position to the bed’s foot.

Inventory pickup and return used to retain the first click as a double-click candidate across clicks in the crafting grid. The inventory handler now clears that candidate after an intervening click. The crafting helper checks both the source remainder and the cleared cursor after returning ingredients.

The Workbench previously registered the original inventory hitboxes first and the crafting-specific slot IDs second. The first hitbox shadowed the second. It now registers one hitbox per storage slot with the screen’s slot offset, and the playthrough checks the result of picking up from each visible storage rectangle.

## Verification

The test has a 60-minute local timeout and a 25-minute CI timeout. The CI duration target is 15 minutes. The publish gate requires one complete local Playwright pass with zero retries, all ten reviewed screenshots and the M23 quick verification evidence.

After the first green Verify run on the PR head, the owner reruns the shard containing M23 twice. All three executions must pass M23 with zero retries. Record the run and job IDs and the M23 duration for each execution in the handoff before marking the PR verified.

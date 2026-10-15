# M09a — Items and inventory: owner decisions

These are the owner's required decisions. M07b is present on latest fetched
`origin/master` (`19500a3`); branch `claude/m09a` starts there.

- Preserve M07b slot indices: hotbar 0–8, main 9–35; add head/chest/legs/feet
  armor slots 36–39 and offhand 40. Keep `getInventory()` entries 0–35 compatible,
  append equipment slots, and expose cursor separately in debug data.
- All interactions operate on inventory/cursor without DOM or rendering:
  left pick/place/swap/merge; right half-split rounded up to cursor/place-one;
  hotbar/main shift routing with armor-slot priority and equipment extraction
  to main then hotbar; left drag floor(count/slots) with remainder on cursor;
  right drag one each; double collect partial stacks first; drop one/all.
  Enforce compatibility and stack maxima, preserve counts for every non-drop
  operation, and spawn dropped stacks through the existing M07b manager without
  losing items when spawning fails.
- Complete category JSON registry from SPEC appendices: all tier tools with
  tier/speed, iron shears, bow, shield, Ember Flint, ore resources and named
  ingots, foods with hunger/saturation, and named materials. Tools, armor and
  shields stack to one; other stack sizes must follow SPEC. Record whether any
  SPEC item actually implies a stack size of 16 after completing the audit.
- Register helmet/chestplate/leggings/boots for A.2 metal tiers as data only,
  with `armorSlot` and max stack one, without defense. These enable routing
  tests; defense is owned by M10a.
- Correct wall torch loot to torch and clay to four clay lumps; audit snow and
  packed ice against A.3; glass drops nothing.
- Exhaustive unit coverage includes merge/split/swap/overflow, all shift routes
  and armor restrictions, drag math for 1–9 slots, and seeded sequences checking
  per-item count conservation.
- No UI, icons, HUD, `uiClickSlot`, recipes, wear behavior or armor defense.
  Do not touch sky, clouds or weather.
- Before first push, report git status, name-status against origin/master,
  verify table, exact Vitest/Playwright totals and every failure classification;
  wait for owner approval. Then push and open a draft PR; CI decides.
- The owner's container exceptions are M02 mesh p95; M04 pump over 50 ms,
  heap-growth timeout, RD12 idle timeout or approximately 65 px hole; M04b
  mid-flight blank; M05 streaming timeout; M01a GL-check count; occasional
  pathfinding 2 ms benchmark. Any other failure belongs to this task.

## Implementation choices

- `Inventory.snapshot()` retains its original 36-slot storage snapshot for
  existing M07b unit consumers. `snapshot(true)` and debug `getInventory()` expose
  all 41 slots; `getInventoryCursor()` is a separate detached stack.
- Copper and iron are the metal tiers in A.2. Skyshard is explicitly a crystal,
  so this task adds copper/iron armor only. Each of the eight pieces has its
  matching `armorSlot`, stack one, and no defense or wear fields.
- Appendix A prescribes no item with a 16-stack limit. Non-tools/non-armor use
  64, including bowl foods; this task does not invent a 16-stack rule.
- A.3 specifies no distinct snow/packed-ice drop transformation: their existing
  self drops remain. Glass remains empty. Wall torch and clay loot are corrected.
- Ore resource items are registered here; randomized ore/leaf loot behavior is
  not introduced by this inventory task. Existing harvest/drop behavior remains
  except for the explicitly requested wall-torch/clay corrections.
- Distribution divides by distinct eligible targets with available room. Capacity
  truncation is retained on the cursor; it is not redistributed. Right drag
  visits each eligible target once in input order until the cursor empties.
- Double collect requires a nonempty cursor; scans partial stacks first then
  full stacks, in ascending slot order, including equipment. Offhand accepts any
  item; armor slots accept only their declared armor type.
- Bow, shield and Ember Flint have no A.2 tier/speed assignment; they remain
  un-tiered data. The five tiered tool families and iron shears carry the exact
  Appendix A.2 harvest level and speed.
- New nonblock entries have world-drop sprite generators because the existing
  M07b renderer requires them. These are atlas textures, with declared palettes
  and deterministic shapes; no inventory icon atlas, UI or HUD is added.

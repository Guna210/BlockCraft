# M13a — ECS & entity rendering

Decisions set by the orchestrator for the owner, and how M13a carries them out.

## 1. ECS (`src/entity/ecs/`)

- `world.ts`: `EntityWorld`. Each component type is a `ComponentType<T>` key made by `defineComponent<T>(name)`, and its values live in one `Map<id, T>`.
- `query(...types)` starts from the smallest store, keeps the ids that have every listed component, and returns them **sorted ascending**. Adding components out of id order still gives a deterministic visit order. `query()` with no arguments returns every live entity.
- Ids start at `ECS_FIRST_ID = 1 << 20` (1048576), so they never clash with item-entity ids (which count up from 1). `item-entity.ts` is unchanged.
- Systems are registered with `addSystem(run, order)`: lower orders run first, equal orders in insertion order. `createEntityWorld()` installs three built-in systems:
  - snapshot (order −1000): copies this tick's starting state into the `previous*` fields used for render interpolation;
  - animation (1000): walk phase and speed, head tracking, and expiry of one-shot clips;
  - health (1100): hurt countdown, death tip-over, and removal.
  Later tasks (AI, physics, combat) add their systems between −1000 and 1000, so the animation system measures the movement they cause.
- The ECS is pure: no DOM, WebGL or render imports (ready for M21a's shared-code lint rule). `PlayerController.ecs` owns the world's instance. It is created in `spawn()`, cleared in `reset()`, and ticked once per game tick, after item entities.
- No persistence: ECS entities are not saved (creature persistence is out of scope).

## 2. Models are data (`src/entity/ecs/model.ts`)

- `EntityModel = { id, textureSize, parts: [{ name, parent?, pivot, rotation?, cubes: [{ from, size, uv, inflate? }] }], walk?, head?, clips? }`, in model pixels (1/16 block).
- Model space: +Y up, the model faces **+Z**, its right-hand side is −X, and the origin is the centre of the feet. Cube `from` and part `pivot` are absolute model coordinates.
- Box UV unwrap at `uv = (u, v)` for size `(w, h, d)`: top `(u+d, v)`, bottom `(u+d+w, v)`, then on row `v+d`: right(−X) `u`, front(+Z) `u+d`, left(+X) `u+d+w`, back(−Z) `u+2d+w`. The unwrap is `2(w+d) × (d+h)`. `inflate` grows the box without changing its UVs.
- `validateModel` enforces: at most 24 parts (`MAX_MODEL_PARTS`), unique names, each parent listed before its children, UVs inside the texture, and walk/head/clip references to existing parts with ordered keys.
- `registerEntityModel(model, skin)` registers the model with its procedural skin, a `SkinGenerator(seed) → RGBA bytes`. The renderer generates the skin with seed 1. M13e and M13f supply the real models and skins, following ART.md (palette rules per body part). M13a registers **no** models: the unit tests define their own models inside the test files.
- **Rendering:** `src/render/entities.ts` bakes each model once into one static vertex buffer: position, uv, normal, part index (9 floats). The renderer uploads each entity's part matrices (`u_parts[24]`) and issues **one `drawArrays` per entity**. Each part's world matrix is `root · parent · T(pivot + keyframe offset) · Rz · Ry · Rx · T(−pivot)`, where `root = T(pos) · Ry(π/2 − yaw) · Rz(tip) · S(1/16)`. Entity yaw follows the camera and player convention: forward is `(cos yaw, 0, sin yaw)`.
- **`render/player-model.ts` is not refactored.** It could share this renderer later: its six parts fit a 64×32 data model with pivots, its walk is the same sin(distance) formula, and it would drop from 6 draws to 1. The cost is moving its skin from atlas tiles (`player_head`, `player_coat` …) to a model skin texture, which changes the M06b third-person look and its tests. That belongs in its own task.

## 3. Animation (`src/entity/ecs/animation.ts`, `pose.ts`)

- Walk: `swing = maxSwing · sin(phase + limbOffset) · min(speed / refSpeed, 1)`, applied around the limb's X axis. The phase advances by `2π · horizontalDistance / stride` each tick, so it depends on **distance, not time**: standing still or falling straight down leaves it unchanged. Speed is the horizontal distance over the last tick × 20.
- Head tracking: the target yaw (relative to the body, wrapped to (−π, π]) is clamped to ±60° and the pitch to ±40° (both can be overridden per model). Each tick closes 35 % of the remaining angle (`HEAD_SMOOTHING`). A null target returns the head to rest. The eye is the head pivot's height above the feet.
- Keyframes: channels per part, `rotation` (radians) or `position` (model pixels), `linear` or `step`, with keys in ticks. Values outside the first and last keys hold. A looping clip wraps; a one-shot clip ends after `length` ticks and is removed from the animator. Several clips add together on top of the rest pose, and procedural walk and head angles add on top of the clips.
- Interpolation: position, yaw (shortest arc), walk phase, speed, head angles and death ticks are interpolated with `PlayerController.renderAlpha` (the partial tick). Clip time is `time − 1 + alpha − start`.

## 4. Lighting

- `entityLight` samples sky light and RGB block light at the block containing the entity's centre (`pos.y + height / 2`). It applies the terrain curve: `max(lightBrightness(sky) · skyLightMultiplier, lightBrightness(block))` per channel, with the underwater brightness floor the terrain also uses. The same face shading as the terrain (top 1, z sides 0.8, x sides 0.6, bottom 0.5) is computed from each part's rotated normal. An entity in a dark cave therefore gets 0.04, the same light as the cave walls before their AO.
- The entity pass runs in the chunk renderer's `drawPlayer` callback (after opaque and cutout, before particles and translucent, per SPEC §3.2), with the same fog as the player model. It re-binds the terrain atlas on texture unit 0 afterwards, because the translucent pass expects it there.

## 5. Hurt tint and death

- `damageEntity` lowers health and sets `hurtTicks = 10` (M13c's invulnerability window). While `hurtTicks > 0` or while dying, the fragment colour is `mix(skin, red, 0.4)` before lighting, so a hurt entity in the dark stays dark.
- Death: when health reaches 0 the entity is `dying`. `deathTicks` counts up, and the body rotates `deathTicks / 20 · 90°` around its forward axis (model +Z), so it falls sideways. It lies flat at tick 20 and is removed on tick 21, so the flat pose is drawn before it disappears. A dying entity takes no further damage and is not reported to `EntityQuery` (it presses no plates and does not count as a nearby hostile).

## 6. Debug API (`src/debug/api/entities.ts`)

- `spawn(type, x, y, z)` looks up `src/entity/ecs/entity-types.ts`, which has exact types (`registerEntityType`) and prefix families (`registerEntityFamily`). The only real family is `item:<itemId>`, which drops one of that item through `ItemEntityManager.spawn` and returns its item-entity id. An unknown type (including `item:` with an unknown item) throws `Unknown entity type: <type>`. No placeholder creatures are registered.
- `getEntities(filter?)` returns item snapshots and ECS snapshots together, sorted by id. ECS snapshots are `{ id, type, pos, health, state: 'alive' | 'dying' }`. The filter's `type` is an exact match and `radius` is measured from the player. The type has an overload so `getEntities({ type: 'item' })` still returns item snapshots (with `item`, `count`, `age`) to existing specs.
- `kill(id)`: id 0 kills the player as before (the M11b logic moved into `killPlayer()` in `death.ts`, so one module owns `api.kill`). An item entity is removed. An ECS entity with health has its health set to 0 and plays the tip-over; one without health is removed at once. An unknown id throws `No entity with id <id> exists`.

## 7. EntityQuery

- `PlayerController.spawn` adds an `'ecs'` provider next to `'player'` and `'items'`, so pressure plates, tripwire and the bed's hostile check see living ECS entities (bounds: width × height around the feet). `reset()` removes it.

## 8. Performance

- One draw call per entity, with the part matrices uploaded through `uniformMatrix4fv(loc, false, pose, 0, parts · 16)` and no per-frame allocation in `computePose`. `tests/unit/m13a-render.test.ts` renders 100 entities of two models and asserts exactly 100 `drawArrays` calls per frame, over three frames, with two static buffers and two skins created in total. Entities farther than the fog end + 4 blocks are skipped.

# M18b — Settings & keybinds

## Decisions

1. **Settings model and defaults.** `src/engine/settings.ts` owns the live settings and complete defaults. Defaults preserve the shipped behavior: render distance 8, FOV 70°, base sensitivity multiplier 1, normal Y, fancy leaves and clouds, smooth lighting and particles enabled, automatic GUI scale, brightness 1, view bobbing on, and volume levels 1. Key defaults match the existing WASD, Space, Shift, Ctrl, F5, mouse-button, E, Q and number-row controls.
2. **Apply through current paths.** Render distance calls `WorldManager.setRenderDistance`; leaves calls `WorldManager.setLeaves`; clouds and view bobbing continue to read the shared model; FOV updates the camera projection; sensitivity and invert Y are read in the camera input path; smooth lighting and brightness are shader uniforms; particles gate drop and weather particle rendering; GUI scale is selected by the shared `uiScaleFor` helper.
3. **Audio scope.** Volume levels are persisted. The current procedural sound engine has synthesized effects only, and its envelopes apply master × effects volume. Music and ambient values are stored; M16b wires the full volume model and separate playback categories.
4. **Persistence.** `SaveDb` moves to version 2 and adds a `settings` store with a single `global` record. The existing stores are created only when missing during upgrade. World rename, copy and delete operations iterate the world-store list, so global settings remain separate. Missing or damaged fields normalize back to defaults, and load failure falls back to the complete defaults before the menu appears.
5. **Input ownership.** `src/engine/keybinds.ts` is the action-to-code source of truth for gameplay, HUD and menu readers. Multiple actions may share a key; the settings screen displays the conflict and all bound gameplay actions receive that input. Rebinding an action replaces its old code, so Jump=K leaves Space unbound.
6. **UI.** `src/ui/settings-screen.ts` owns the settings overlay. It uses the shared pixel font, beveled panel and palette, with DOM controls for accessible clicks and slider input. Main-menu and pause-menu entry points keep their existing drawing and input flows.
7. **Debug API.** `src/debug/api/settings.ts` exposes `getSettings`, `setSetting` and `resetSettings`; it is registered by one import in the API index.
8. **Hot paths.** Settings are copied and normalized only on load or user changes. Render-time effects use the live settings object and existing renderer fields; no properties are added to `World`, `Player` or other hot shared objects.

## Owned evidence

- Unit coverage checks defaults, normalization, persistence, v1-to-v2 world preservation, and shared-key conflict routing.
- M18b E2E coverage changes render distance and FOV from the UI, rebinds Jump to K, confirms Space no longer jumps, and checks the visible conflict warning.
- Visual review: `docs/screenshots/M18b/m18-settings.png`.

# M17c — World list decisions

These decisions define the world list work and follow the M17b persistence interfaces.

## Persistence

- Keep `src/persist/save-manager.ts` and `src/persist/idb.ts` as the foundation. M17c adds small management methods around their existing list, transaction and save behavior.
- Delete every record under a world's key in every store named by `STORE_NAMES` in one readwrite transaction. The e2e reads each store directly from IndexedDB, checks the target has records before deletion and none afterward, and confirms a second world is unchanged.
- Rename and duplicate cover every store in one readwrite transaction. Rename changes the world key in every record and deletes the old keys in the same transaction. Duplicate copies each record and changes only the world key/name. Both reject an existing target name.
- Names are trimmed and must contain 1–32 Unicode code points. The UI checks for an existing exact name and IndexedDB repeats the uniqueness check inside its transaction.
- Save format stays at version 1. Add `thumbnail?: Blob` to `WorldRecord` in place because this save format has not shipped.

## Thumbnails

- When a save needs a thumbnail, request one rendered frame and immediately copy the WebGL canvas into a 160×90 2D canvas with image smoothing disabled. This samples the frame before the WebGL drawing buffer is discarded; the WebGL context does not request `preserveDrawingBuffer`.
- `main.ts` checks the request flag after rendering and copies at most one frame per save. With no pending request, there is no `getContext` or `drawImage` work in the frame loop. If a visible save requests a frame but none renders within 500 ms, keep the world's existing thumbnail, or omit the thumbnail when none exists.
- Saves triggered for `hidden` or `exit`, and any save that reaches its thumbnail step while the document is hidden, skip the frame request and write the player and world records immediately after region flush. They reuse the world's existing thumbnail, if any, so pagehide does not delay the latest position or inventory write. Visible pause and autosave runs still request a fresh frame.
- Time spent in the render-loop `drawImage` call is recorded as the save's `thumbnail` stretch, alongside the thumbnail encoding request.
- Convert the captured frame to a PNG Blob as the world record is written.
- Draw a small code-generated landscape in the shared UI palette when a world has no thumbnail.

## Screen and debug API

- `src/ui/world-list-screen.ts` owns the overlay. It uses the shared beveled UI kit and pixel font, works before a game world exists, and does not alter the main menu or boot flow. M18a can link to it later.
- Sort entries by `lastPlayed` descending and display local `YYYY-MM-DD HH:MM` time. Each row has select, rename, copy and delete actions; deletion names the world in a confirmation dialog.
- The debug API adds `openWorldList()` and `listWorlds()`. The latter returns only plain JSON objects shaped as `{ name, lastPlayed, hasThumbnail }`. The existing debug `createWorld` call remains unchanged.
- The delete e2e clicks the visible row action and confirmation on the real canvas UI. It does not call a debug delete shortcut.

## Review evidence

- The M17c screenshot is captured from the real world list with three saved worlds, game-rendered thumbnails, names, local dates and one selected row. It is copied from `artifacts/M17c/m17-world-list.png` to `docs/screenshots/M17c/` and described in the task handoff.
- Remove only the approved `DROPS` console log from `tests/e2e/m17b.spec.ts`.

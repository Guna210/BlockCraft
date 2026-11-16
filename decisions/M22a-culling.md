# M22a — culling and batching decisions

The owner fixed the following design for M22a:

- Compute a 15-bit graph of connections between section faces from non-opaque-full-cube cells in the mesh worker. Empty sections connect every pair; solid sections connect none. Keep the result outside `World` and `Player`.
- Traverse from the camera section using face connections and monotonic paths, with frustum tests, preallocated queues and generation-stamped visitation. Recompute on camera-section or direction-bucket changes and mesh changes; sections without ready masks are open.
- Refine the existing column frustum test with section tests. Use shared per-pass buffer arenas and `WEBGL_multi_draw` when available, preserving per-draw fade and offsets, translucent order, fluid, foliage and portal rendering. Fall back to section draws without the extension, and release GPU resources with columns.
- Expose culling controls only through the debug API. Shared terrain rendering must serve both single-player and multiplayer; remote players and name tags remain independent of ECS terrain culling.
- Count every section draw represented by a `WEBGL_multi_draw` batch in `getRenderStats().drawCalls`; also expose the number of actual GL draw submissions as `drawSubmissions`. This keeps section-level counts useful and makes batching visible.
- When `?debug=1&glcheck=draw` is active, disable `WEBGL_multi_draw` and submit sections individually so the existing M01a-fix check can drain errors after each actual draw and retain draw attribution. Ordinary debug mode continues to use multi-draw and the once-per-frame drain.

## Implementation status

The streamer skips geometry jobs for empty and enclosed opaque sections. It sends their compact classifications with a worker job; the worker returns their all-connected or disconnected masks. Missing and invalidated masks remain open until the result arrives.

Traversal batches incoming faces at each breadth-first distance. A monotonic path's direction history is fixed by its displacement from the camera, and all paths to a section have the same length. Consequently each section can be queued once and processed after its predecessors contribute their incoming faces. Traversal is bounded vertically by the camera and the lowest and highest sections with geometry: a monotonic path to geometry cannot leave that interval. Frustum boxes are expanded for camera motion and direction changes within a bucket; the normal column and section frustum tests remain exact for drawing.

GPU arenas use pages per pass, releasing a page when its last section range is freed. Each page owns its vertex buffer, vertex staging buffer and element index buffer. Page-local allocators require page-local element buffers so sorted translucent indices cannot collide with another page's ranges. Multi-draw groups only sections sharing a column, page and shader variant, retaining that column's tint textures. Origins and fade amounts are indexed by `gl_DrawID`. Translucent batches contain only adjacent entries in the established back-to-front order. Per-section draws are used without the extension.

Verification is not yet complete. See [progress/M22a.md](../progress/M22a.md) for measured results and outstanding checks.

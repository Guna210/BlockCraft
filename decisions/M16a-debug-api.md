# M16a Debug API Decision

Added `audio.renderOffline` to the `__blockcraft` debug API when `?debug=1`.
This method accepts a string `soundId` and `seed`, and internally runs the corresponding procedural sound recipe on an `OfflineAudioContext`. It returns the `rms`, `peak`, and length details to verify non-silence, non-clipping, and determinism.

# data

**Owner:** Ronan

Terrain inputs and engine outputs.

- `raw/`: downloaded source data. Not committed (see `.gitignore`).
- `out/`: engine exports, committed so the app owners get them without running the engine.
  - `layers/`: derived layers (skyline, open-sky fraction, sunlight, line of sight)
  - `terrain/`: terrain prepared for display

Files that will probably live here:

- `raw/`: the DEM and orthoimage downloads for Murray Buttes
- `out/layers/`: one file per derived layer
- `out/terrain/`: cropped or downsampled terrain for the hub and headset

GitHub rejects files over 100 MB. If the reduced terrain mesh is still that large, shrink it further, or add `data/out/terrain/` to `.gitignore` and share it another way.

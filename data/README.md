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

## Sites

Gale (Murray Buttes) is the default site and keeps the layout above: `data/site.json`, `raw/`, `out/` and `cache/`.
Another site lives beside it and is chosen by name, with `SITE=<name>` in the environment or `--site <name>` on any
engine command, tools script or the relay:

| What | Gale (no site set) | Site `<name>` |
|---|---|---|
| Site file | `data/site.json` | `data/sites/<name>/site.json` |
| Downloads | `data/raw/` | `data/raw/<name>/` |
| Engine outputs, served as `/data/` | `data/out/` | `data/out/<name>/` |
| Site-specific caches (REMS weather, stop images) | `data/cache/` | `data/cache/<name>/` |
| Site-independent caches (RAD storm, DONKI) | `data/cache/` | `data/cache/` (shared) |

What the engine needs from a site file, besides `sky`, `base`, `routeStops`, `planner` (including `expectedShelterCount`), `plannerBounds` and `storm`:

- `grid`: `metresPerPixel`, `southWestEasting`, `southWestNorthing` and `projection` (WKT) of the crops in the raw folder.
  The engine stops if `near.bin`'s header disagrees.
- `farFieldCentre`: `{ x, y }` local metres where the far-field skyline is computed once and reused.
- `layersRegion`: `{ originX, originY, cells, metresPerPixel }`, the square the map layers cover.
- Optional: `validation` (ground truth for `engine check`: `checkPoint`, `openGroundStop`, `skyCheckStops`, `paperTarget`,
  `referenceCheck`), `baseCandidates` (for `engine base-candidates`), `decisionSweep` (stops for `engine decide --sweep`),
  `shelterLabels`, `stopImageQueries` (for `tools/fetch_stop_images.py`), `weatherFeedUrl` (for `tools/fetch_rems.py`),
  and `parkingSpot.lon` (local solar time for the weather briefing).

Without `validation`, `engine check` prints "no ground truth at this site" and runs only the fast-against-precise
self-check at the first route stop.

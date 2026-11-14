# Jezero: Three Forks and the delta front

The active native scene uses NASA/JPL-Caltech/University of Arizona/USGS measured terrain and HiRISE imagery, in the same local coordinate frame as `data/out/jezero/waypoints.json`. It replaces Gale/Murray Buttes in VR. AR remains passthrough, with the Jezero mission's ring and telemetry.

## Coverage and fidelity

- The route area uses the committed `data/out/jezero/terrain/detail_height_600.bin`: 600 by 600 measured samples at 1 m spacing. Samples span 599 m between centres; the matching 2400-square image covers 600 m. All 428 main/diversion samples match the heights within 0.25 m.
- The surrounding 7 km square is reprojected from the earlier USGS Jezero export, originally a 1025-square grid over 10 km (9.765625 m spacing). The 7 m output sampling does not add measured detail. Outer geometry uses roughly 32 m cells. A circular walking boundary gives approximately 3.5 km radius.
- The maximum visible budget is 865,108 triangles, including seam geometry and decorative stones. Automatic detail levels reduce normal rendering; final Quest performance requires an on-device check.
- The 20 m outer edge of the detail tile blends into the coarse terrain to avoid a step. No route samples lie in that blend. Collision uses the fine surface in the route area and the coarse surface outside it. These are landscape surfaces, without reconstructed caves or overhangs.
- The image cache is the HiRISE red-filter orthomosaic. Warm tint, sand/layered-rock materials and loose stones are illustrative. The original satellite image and the planner's values are not modified. The static visual shadow bake uses the exported Jezero Sun (275.8 degrees azimuth, 12 degrees elevation) with the 1 m detail and 4 m surrounding export; it does not determine mission sunlight/dose.

The original claimed 45-million-triangle packaged model was not identified. This is an optimized mesh made from the verified USGS data, not a claimed import of that package or a rover-photo reconstruction. Close-range photogrammetric alternatives were investigated; an academic download was blocked by its verification page and was not bypassed or included.

## Sources and frame

Credit: NASA/JPL-Caltech/University of Arizona/USGS. Exact sources and registration are in `terrain.json` and `data/out/jezero/terrain/terrain.json`.

- [USGS 1 m stereo DTM](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif)
- [USGS route-area orthomosaic](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif)
- [USGS/PDS wide orthographic mosaic](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif)

The planner uses equirectangular standard parallel 18.4663 degrees, southwest projected origin (4350608, 1092468). Unity maps east to +X, elevation to +Y and north to +Z, then applies the user's calibrated north. Reprojection happens offline, not in the headset. At runtime the original mission coordinates remain available for navigation. Jezero uses its own Sun, Earth delay, route and shelter decisions; Gale data are not overlaid on it.

## Reproduce

Run `.venv/Scripts/python.exe tools/prepare-jezero-native.py` using `tools/requirements-terrain.txt`. The script consumes committed Jezero detail assets and the ignored wide caches under `data/raw/jezero/`. Missing caches are downloaded in bounded ranges from the recorded USGS/PDS URLs using `tools/jezero_ranges.py`; no full planetary mosaic is required. Then run `tools/build-quest-native.ps1`. Reduced assets are committed; raw caches are not.

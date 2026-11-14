# tools

**Owner:** Ronan

Small one-off scripts that support the rest of the repo.

## Native Quest terrain and checks

- `prepare-jezero-native.py` prepares the active Jezero route tile and a measured 7 km surrounding landscape in the planner frame. `jezero_ranges.py` supplies bounded/resumable NASA/USGS source reads when the ignored wide caches are absent. The native launcher defaults to Jezero; the original Gale exporter remains available below.

- `prepare-mission-vr.py` exports the planner-aligned Gale detail tile, matching colour window and static visual Sun shadow from the existing ignored `data/raw/near.tif`. It copies the results into Unity; see `apps/quest/Assets/Beacon/Art/MissionTerrain/README.md` for provenance and generated-appearance limits.
- `build-quest-native.ps1` prepares the native project, checks mission/VR behaviour, renders previews and builds the APK. `-PrepareOnly` skips the final APK.
- `mirror-quest.ps1` defaults to a laptop-filtered single eye through `mirror-quest-client.ps1`. Install official scrcpy 5.0.1 and the verified local FFmpeg distribution as described in `apps/quest/README.md`. `-Eye Both` retains the earlier full-frame mirror.
- `demo-quest-run.mjs --quick` rehearses all main points and the far-point shelter diversion through the actual relay. Use AR during presenter-driven rehearsals so physical VR arrival does not compete with presenter steps.

Files that will probably live here:

- a script to download the raw terrain data into `data/raw/`
- a script to generate local TLS certificates into `relay/certs/`

## Sites

The site-dependent scripts take `--site <name>` or `SITE=<name>` (see `data/README.md`); `sitepaths.py` resolves the
paths the same way the engine does. With neither, they work on Gale exactly as before.

- `fetch_mola.py`, `fetch_stop_images.py`, `fetch_rems.py`, `export-terrain.py`, `check_fakes.py`: use the site's folders.
- `fetch_donki.py`: reads the site's sky time; its cache is shared by every site.
- `fetch_rad.py`: accepts the option; the RAD storm is site-independent.
- `prepare-buttes.py`: Gale only (its DEM, image and window are fixed); it refuses a site.
- `fake_scene.py`, `make_fake_layers.py`, `make_fake_waypoints.py`: write the shared fakes in `shared/fake/`, which belong to no site.

# Planner-aligned Murray Buttes terrain

Version 0.11 uses the team's real Gale DEM and HiRISE colour mosaic, replacing the separate Access Mars photo island in the active VR scene. Source URLs, coordinate frame and dimensions are in `terrain.json`. Credit: NASA/JPL/University of Arizona/USGS. These files are visual derivatives; the route, sky and dose outputs remain authoritative.

- `height.bytes`: 601 by 601 little-endian Float32 samples at 1 m spacing, north row first; absolute elevations. Vertex extent is 600 m, starting at local southwest (1200.5, 1140.5). All 268 exported main/diversion points fit inside.
- `orbital.jpg`: matching 601 m image footprint at 0.25 m/pixel, 2404 square. Sampling more densely than the source does not create measured detail.
- `background.bytes` / `background.jpg`: existing 3 km, 4 m DEM / 2048 colour image for distant scenery.
- `shadow.bytes`: 301 square Float32 visibility mask from DEM rays toward the scenario Sun (280.4 degrees azimuth, 12 degrees elevation). This static visual shading is valid for that scenario direction; it never supplies the planner's sunlight/sky calculations.

Unity uses +X east, +Y up, +Z north before the north calibration. Runtime placement centres the mesh for precision while preserving absolute mission coordinates. Thirty-six detail chunks use 1/2/4 m mesh levels; 16 m distant terrain fills the surrounding square. The maximum visible triangle budget is 834,976, including seam skirts, distant ground and 1,800 decorative stones. Collisions use the actual 1 m terrain, without generated displacement.

`MarsCosmeticDetail.png` and `MarsLayeredRock.png` add invented sand grain and layered sandstone. The small stones are procedural scenery. These improve continuity and surface readability; they are not recovered rover measurements, a scientific reconstruction, or surveyed obstacles. Original imagery remains unchanged. The HUD identifies generated materials and illustrative stones. The retained Access Mars assets are archived, not used by the active scene, and keep their Apache licence/notices.

Reproduce from the repository root with `.venv/Scripts/python.exe tools/prepare-mission-vr.py` after `tools/prepare-buttes.py` has created the ignored `data/raw/near.tif`. Python dependencies are in `tools/requirements-terrain.txt`. This copies the committed exports into this Unity folder. Then run `tools/build-quest-native.ps1` to generate/import the scene, run checks and build the APK.

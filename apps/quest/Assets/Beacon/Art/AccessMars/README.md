# Access Mars — Murray Buttes VR reference scenery

Source: [googlecreativelab/access-mars](https://github.com/googlecreativelab/access-mars), pinned commit `4b0a445f4e3b3fbfbc6b06f3adf07c24c05a2c57`.

The repository actually contains `public/terrain/murray_buttes/terrain.glb`, `background.jpg`, and 64 photograph tiles with four resolution variants. The whole Murray folder contains 258 files / about 13.34 MiB. Its root licence is **Apache 2.0**, Copyright 2017 Google Inc.; no separate Murray terrain licence or exception was found. See the retained [LICENSE.txt](LICENSE.txt) and [upstream licence](https://github.com/googlecreativelab/access-mars/blob/4b0a445f4e3b3fbfbc6b06f3adf07c24c05a2c57/LICENSE).

Access Mars is a collaboration between NASA, Jet Propulsion Laboratory and Google Creative Lab. Its terrain was reconstructed by JPL from Curiosity photographs. Credit: NASA/JPL-Caltech and Google Creative Lab. No endorsement is implied.

## Modifications for Beacon

These assets have been converted for a native Unity application:

- Draco is decoded offline with DracoPy 2.2.0. The original scene's 100× transform is applied together with its 0.01 root transform, preserving the original displayed metre scale.
- Z and triangle winding are converted from glTF's handedness to Unity. The V coordinate is flipped exactly as in the original Access Mars terrain shader, which compensates for its COLLADA export.
- `terrain.bytes` packs positions, normals, texture coordinates and indices. `terrain.json` describes every mesh, source commit and source-file hash. Downloaded files are checked against Git blob hashes before conversion.
- JPEG file bytes are unchanged. Unity imports them with mipmaps, anisotropic filtering, and ASTC 6×6 compression up to 2048 pixels on Quest.
- There are **158,096 visible triangles**: 127,952 in the photographed central terrain and 30,144 in the distant background. The original 1,320-triangle simplified proxy is retained in the packed data for provenance but is not rendered or used for walking; collision follows the photographed terrain meshes.
- The model covers a roughly 128 m square of nearby terrain, with a coarser distant background. Walking stays inside the reconstruction. Missing/low-resolution photography is retained faithfully; it is not generated or filled with invented surface detail.
- Native unlit rendering preserves the photographed lighting. A little distance haze connects the far background to Beacon's illustrative sky. Moving particles are absent.

The full licence and a modification/attribution notice are also included in the APK's `StreamingAssets/ThirdParty/` directory.

## AR first and visual alignment

Beacon starts in AR passthrough. The model is entirely hidden and the movement controller disabled in AR. X enables the model only for VR; X again restores the real-room tracking frame. Left stick walks, right stick turns continuously, and the right index trigger increases walking speed. These controls never advance or reroute the mission. B remains the existing shelter request.

The initial model viewpoint is `(12.25, ground, -4.39)` in the converted model: 8 m toward the butte from Access Mars's original starting point. The model is rotated 257.8° relative to calibrated north. This is a **visual alignment**, putting the prominent M12-side butte beneath the Quela waypoint ring's northwest high side (peak sample 330°). The rendered crest is about 25° high at a 1.65 m eye height, versus the data's 29° peak; the outline is not an exact match. Native renders with/without the ring were inspected alongside NASA's [M12/Quela reference photograph](https://science.nasa.gov/resource/curiosity-self-portrait-at-murray-buttes/).

This is not a surveyed transform or a claim that the model matches every waypoint. Scenery does not move when the route changes. The ring, Sun, Earth and readings remain supplied mission data, including during free exploration. Walking does not recalculate the ring from the reference model. The requested directional alignment is usable, so the 600 m DEM fallback was not substituted.

`BeaconVrPreview.Render` makes native previews with/without the ring, plus an AR comparison, under `.local/murray-vr-previews`. These are editor renders, not headset captures. Final alignment findings and headset validation are recorded in `apps/quest/ACCEPTANCE.md`.

## Reproduce

Install Python packages `DracoPy==2.2.0`, `numpy`, and `Pillow`; keep curl available. Run `python tools/prepare-access-mars.py`; it fetches the pinned recursive Git inventory if absent and verifies the selected source files before conversion. Raw source downloads stay in ignored `data/raw/access-mars/`. The Unity build helper prepares the scene, checks the mission and VR controls, renders previews and builds the APK. `-PrepareOnly` performs preparation/checks/previews without producing an APK.

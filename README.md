# Beacon — Murray Buttes surface companion

CJ's Quest 3 headset starter, built with Three.js and WebXR. The repository originally contained only this README. The current implementation is a **working synthetic-data prototype**, with an explicit handoff contract for Ronan's engine/relay.

## Run on the laptop

Node.js 22.12 or newer is required.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173/apps/headset/**. On Windows, after dependencies are installed, double-click **Start Beacon.cmd** instead. Keep the server running. Drag the skyline to look around, or focus it and use the arrow keys. Open a second browser tab to check synchronized presenter controls.

The server listens on localhost. No external CDN, account, API key, internet connection or real terrain download is needed after installation.

## Use the Quest over USB

1. Enable Developer Mode through the headset owner's paired Meta Horizon phone app. A secondary headset profile cannot pair independently with the phone app. A verified developer account/team may be required. Do not reset a borrowed headset to change its admin.
2. Connect a USB **data** cable and accept **Allow USB debugging** in the headset.
3. Start Beacon, then double-click **Connect Quest.cmd** or run `npm run quest`. The script checks the connected device is a Quest, forwards port 5173 and opens the local page.
4. In Quest Browser, face the chosen site-north direction and select **Enter AR**. Approve the browser's immersive-session permission. The skyline overlays passthrough; **Enter VR** uses a sky gradient and terrain silhouette.
5. Use the laptop's **Next waypoint**, **Trigger storm** and **Demo shelter jump** buttons. The controller trigger realigns site north to the current viewing direction. Exit immersive mode through the Quest system/browser controls.

If the connector script reports missing Android tools, get [Google's official Windows Platform Tools](https://developer.android.com/tools/releases/platform-tools) and extract `platform-tools` into `.local/`. This machine's tools were installed there during setup; they are not committed.

The equivalent manual connection is `adb reverse tcp:5173 tcp:5173`. Open `http://localhost:5173/apps/headset/` **inside the headset**. A plain laptop-IP HTTP address is not a secure WebXR origin. The USB-localhost workflow avoids needing a hosted site.

Sources: [Meta device setup](https://developers.meta.com/vr/documentation/android-apps/enable-developer-mode/), [Meta USB browser debugging](https://developers.meta.com/vr/documentation/web/browser-remote-debugging/), [Meta secondary-account limitation](https://communityforums.atmeta.com/discussions/PairingConnection/casting-issues-with-quest-3/1351835/replies/1351861).

## Implemented

- Desktop preview, capability-checked AR and VR session buttons.
- A 360° skyline ring, blocked-sky shading, upper-hemisphere open-sky percentage.
- Sun, Earth, base and shelter markers; manual north alignment.
- In-scene headset status panel: shelter time, Earth contact, oxygen and dose.
- Smooth skyline/marker transitions, red storm border and pulsing shelter marker.
- Shared socket client with reconnect, payload validation and stale-connection indication.
- Local demo relay, four fake waypoints and next/back/storm/panic/reset commands.
- Reduced, textured GLB terrain exporter, tested with synthetic rasters.

Optional `?standalone=1` runs the synthetic demo entirely in one browser and enables an automatic headset tour. This mode does not synchronize with other devices. `npm run build:standalone` creates the same standalone variant; it is not needed for the USB relay workflow. No hosted app was deployed.

## Team handoff and remaining work

See [shared/CONTRACT.md](shared/CONTRACT.md), [docs/CJ-START-HERE.md](docs/CJ-START-HERE.md), and [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

- Ronan must confirm/adapt the proposed state/waypoint contract, agree terrain product IDs, crop, CRS, parking spot and date, and provide the real relay/waypoints. `data/site.example.json` deliberately leaves these unset.
- The simulator in `tools/demo-relay.js` is **not the production relay or route planner**. Its panic command is a scripted jump to the fake shelter, not a computed emergency route. Oxygen/dose are fixed sample values.
- Real terrain has **not** been downloaded/cropped; exact agreed products and bounds are not available. The reduced mesh exporter is ready for them. It is a display exporter, not Ronan's scientific crop/skyline pipeline.
- NASA panorama candidate found, but its parking position and projection have **not** been matched. No panorama has been wrapped as an assumed full-sphere texture.
- Real-device AR passthrough, stereo HUD placement, performance and comfort still require a Quest session. Browser checks cannot certify those.
- This demo is not validated radiation guidance. The 19% / 10% figures have not been reproduced.

## Checks and build

```sh
npm test
npm run build
npm run preview
```

`preview` uses port 4173 and also includes the local demo relay. For a USB preview build, run `powershell -File tools/connect-quest.ps1 -Port 4173`.

Terrain tool (separate optional Python environment):

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r tools/requirements-terrain.txt
.venv/Scripts/python tests/terrain_check.py
.venv/Scripts/python tools/export-terrain.py --dtm data/raw/AGREED-DTM.IMG --image data/raw/AGREED-ORTHO.JP2 --bounds XMIN YMIN XMAX YMAX --output data/out/terrain.glb
```

Replace the placeholder filenames and bounds with the agreed values. The exporter reads georeferencing, requires matching projected metre CRSs, resamples both files to the same bounds, preserves missing-data holes, and outputs a GLB, PNG and provenance metadata. Default mesh: 129 × 129 vertices, at most 32,768 triangles; texture: 2048 × 2048. Engine calculations must use the full-resolution source.

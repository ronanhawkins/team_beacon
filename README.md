# Beacon

Beacon is a route planner for an astronaut's walk at Murray Buttes in Gale crater, built for the NASA Space Apps 2026 Martian Map challenge. A Rust engine computes a skyline (terrain elevation angle per compass direction) for points on real Mars terrain and derives open-sky fraction (radiation exposure), sunlight, and line of sight to base and Earth. A hub shows the map and route, a Quest 3 AR page shows the skyline as a ring around the wearer plus a helmet display, a phone page acts as a wristband, and an ESP32 acts as a panic button. A Node relay server holds one state object and broadcasts it to every device over WebSockets.

## Owners

| Area | Owner |
| --- | --- |
| `engine/`, `relay/`, `shared/` contracts, integration | Ronan |
| `apps/headset/`, `apps/quest/` | CJ |
| `apps/hub/` | Ronn |
| `apps/wrist/`, `firmware/` | Joel |

## Layout

| Folder | Purpose |
| --- | --- |
| `shared/` | Contracts and fake data everyone builds against |
| `data/` | Raw downloads (`raw/`, not committed) and engine exports (`out/`) |
| `tools/` | Small scripts |
| `engine/` | Rust crate: skyline and derived layers |
| `relay/` | Node relay: serves the pages and broadcasts state over WebSockets |
| `apps/` | Browser pages: `headset/`, `hub/`, `wrist/`; native Unity Quest app: `quest/` |
| `firmware/` | ESP32 panic button |
| `docs/` | Pitch, submission and sources (everyone) |

## Network

Everything runs on one laptop. The relay prints its addresses when it starts.

| Port | Protocol | Used by |
| --- | --- | --- |
| 8443 | HTTPS + WSS (`/ws`) | Pages and browser sockets: hub, headset, wrist, `/debug` |
| 8081 | plain WS | ESP32 panic button only |

Pages and browser sockets share port 8443, so the headset and phone accept one certificate warning.

Laptop address: `TODO` (fill in at the venue, then run `npm run cert -- <address>` in `relay/`)

## How to run

### Native Quest over USB

The current headset demos use Unity/OpenXR and installed Android apps. **Install Native Quest.cmd** opens **Beacon AR**, with room passthrough, the mission HUD and an emergency shelter request. The laptop relay is carried over USB on port 5174. Thumbsticks do not advance the mission; the presenter controls route progress. See [native setup and validation](apps/quest/README.md).

Inside Beacon AR, **left X** switches to the Murray Buttes 3D reference scene from NASA/JPL and Google Creative Lab's Access Mars project. **Left stick** walks continuously and **right stick** turns in VR; neither changes the mission route. X restores room passthrough. The scenery is for visual context; the ring still follows Ronan's waypoint data. See [sources, licence and alignment notes](apps/quest/Assets/Beacon/Art/AccessMars/README.md).

**Mirror Quest USB.cmd** shows the app on the laptop; HDMI can carry that window to the projector. Build the APK first using `tools/build-quest-native.ps1`.

### Local laptop rehearsal / Quest over Wi-Fi

Windows: **Start Laptop Demo.cmd** (or `npm run demo`) builds the headset and starts Ronan's relay on loopback port 5174. Open `http://127.0.0.1:5174/hub/` for controls and `http://127.0.0.1:5174/headset/?helmet=1` for the laptop helmet simulation. Drag or use arrow keys to look; Escape exits the helmet preview. Both screens share the same state. No developer account or headset is required for this rehearsal.

For Quest Browser on the same Wi-Fi, stop that launcher and run **Start WiFi Demo.cmd**. It prints the headset's HTTPS address and keeps the laptop hub on `http://127.0.0.1:5174/hub/`, sharing one relay. Accept the local certificate warning yourself in Quest Browser, then choose Enter AR. Developer Mode is needed only for the USB debugging route. This launcher uses the installed OpenSSL (or Git for Windows), keeps certificates ignored by Git, and never installs a root certificate. If Windows blocks the connection, allow this demo's TCP port 8443 from the local Wi-Fi network.

The terrain is real; the route, skyline and mission values are synthetic until the engine exports a matched waypoint file. The relay's `/session.json` supplies the exact loaded route to both apps; restart the relay after new engine exports. The laptop helmet simulation shows the same 3D HUD and alerts, but does not test passthrough or headset tracking.

### Team network setup

1. Engine: TODO
2. Relay (Node 22.12+ for the headset build, 18+ for the relay alone):
   ```sh
   npm ci && npm run build       # in the repo root: builds the headset into dist/
   cd relay
   npm install
   npm run cert -- <laptop IP>   # once per network; creates relay/certs/
   npm start                     # prints the URLs for each app
   npm test                      # optional smoke test, in a second terminal
   ```
   Open `https://<laptop IP>:8443/` on each device, accept the certificate warning once, and pick the page. `/debug` is the presenter control. The relay serves the built headset at `/headset/` and logs at startup whether it found a build; re-run `npm run build` after headset changes.
3. Hub: TODO
4. Headset (Quest 3): for the demo, build it (step 2) and open `https://<laptop IP>:8443/headset/` from the relay. For development, `npm ci`, then `npm run dev`, and open `http://localhost:5173/apps/headset/`. See [headset setup](apps/headset/README.md) and [USB checklist](docs/CJ-START-HERE.md).
5. Wrist (phone): TODO
6. Firmware (ESP32): TODO

The headset currently runs against the canonical generated files in `shared/fake/` with a local rehearsal relay. This is synthetic demo data, not the Mars terrain calculation. `npm test` checks the browser model and relay integration; `npm run build` produces the headset bundle. Ronan's production relay remains in `relay/`.

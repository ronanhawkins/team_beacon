# Beacon

Beacon is a route planner for an astronaut's walk at Murray Buttes in Gale crater, built for the NASA Space Apps 2026 Martian Map challenge. A Rust engine computes a skyline (terrain elevation angle per compass direction) for points on real Mars terrain and derives open-sky fraction (radiation exposure), sunlight, and line of sight to base and Earth. A hub shows the map and route, a Quest 3 AR page shows the skyline as a ring around the wearer plus a helmet display, a phone page acts as a wristband, and an ESP32 acts as a panic button. A Node relay server holds one state object and broadcasts it to every device over WebSockets.

## Owners

| Area | Owner |
| --- | --- |
| `engine/`, `relay/`, `shared/` contracts, integration | Ronan |
| `apps/headset/` | CJ |
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
| `apps/` | Browser pages: `headset/`, `hub/`, `wrist/` |
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

1. Engine: TODO
2. Relay (Node 18+):
   ```sh
   cd relay
   npm install
   npm run cert -- <laptop IP>   # once per network; creates relay/certs/
   npm start                     # prints the URLs for each app
   npm test                      # optional smoke test, in a second terminal
   ```
   Open `https://<laptop IP>:8443/` on each device, accept the certificate warning once, and pick the page. `/debug` is the presenter control.
3. Hub: TODO
4. Headset (Quest 3): TODO
5. Wrist (phone): TODO
6. Firmware (ESP32): TODO

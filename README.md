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

Laptop address: `TODO`

- Secure port (HTTPS + WSS): `TODO`. The relay serves the `apps/` pages and the browser WebSocket on this one port, so the headset and phone accept a single certificate warning.
- Plain port (WS): `TODO`. For the ESP32 only.

## How to run

1. Engine: TODO
2. Relay: TODO
3. Hub: TODO
4. Headset (Quest 3): `npm ci`, then `npm run dev`. Open `http://localhost:5173/apps/headset/`. See [headset setup](apps/headset/README.md) and [USB checklist](docs/CJ-START-HERE.md).
5. Wrist (phone): TODO
6. Firmware (ESP32): TODO

The headset currently runs against the canonical generated files in `shared/fake/` with a local rehearsal relay. This is synthetic demo data, not the Mars terrain calculation. `npm test` checks the browser model and relay integration; `npm run build` produces the headset bundle. Ronan's production relay remains in `relay/`.

# relay

**Owner:** Ronan

Node server that holds the one state object (`shared/state.md`), applies events from the devices (`shared/events.md`), and broadcasts the state to every client. It also serves the pages.

## Ports

| Port | Protocol | Paths |
| --- | --- | --- |
| 8443 | HTTPS + WSS | `/hub/`, `/headset/`, `/wrist/`, `/shared/`, `/data/` (= `data/out/`), `/data/site.json` (the only file served from outside `data/out/`), `/debug`, `/clients`, and the WebSocket at `/ws` (also `/relay`) |
| 8081 | plain WS | Any path. For the ESP32, which can't easily do TLS. Same protocol. |

The pages and the browser socket share port 8443, so each device accepts one certificate warning and the socket can't fail silently on a second untrusted certificate. Every response has `Cache-Control: no-store`.

`/relay` is an alias for `/ws`, with the same protocol. It is kept for the headset client (`shared/socket.js`), which connects to `/relay`.

`/headset/` serves the Vite build in `dist/apps/headset/` when it exists (run `npm run build` in the repo root), with its bundles at `/assets/` from `dist/assets/`. Without a build it serves `apps/headset/` as is, which won't run in a browser because the source needs Vite. The relay logs which one it serves at startup. Override the ports with `HTTPS_PORT` and `PLAIN_PORT` if you need to.

## Run

For laptop-only rehearsal, run `npm run demo` from the repo root. `node relay/server.js --local` uses HTTP + WS on **127.0.0.1:5174 only**, with the same state logic and static mounts. No certificate or ESP port is used. Override `LOCAL_PORT` if needed. The headset must already be built.

For Quest over Wi-Fi, Windows users can run `Start WiFi Demo.cmd` from the root. `node relay/server.js --wifi` serves HTTPS on 8443 and a loopback HTTP mirror on 5174, both sharing the same state and clients. It requires certificates, opens the ESP port (8081, on `RELAY_HOST` when set), and checks browser WebSocket origins. `RELAY_HOST` optionally binds HTTPS to one network address. The Windows launcher sets it to the Wi-Fi address. Default `npm start` retains the original HTTPS + ESP setup.

`/session.json` returns `{version:1, waypoints:"/mission/waypoints.json", synthetic:boolean, files:"/mission/", planId, plannerBounds, capabilities:{commandReplies, stormStop, plan}}`. That waypoint endpoint serves the exact in-memory route, so browser clients agree with relay state even with `WAYPOINTS` overrides or newly written disk exports. Restart the relay to adopt a new export.

### Planning

The hub's Plan screen sends a `plan` event (`shared/events.md`). The relay checks the points against the site's `plannerBounds`, then runs `engine/target/release/engine [--site <name>] plan --stops ... --out .local/plans/<site>/<id>/` in the background (build it once with `cd engine && cargo build --release`; a plan takes 1 to 5 seconds). Progress and errors go out in `state.plan` (`shared/state.md`). On success the new route replaces the old one, the walk starts again at its first waypoint, and `planId` in `/session.json` changes.

- `/mission/<file>` serves the route's other files: from the latest plan's folder first (`briefing.json`, `stops.json`, `shelters.json`, `layers/minutesToShelter.png`), else from the site's `data/out` (terrain, the other layers, photos).
- The last three plan folders are kept; `.local/` is ignored by git.

### Sites

The relay starts on Gale, or on `--site <name>`, and can switch while it runs: the hub's planet view sends
`{ type: "site", name }` (`shared/events.md`). `/sites.json` returns `{ version: 1, current, sites: [{ id, name,
description, lat, lon }] }` for Gale (`"gale"`) and every `data/sites/<name>/` that has `data/out/<name>/waypoints.json`.
lat and lon are degrees: Gale's parking spot, else the centre of the site's 3 km crop. State carries `site`, and the
hub, wrist page and web headset reload when it changes. The Quest app checks the relay's site file against its
built-in terrain and turns off the base marker and photos when they differ.
- `BEACON_ENGINE` points at another engine binary and `BEACON_PLANS` at another plans folder (the tests use both).
- The browser headset fetches the new route when `state.plan.routeId` changes. The Quest app reads the route once at start, so restart it after a new plan.

```sh
npm install
npm run cert -- 192.168.1.20   # laptop's IP on the venue network; localhost always included
npm start
npm test                       # in a second terminal: hello, next, storm on, next, storm off, reset
```

On start the relay prints the waypoint file it loaded and the URL of each app for every IPv4 address of the laptop. Re-run `npm run cert` when the laptop's address changes.

- Waypoints: `data/out/waypoints.json` if it exists, otherwise `shared/fake/waypoints.json`. Override with `WAYPOINTS=path/to/file.json npm start`.
- `earthDelayMinutes`: `data/site.json` field `earthDelayMinutes` if present, otherwise 14.

### Site

With no site set the relay serves Gale exactly as before: `data/site.json`, `data/out/waypoints.json` (or the fake route), and `data/out/` as `/data/`.
`SITE=<name> node relay/server.js` (or `--site <name>`) serves `data/sites/<name>/site.json` at `/data/site.json`, `data/out/<name>/waypoints.json`, and
`data/out/<name>/` as `/data/`, so the apps keep the same URLs. A named site has no fake fallback; `WAYPOINTS` still overrides the route.
The site is logged at startup and sent as the optional `site` field in the state (`shared/state.md`).
- Warning limit for `minutesToShelter`: `WARNING_MINUTES_TO_SHELTER` at the top of `server.js`.

## Files

- `server.js`: HTTPS static server, WSS and WS endpoints, state logic, broadcast, 15 s ping
- `debug.html`: served at `/debug`. Live state, connected clients, a button per event. Presenter control until the hub has its own.
- `make-cert.sh`: self-signed certificate into `certs/` (not committed)
- `test-client.js`: smoke test over the plain port

Browser apps use `shared/client.js`:

```js
import { connect } from '/shared/client.js';
const relay = connect({ role: 'wrist', onState: (s) => render(s) });
relay.send({ type: 'requestReroute' });
```

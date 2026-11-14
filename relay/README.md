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

```sh
npm install
npm run cert -- 192.168.1.20   # laptop's IP on the venue network; localhost always included
npm start
npm test                       # in a second terminal: hello, next, storm on, next, storm off, reset
```

On start the relay prints the waypoint file it loaded and the URL of each app for every IPv4 address of the laptop. Re-run `npm run cert` when the laptop's address changes.

- Waypoints: `data/out/waypoints.json` if it exists, otherwise `shared/fake/waypoints.json`. Override with `WAYPOINTS=path/to/file.json npm start`.
- `earthDelayMinutes`: `data/site.json` field `earthDelayMinutes` if present, otherwise 14.
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

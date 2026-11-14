# apps/hub

**Owner:** Ronn

Hub page: the control-centre screen. Shows the 3D map of Murray Buttes on the real terrain and
image from `data/out/terrain/`, the engine's layers, the planned route, the briefing, the
astronaut's live status, mirrors of the helmet ring and the wristband, the storm and panic state,
and the presenter controls. It also shows which devices are connected, from the relay's `/clients`.

Plain ES modules, no build step and no libraries, so it runs offline on the hotspot.

## Run

Start the relay (see `relay/README.md`) and open `https://<laptop>:8443/hub/`.

Laptop/USB rehearsal: `npm run demo` at the repository root, then `http://127.0.0.1:5174/hub/`. Quest Wi-Fi rehearsal: `Start WiFi Demo.cmd` keeps those laptop controls and adds HTTPS for the headset, with one shared state. The hub discovers `/session.json` and uses the relay's exact loaded route, including custom `WAYPOINTS` files. Restart the relay after exports. `?fake=1` deliberately runs locally so its synthetic route cannot be driven by a different live mission.

Without the relay, serve the repo root with any static server and the hub runs by itself in local
mode (other devices do not follow it):

```sh
python3 -m http.server 8080      # in the repo root, then open http://localhost:8080/apps/hub/
```

## What is real and what is fake

The hub uses each engine export when it exists and the fake otherwise, the same rule the relay
uses for waypoints. The header says which is which.

| Data | Real file | Until it exists |
|---|---|---|
| Terrain and image | `data/out/terrain/` (in the repo now) | fake terrain with the fake route, else a flat map |
| Route | `data/out/waypoints.json` | `shared/fake/waypoints.json` |
| Layers | `data/out/layers/meta.json` | none over real terrain; `shared/fake/layers/` with fake terrain |

So today the hub shows the real 3 km Murray Buttes crop with the **fake route**, whose coordinates
mean nothing on Mars. The view opens on the terrain's parking spot and moves to the route when the
walk starts. The fake layers describe the fake butte, so they are not laid over the real terrain.
Add `?fake=1` to the address to see the whole fake scene, layers included.

When the engine writes `data/out/waypoints.json` and `data/out/layers/`, the hub picks them up
with no code change.

## Files

- `index.html`: page entry
- `main.js`: relay connection, app setup and the panels
- `map.js`: terrain map and layer display (WebGL)
- `route.js`: reads the waypoint file and the relay state into the route the hub draws
- `relay.js`: uses `shared/client.js`; lists the events the hub sends
- `local.js`: stand-in for the relay when it is not there (copies the state logic of `relay/server.js`)
- `overlay.js`: route, stops, shelters and astronaut drawn over the map
- `ring.js`: flat mirror of the helmet's skyline ring
- `terrain.js`: loads `terrain.json` and the height grid; height sampling
- `config.js`: file locations, layer colours, astronaut name, stop notes. **Edit this, not the code.**
- `style.css`: page styles
- `dev/`: fake terrain built from `tools/fake_scene.py` (`python3 apps/hub/dev/make_fake_terrain.py`)

## Keys

| Key | Action | Key | Action |
|---|---|---|---|
| → or Space | `next` | 1 to 6 | Toggle map layers |
| ← | `back` | F / T | Route view / top view |
| N or Shift+→ | `goto` the next science stop | G | Follow the astronaut |
| S | `storm` on, then off | M | Sound on or off |
| P | `panic` | H | Hide presenter controls |
| R twice | `reset` | Esc | Stop placing, unselect |

Map: drag to rotate, Shift-drag or right-drag to move, scroll to zoom.

## How it follows `shared/` and `data/out/terrain/`

- **State** (`state.md`): `mode` drives the banner (`storm` red, `warning` amber, `nominal` plain).
  The wrist mirror's arrow is drawn at `shelterBearingDeg - headingDeg`.
- **Events** (`events.md`): sends `next`, `back`, `goto`, `storm`, `reset` through `shared/client.js`.
- **Waypoints** (`waypoints.md`): `main` is the route, `reroutes["N"]` is drawn when `route` is
  `"reroute"`. Science stops and shelters come from `isScienceStop` and `isShelter`.
- **Layers** (`layers.md`): reads `meta.json` and maps pixels through each layer's `min` and `max`.
- **Grid cells** (`conventions.md`): values belong to cell centres, for layers and heights alike.
- **Terrain**: reads `terrain.json` (`heightGrid`, `textures.hub`, `parking`) and `height_750.bin`
  as described in `data/out/terrain/README.md`. It does not use `shared/terrain.js`, which needs
  Three.js; the hub has no dependencies.

## Questions for Ronan

1. **Which reroute — resolved.** The state now carries `rerouteFrom`. The hub uses this explicit identifier before its compatibility fallback for old relays, including after a reconnect.
2. **Panic from the hub — resolved.** The current `events.md` includes hub as a panic sender.
3. **Planner link.** No event carries the start, stops and end to the planner. The hub sends a
   proposed `{ "type": "plan", "points": [{ "x", "y", "kind": "start" | "stop" | "end" }] }`
   (ignored as an unknown event), offers the same as copyable JSON, and has "Reload route" to
   re-read the waypoint file after the engine exports.
4. **Site file — available.** The relay now serves `/data/site.json` explicitly. The hub still works out the base position from the waypoints' `base.az` and `base.distance`, and takes the astronaut's name and start time from `config.js`.
5. **Science tasks and arrival photos** per stop live in the hub's `config.js` for now.

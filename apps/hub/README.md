# apps/hub

**Owner:** Ronn

Hub page: the control-centre screen. Shows the 3D map of Murray Buttes on the real terrain and
image from `data/out/terrain/`, the engine's layers, the planned route, the briefing, the
astronaut's live status, mirrors of the helmet ring and the wristband, the storm and panic state,
and the presenter controls. It also shows which devices are connected, from the relay's `/clients`.

Three screens, switched in the header: **Plan** (place stops, send to the planner), **Live** (the walk,
with heart rate and wristband battery) and **Crew** (who is fit for the planned walk, each astronaut's
profile, and the route history drawn on the map).

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

| Heart rate, SpO2, skin temperature, wristband battery | `heartRateBpm`, `spo2Fraction`, `skinTempC`, `wristBatteryFraction` in the relay state (proposed, question 6) | simulated values, labelled "simulated" (`VITALS.simulate` in `config.js`) |
| CO2, cooling and drinking water, suit temperature, suit battery, metabolic rate | none: a model in `vitals.js` driven by heart rate | always modelled, labelled "Modelled" |
| Rover track in the route history | `data/site.json` `routeNearButtes` (Curiosity, sols 1446 to 1471) | not shown |
| Crew and their past walks | none: sample people in `crew-data.js` | each past walk's path, distance, time and dose are worked out from the route above |

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
- `crew-data.js`: the sample crew, their condition and which walks they did. **Edit this to change the people.**
- `crew.js`: walk log, weekly totals and the readiness check (no drawing)
- `vitals.js`: astronaut status: every tracked value, its alert limits, the suit model and the safety margin
- `config.js`: file locations, layer colours, stop notes, alarm length, vitals alerts, readiness limits. **Edit this, not the code.**
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
| C | Crew screen and back | V | Astronaut status details |
| L | Simulated cooling leak on or off | | |

Map: drag to rotate, Shift-drag or right-drag to move, scroll to zoom.

## Alarm, vitals, crew and history

- **Alarm.** A storm or panic repeats its beeps for `ALARM.seconds` (20) or until the emergency ends.
  "Silence alarm" in the banner or M stops it. Panic beeps are higher and faster than storm beeps.
- **Astronaut status.** A card in the astronaut panel shows the worst problem in words, heart rate,
  SpO2, skin temperature, the safety margin and the wrist link. Click it (or V) for the detail view over
  the map: every tracked value by group (body, life support, exposure, wristband) with its trend, its
  alert limit and where it comes from (Wrist, Engine, Modelled or Simulated).
- **Safety margin.** How long the scarcest supply (oxygen, cooling water, drinking water, suit battery)
  lasts at the current effort, minus the walk to shelter. Below `VITALS.turnBackMin` the banner says
  TURN BACK NOW. Effort comes from heart rate, so a hard climb shortens the margin.
- **Cooling leak (L).** A demo fault: the cooling water drains, the margin collapses and the suit
  warms up, so the turn-back alert can be shown on stage. The detail view has the same switch.
- **Alerts.** Any value past its limit raises a caution banner and a log line. All limits are in
  `VITALS` in `config.js`; they are demo assumptions, not medical or suit specifications.
- **Readiness.** Each astronaut gets Fit, Marginal or Not fit for the route on the map, from their
  condition, rest since the last walk, and weekly dose and walk time including this walk. The limits are
  `CREW_LIMITS` in `config.js`; they are demo assumptions, not medical limits. The assigned astronaut's
  verdict also shows under the briefing.
- **Route history.** Lists past walks for one astronaut or everyone, plus Curiosity's real track. Picking
  one draws it on the map; "Use as plan" loads it into Plan mode. Walks done on this hub are recorded
  (with average and peak heart rate) in the browser's storage on this laptop.

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
6. **Wrist readings.** Not in `state.md` yet. The hub reads four proposed state fields and simulates
   them until the wrist sends them and the relay adds them to the state:
   `heartRateBpm` (number), `spo2Fraction` (0 to 1), `skinTempC` (degrees Celsius) and
   `wristBatteryFraction` (0 to 1). Any the wrist module cannot measure can be left out. The hub works
   out the wrist link's age from when the values last changed. Different names are a one-line change in `route.js`.

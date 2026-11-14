# apps/headset

**Owner:** CJ

Quest 3 AR page. Shows the skyline as a ring around the wearer plus a helmet display.

## Run

From the repo root: `npm ci`, then `npm run dev`. Open `http://localhost:5173/apps/headset/`.
Windows shortcuts: `Start Beacon.cmd`, then `Connect Quest.cmd` after Developer Mode and USB debugging are enabled. See `docs/CJ-START-HERE.md`.

AR needs **no terrain downloads**. It reads `shared/fake/waypoints.json` and the local rehearsal relay reads `shared/fake/state.json`. Both use Ronan's shared v1 contracts directly. The optional VR button currently renders the skyline silhouette, not the terrain mesh.

`npm test` checks shared fixtures, fractions, wrapping, reroutes/reconnects, terrain orientation and two-screen relay synchronisation. `npm run build` writes the headset bundle to `dist/`.

## Connect the engine and relay

Once Ronan exports `data/out/waypoints.json`, open:

```text
/apps/headset/?waypoints=/data/out/waypoints.json&relay=ws%3A%2F%2Flocalhost%3A8080%2Frelay
```

Replace the example relay port/path with Ronan's actual endpoint. Vite serves `data/out/` while developing. If serving `dist/` elsewhere, also serve the exported waypoint file at that URL. For USB, forward every relay port as well as page port 5173. HTTPS pages require WSS.

The client sends `{type:"hello", role:"headset", version:1}` on each connection and accepts `{type:"state", state:{...}}` without requiring sequence/timestamp fields. Live mode exposes `requestReroute` only; presenter next/back/storm/reset controls belong to the hub. Unknown additive fields are ignored. External files without provenance are labelled EXTERNAL DATA, never automatically labelled NASA-validated.

## Reroute snapshot integration gap

The v1 state identifies `route:"reroute"` and `waypointIndex` but omits the starting main index. **Suggested additive field for Ronan: `rerouteFromIndex`** (main index used to select `reroutes[String(index)]`). The rehearsal relay already includes this extra field.

For the unchanged v1 examples, the headset uses the main index observed on the current connection, or an exact unique match between snapshot fields and a reroute waypoint. This loads `state-storm.json` correctly even on first connect. If a reconnect is ambiguous, telemetry stays visible but spatial markers and the skyline are hidden, with a warning. It never assumes reroute 0. Connection history is cleared on reconnect. A full route identifier is still needed for unambiguous future live telemetry. Ronan's contract markdown and generators are unchanged.

## Display conventions

- Fractions stay 0–1 on the wire. Oxygen and dose budget are converted to percentages only for display. There is no invented µSv conversion.
- Base contact and Earth contact are separate. Earth includes the one-way signal delay.
- Relay mode drives nominal/warning/storm appearance; panic also triggers the alert. The rehearsal relay warns on lost base contact only because a shelter-time warning threshold is not yet agreed.
- Sun/Earth marker elevations and visibility come from waypoints. Base and shelter only provide bearings, so those markers are explicitly labelled BEARING and drawn at level; this is not an estimated terrain elevation.
- The headset is manually aligned to site north. Controller trigger realigns it. Skyline blending lasts about 0.9 seconds; telemetry updates immediately.
- A closed connection retains values with an offline warning. No heartbeat protocol is defined yet, so a silent open connection has no freshness watchdog.

## Optional local tour

`?standalone=1` runs the same fixture-only rehearsal in one browser, with no synchronisation to other devices. This is explicit opt-in, not a fallback from a failed relay. No hosting is required.

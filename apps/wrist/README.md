# apps/wrist

**Owner:** Joel

Phone page worn landscape on the astronaut's forearm. Left (the smaller part): a north-up map that follows your position, with
the route (walked part solid, the rest dashed), science stops, shelters and base; during a reroute the way to
shelter is amber, or red in a storm or SOS. + and − zoom. Right: the status, the next target with a walk-progress
track, and two actions. Readings (dose, oxygen) stay in the headset.

The map is drawn, not photographed: contour lines every 2 m (brighter every 10 m) generated from the terrain's
height grid (`/data/terrain/`, loaded with the hub's `apps/hub/terrain.js`) over the area around the route, on a
faint grid. The route comes from the relay (`/session.json`, read with the hub's `apps/hub/route.js`). A synthetic
route gets only the grid, since its coordinates are not on the terrain. When the hub plans a new route (`state.plan.routeId`) the page fetches it again.

On a phone, "Tap for full screen, landscape" locks the orientation where the browser allows; held upright the
page stacks the map above the controls.

| Action | Event (`shared/events.md`) | How |
|---|---|---|
| Go to shelter | `{ "type": "requestReroute" }` | hold 0.9 s |
| SOS | `{ "type": "panic" }` | hold 1.5 s |
| Add a waypoint | `{ "type": "plan", ... }` | Waypoint on the map, tap to place, hold 0.7 s |

**Adding a waypoint.** "Waypoint" on the map drops a pin; tap the map to move it. The dashed white lines show
where it joins the walk: the rest of the walk (where you are, the stops still ahead, the end) takes it at the
place that adds the least distance. The pin turns amber outside the planned area (dashed outline), where the
planner has no shelters. Holding "Add to route" sends the whole list as a `plan` event, the same one the hub's
planner sends; the relay replans from your position and every screen gets the new route, with the new stop named
"Waypoint N". Not available during a storm, an SOS, a reroute, or while base is planning.

Both need a press and hold, with a fill that shows the time left, so a gloved tap cannot reroute or raise an
alarm by accident. The phone vibrates when an action is sent, and the screen is kept on where the browser allows.

The status shows the relay state in words: On route, Stay alert (`mode` warning), To shelter / In shelter
(`route` reroute; in shelter when `minutesToShelter` is 0), Take shelter (storm), SOS sent (panic) and No link.
Blue is normal, amber a caution or reroute, red only a storm or SOS. Only base (the hub's Reset or End storm)
returns the astronaut to the walk.

The ESP panic button sends the same `panic` event, so it works alongside this page with no change here.

## Run

Through the relay: `npm run demo` at the repository root, then `http://127.0.0.1:5174/wrist/` (or
`https://<laptop>:8443/wrist/` on Wi-Fi). It connects with role `wrist`, so the hub shows it as connected.

- `index.html`: page entry
- `main.js`: relay connection, status and the hold-to-confirm actions
- `style.css`: page styles

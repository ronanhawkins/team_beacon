# Events

Devices send events to the relay. The relay updates the state and broadcasts it (see `state.md`). No device writes state directly.

Every message is one JSON object with a `type` field.

## Device to relay

| Event | Sent by | Effect |
|---|---|---|
| `{ "type": "hello", "role": "headset" }` | any device on connect | Relay records the role and replies with the full state. Roles: `hub`, `headset`, `wrist`, `esp`, `debug` |
| `{ "type": "next" }` | hub, native headset | Advance one waypoint on the current route |
| `{ "type": "back" }` | hub, native headset | Go back one waypoint |
| `{ "type": "goto", "index": 3 }` | hub | Jump to a waypoint on the current route |
| `{ "type": "storm", "on": true }` | hub, native headset | Start or end the solar storm. Starting it switches to the reroute |
| `{ "type": "panic" }` | esp, wrist, hub | Set panic and switch to the reroute |
| `{ "type": "requestReroute" }` | wrist, headset, esp | Astronaut asks for a reroute. Switches to the reroute |
| `{ "type": "site", "name": "jezero" }` | hub (planet view) | Switches the site the relay serves (`"gale"` or a `data/sites/<name>/` with a waypoint file): its site file, `/data/`, example route and planning folder. The walk starts again at the new site's example route; storm, SOS and any planned route are cleared. Ignored for an unknown name or the site already in use. `/sites.json` lists the sites |
| `{ "type": "cancelReroute" }` | wrist, esp, hub | Turns off both SOS (`panic`) and the reroute request, and goes back to the main route where the reroute began. During a solar storm the shelter route stays; only base ends a storm. Ignored when neither is on |
| `{ "type": "reset" }` | hub, native headset | Back to waypoint 0 on the main route, all flags cleared. With `"example": true`, also puts back the site's example route if a plan replaced it (hub "Start example route", Quest A) |

## Relay to devices

### Optional native walking guards

Native VR can attach `"expected": { "route": "main", "waypointIndex": 3, "rerouteFrom": null }` to an event. The relay ignores the entire event if those three values no longer match. This makes repeated arrival messages harmless and prevents an in-flight main-route step from skipping a newly activated emergency waypoint. Existing clients can omit this field.

Storm start/stop commands are the exception to the index comparison: they accept an intervening walking acknowledgement on the same route, but still require matching `route` and `rerouteFrom`. This prevents a B press or hold during movement from being discarded solely because a route sample advanced.

`requestReroute` can also carry `"atIndex": 3`. On the main route, this selects the nearest exported main waypoint to the VR wearer's position before requesting its existing engine-provided diversion. The relay accepts only an integer main index with an exported reroute. It does not calculate a new path. The native app sends both `atIndex` and `expected`; other clients retain the existing request format.

`storm` with `on: true` accepts the same optional `atIndex` on the main route. The native B button uses it to start the storm diversion near the wearer's VR position. Once on a diversion, B omits `atIndex` and preserves that route's progress.

### Optional command acknowledgement

An event may include a nonempty string `requestId` of at most 80 characters. For a valid event, the requesting connection receives `{ "type": "state", "state": { ... }, "replyTo": "<requestId>" }`, including when the state did not change. Other clients receive ordinary state broadcasts. Invalid events remain ignored. Native A/B waits for its matching reply before reporting success; A repositions the VR wearer only after the acknowledged reset state arrives. Requests time out after five seconds, and reset supersedes an outstanding storm request.

The local `/session.json` advertises `capabilities.commandReplies: true` and `capabilities.stormStop: true`; the native launcher uses these to replace an older local relay before starting the headset app. Holding B sends `storm` with `on: false`, using the same acknowledgement protocol. This clears the storm while preserving any independent panic or requested diversion; it does not issue a reset.

| Message | When |
|---|---|
| `{ "type": "state", "state": { ... } }` | On every change, and to each device when it connects |

## Planning (addition)

| Event | Sent by | Effect |
|---|---|---|
| `{ "type": "plan", "points": [ { "x": 0, "y": 0, "kind": "start" }, { "x": 0, "y": 0, "kind": "stop", "name": "Quela drill site" }, { "x": 0, "y": 0, "kind": "end" } ] }` | hub, wrist | Plan a new route through these points |

- `points`: the start, the science stops in order, then the end, in local metres; 2 to 14 points, all inside the site's `plannerBounds`. `name` is optional and only used for stops.
- The relay runs `engine plan --stops ... --out <folder>` in the background and reports progress in `state.plan` (`state.md`). When it succeeds the new route replaces the old one for every client and the walk starts again at its first waypoint. When it fails the old route stays.
- Refused during a storm, a panic, a reroute, or while another plan is being made. Sent mid-walk, the new route starts where the astronaut is.
- Clients that do not plan can ignore it. `/session.json` advertises `capabilities.plan: true` on relays that handle it.

## Rules

- Unknown event types are ignored, not errors.
- Clients reconnect automatically and send `hello` again.
- Browsers use the secure socket on the same address and port as the pages. The ESP uses the plain socket port.

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
| `{ "type": "storm", "on": true }` | hub | Start or end the solar storm. Starting it switches to the reroute |
| `{ "type": "panic" }` | esp, wrist, hub | Set panic and switch to the reroute |
| `{ "type": "requestReroute" }` | wrist, headset | Astronaut asks for a reroute. Switches to the reroute |
| `{ "type": "reset" }` | hub | Back to waypoint 0 on the main route, all flags cleared |

## Relay to devices

### Optional native walking guards

Native VR can attach `"expected": { "route": "main", "waypointIndex": 3, "rerouteFrom": null }` to an event. The relay ignores the entire event if those three values no longer match. This makes repeated arrival messages harmless and prevents an in-flight main-route step from skipping a newly activated emergency waypoint. Existing clients can omit this field.

`requestReroute` can also carry `"atIndex": 3`. On the main route, this selects the nearest exported main waypoint to the VR wearer's position before requesting its existing engine-provided diversion. The relay accepts only an integer main index with an exported reroute. It does not calculate a new path. The native app sends both `atIndex` and `expected`; other clients retain the existing request format.

| Message | When |
|---|---|
| `{ "type": "state", "state": { ... } }` | On every change, and to each device when it connects |

## Reserved

Proposed, not implemented. The relay ignores these like any unknown event.

| Event | Proposed by | Intended effect |
|---|---|---|
| `{ "type": "plan", "points": [ { "x": 0, "y": 0, "kind": "start" } ] }` | hub | Send the start, stops and end (`kind`: `"start"`, `"stop"` or `"end"`, positions in local metres) to the route planner |

## Rules

- Unknown event types are ignored, not errors.
- Clients reconnect automatically and send `hello` again.
- Browsers use the secure socket on the same address and port as the pages. The ESP uses the plain socket port.

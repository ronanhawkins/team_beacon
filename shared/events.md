# Events

Devices send events to the relay. The relay updates the state and broadcasts it (see `state.md`). No device writes state directly.

Every message is one JSON object with a `type` field.

## Device to relay

| Event | Sent by | Effect |
|---|---|---|
| `{ "type": "hello", "role": "headset" }` | any device on connect | Relay records the role and replies with the full state. Roles: `hub`, `headset`, `wrist`, `esp`, `debug` |
| `{ "type": "next" }` | hub | Advance one waypoint on the current route |
| `{ "type": "back" }` | hub | Go back one waypoint |
| `{ "type": "goto", "index": 3 }` | hub | Jump to a waypoint on the current route |
| `{ "type": "storm", "on": true }` | hub | Start or end the solar storm. Starting it switches to the reroute |
| `{ "type": "panic" }` | esp, wrist, hub | Set panic and switch to the reroute |
| `{ "type": "requestReroute" }` | wrist, headset | Astronaut asks for a reroute. Switches to the reroute |
| `{ "type": "reset" }` | hub | Back to waypoint 0 on the main route, all flags cleared |

## Relay to devices

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
- Clients that do not plan can ignore it.

## Rules

- Unknown event types are ignored, not errors.
- Clients reconnect automatically and send `hello` again.
- Browsers use the secure socket on the same address and port as the pages. The ESP uses the plain socket port.

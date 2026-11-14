# State object

The relay holds one state object. It broadcasts the whole object to every device whenever anything changes, and sends it in full to any device that connects or reconnects.

Devices never write state. They send events (see `events.md`) and the relay updates the state.

The relay fills in the derived fields from the waypoint file, so a client that only shows numbers (the wristband, the ESP) never needs to load waypoints.

Units and angle conventions are in `conventions.md`.

## Message

```json
{ "type": "state", "state": { "...fields below..." } }
```

## Fields

| Field | Type | Values | Set from |
|---|---|---|---|
| `version` | number | 1 | relay |
| `route` | string | `"main"` or `"reroute"` | relay, on storm, panic or reroute request |
| `waypointIndex` | number | index into the current route | `next`, `back`, `goto` events |
| `rerouteFrom` | number or null | the `main` index the current reroute started from, so `reroutes[rerouteFrom]` is the route in use. `null` on the main route | relay, when it switches to the reroute |
| `mode` | string | `"nominal"`, `"warning"` or `"storm"` | relay. Drives the colours on every screen |
| `storm` | boolean | | `storm` event |
| `panic` | boolean | | `panic` event |
| `rerouteRequested` | boolean | | `requestReroute` event |
| `headingDeg` | number | azimuth of travel | current waypoint |
| `shelterBearingDeg` | number | azimuth to the nearest shelter | current waypoint |
| `minutesToShelter` | number | minutes | current waypoint |
| `openSky` | number | 0 to 1 | current waypoint |
| `doseFraction` | number | 0 to 1, counts up | current waypoint |
| `oxygenFraction` | number | 0 to 1, counts down | current waypoint |
| `sunlit` | boolean | | current waypoint |
| `baseLink` | boolean | line of sight to base | current waypoint |
| `earthLink` | boolean | line of sight to Earth | current waypoint |
| `earthDelayMinutes` | number | one-way signal delay | site file |

Optional, present when the waypoint file has them (the engine writes them when it has the measured Curiosity RAD dose rate). Clients that do not use them can ignore them:

- `doseMicroGray` (number): dose so far in microgray, counts up. From the current waypoint.
- `doseRateMicroGrayPerHour` (number): dose rate at this point now, microgray per hour; rises once a storm has arrived. From the current waypoint.

Addition, optional: present only when the relay was started for a named site (`SITE=<name>` or `--site <name>`, see `relay/README.md`). Absent for the default site, Gale. Clients that do not use it can ignore it:

- `site` (string): the site name, the `<name>` in `data/sites/<name>/`.

## Mode rules

- `storm` when `storm` or `panic` is true.
- `warning` when `baseLink` is false, or `minutesToShelter` is above the agreed limit.
- `nominal` otherwise.

## Arrow direction

A screen that shows an arrow to shelter draws it at `shelterBearingDeg - headingDeg`, so 0 means straight ahead.

## Example

```json
{
  "version": 1,
  "route": "main",
  "waypointIndex": 3,
  "rerouteFrom": null,
  "mode": "nominal",
  "storm": false,
  "panic": false,
  "rerouteRequested": false,
  "headingDeg": 135,
  "shelterBearingDeg": 180,
  "minutesToShelter": 2.0,
  "openSky": 0.88,
  "doseFraction": 0.07,
  "oxygenFraction": 0.93,
  "sunlit": true,
  "baseLink": true,
  "earthLink": true,
  "earthDelayMinutes": 14
}
```

# Waypoint file

The engine exports the route as `data/out/waypoints.json`. The headset reads it for the skylines. The relay reads it to fill in the state.

Units, angle conventions and the position frame are in `conventions.md`.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `version` | number | 1 |
| `skylineSamples` | number | Length of every `skyline` array. 72 |
| `main` | array of waypoints | The planned walk, in order |
| `reroutes` | object | Maps a `main` waypoint index (as a string) to the array of waypoints from there to the nearest shelter |

```json
{
  "version": 1,
  "skylineSamples": 72,
  "main": [ { "...waypoint..." } ],
  "reroutes": {
    "3": [ { "...waypoint..." } ]
  }
}
```

When a storm, panic or reroute request arrives at `main` index N, the relay switches `route` to `"reroute"` and walks `reroutes["N"]` from index 0.

## Waypoint

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique. `m03` for main, `r03-02` for a reroute point |
| `label` | string | Short name for display. May be empty |
| `pos` | `{x, y, z}` | Local frame, metres |
| `headingDeg` | number | Azimuth of travel towards the next waypoint |
| `skyline` | array of 72 numbers | Terrain elevation angle per 5 degrees of azimuth, starting north, clockwise |
| `openSky` | number | 0 to 1 |
| `sun` | `{az, el, visible}` | Direction of the Sun and whether it clears the skyline |
| `earth` | `{az, el, visible}` | Direction of Earth and whether it clears the skyline |
| `base` | `{az, distance, visible}` | Direction and distance to base, and whether there is line of sight |
| `shelter` | `{az, distance, minutes}` | Nearest shelter: direction, path distance and walking time |
| `minutesFromStart` | number | Walking time from the start of the route |
| `doseFraction` | number | 0 to 1, counts up |
| `oxygenFraction` | number | 0 to 1, counts down |
| `isShelter` | boolean | This point is a shelter |
| `isScienceStop` | boolean | This point is a science stop |

## Example waypoint

```json
{
  "id": "m03",
  "label": "Open plain",
  "pos": { "x": 412.0, "y": 268.0, "z": -4431.2 },
  "headingDeg": 135,
  "skyline": [1.2, 1.4, 1.3],
  "openSky": 0.88,
  "sun":   { "az": 250, "el": 22, "visible": true },
  "earth": { "az": 262, "el": 15, "visible": true },
  "base":  { "az": 20, "distance": 310, "visible": true },
  "shelter": { "az": 180, "distance": 60, "minutes": 2.0 },
  "minutesFromStart": 6.5,
  "doseFraction": 0.07,
  "oxygenFraction": 0.93,
  "isShelter": false,
  "isScienceStop": false
}
```

The `skyline` above is shortened. Real files always have `skylineSamples` values.

## Storm decision (optional additions)

These fields come from the engine's storm decision (`docs/decision-model.md`). Files without them are still valid, and clients that do not use them can ignore them.

- `shelter.id` on a waypoint: the id of the site chosen from that point: `"base"` or a shelter id from `data/out/shelters.json`.
- `rerouteInfo` at the top level: maps a `main` index (as a string, like `reroutes`) to the decision made there.

| Field | Type | Meaning |
|---|---|---|
| `chosen` | option, plus `dose`, `late` and `minutesLate` | The site the reroute goes to. `late` is true when no site could be reached within the limit and the nearest was taken; `minutesLate` is then how far over the limit it is |
| `options` | array of options | Every candidate within 12 walking minutes: reachable ones by score, then the rest |
| `base` | `{minutes, excludedByLimit}` | Walking minutes to the base, and whether the time limit ruled it out |

Each option:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `"base"` or a shelter id |
| `kind` | string | `"shelter"` or `"base"` |
| `minutes` | number | Walking minutes to the site |
| `blocked` | number | Blocked-sky fraction at the site |
| `baseLink` | boolean | Line of sight to the base mast from the site |
| `reachable` | boolean | Walking minutes are within the limit to be under cover |
| `score` | number | Modelled storm dose, raised by the no-link penalty when there is no base link. Lowest wins among reachable sites |

```json
"rerouteInfo": {
  "30": {
    "chosen": { "id": "s04", "kind": "shelter", "minutes": 4.52, "blocked": 0.254, "baseLink": true, "reachable": true, "score": 221.7, "dose": 221.7, "late": false },
    "options": [ { "...": "same fields as above, without dose and late" } ],
    "base": { "minutes": 9.73, "excludedByLimit": true }
  }
}
```

## Blending

Neighbouring waypoints should be close enough that the headset can blend one skyline into the next by interpolating each of the 72 values.

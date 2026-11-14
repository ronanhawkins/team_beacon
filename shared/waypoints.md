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

These fields come from the engine's storm decision model (`docs/decision-model.md`). Files without them are still valid, and clients that do not use them can ignore them.

- `shelter.id` on a waypoint: the id of the site the model chose from that point (`"base"`, `"habitat"` or a shelter id from `data/out/shelters.json`). When it is `"habitat"`, `az`, `distance` and `minutes` describe the walk to the base, where the drive to the habitat starts.
- `rerouteInfo` at the top level: maps a `main` index (as a string, like `reroutes`) to the decision made there.

| Field | Type | Meaning |
|---|---|---|
| `chosen` | option | The site the reroute goes to |
| `options` | array of options | The best five by score, plus the nearest refuge and the habitat, best first |

Each option:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `"base"`, `"habitat"` or a shelter id |
| `kind` | string | `"shelter"`, `"base"` or `"habitat"` |
| `minutes` | number | Minutes until sheltered: walking time, plus the drive for the habitat |
| `blocked` | number or null | Blocked-sky fraction at the site; `null` for the habitat |
| `baseLink` | boolean | Line of sight to the base mast from the site |
| `dose` | number | Modelled storm dose, in minutes at the open-ground dose rate |
| `score` | number | `dose`, raised by the no-link penalty when there is no base link. Lowest wins |

```json
"rerouteInfo": {
  "30": {
    "chosen": { "id": "s04", "kind": "shelter", "minutes": 4.52, "blocked": 0.254, "baseLink": true, "dose": 221.7, "score": 221.7 },
    "options": [ { "...": "same fields" } ]
  }
}
```

## Blending

Neighbouring waypoints should be close enough that the headset can blend one skyline into the next by interpolating each of the 72 values.

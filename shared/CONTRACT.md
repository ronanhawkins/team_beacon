# Proposed shared contract, version 1

This is a starter contract for team review, not an assertion that Ronan's engine already uses these fields. `fake-waypoints.json` and `fake-state.json` are the canonical runnable examples. Regenerate them with `node tools/generate-fixtures.js`.

## Waypoints

Top level: `schemaVersion: 1`, `source: {kind: "synthetic" | "terrain-derived", description: string}`, `waypoints: [...]`.

Each waypoint has:

| Field | Meaning |
| --- | --- |
| `id`, `name` | Unique stable ID and display name |
| `kind` | Optional `shelter` or `stop`; used by the demo jump only |
| `skylineDeg` | 8–4096 finite, equally spaced elevation samples, degrees, clockwise from north, no repeated endpoint |
| `markers` | `sun`, `earth`, `base`, `shelter`, each with `azimuthDeg` and `elevationDeg` |
| `minutesToShelter` | Demo waypoint's nonnegative shelter time |
| `contact` | Demo waypoint's Earth line of sight: `clear` or `blocked` |

Azimuth: 0° north, 90° east, 180° south, 270° west. Elevation: 0° at geometric horizon, +90° zenith. Three.js coordinates: east +X, up +Y, north -Z. Angles are site-relative, not real-world magnetic headings. On XR entry, forward becomes site north; either controller trigger realigns it. No absolute compass heading is inferred from the Quest.

For equally spaced samples h, the displayed open-sky fraction is `1 - mean(sin(clamp(h, 0°, 90°)))`, the unblocked solid-angle fraction of the upper hemisphere. This differs from cosine-weighted sky-view factor and is not directly a dose calculation. Negative horizons are shown below level, but do not increase the upper hemisphere beyond 100%.

## Relay state

Send a full snapshot on connect and every state change:

```json
{
  "type": "state",
  "state": {
    "schemaVersion": 1,
    "waypointId": "plain",
    "storm": false,
    "oxygenPct": 86,
    "doseMicroSv": 124,
    "minutesToShelter": 8.4,
    "contact": "clear",
    "sequence": 0,
    "updatedAt": "2026-11-14T09:00:00.000Z"
  }
}
```

`sequence` is a nonnegative safe integer, strictly increasing during a connection. It may restart after reconnect (server restart). Invalid snapshots and old sequences are ignored. Reconnect is exponential, capped at 10 seconds. Last valid values remain visible with an offline warning when disconnected. A connected-but-silent socket has no freshness watchdog yet; the real relay should define heartbeat/freshness policy.

The UI accepts complete authoritative relay values. It does not calculate medical limits, oxygen use, dose or emergency routes.

Commands: `{ "type": "command", "action": "next" | "back" | "storm" | "panic" | "reset" }`.

Errors: `{ "type": "error", "message": "Reason" }`.

The local simulator uses `/relay` on the same origin as Vite, and only accepts same-origin browser requests. It is not authenticated for public deployment; keep the default localhost binding. It does not implement the ESP listener, production secure relay, planning or authorization.

## Switch to real exports

Put the real waypoint file at `public/data/waypoints.json` while developing (or serve it at the equivalent deployed URL). Visit:

```text
/apps/headset/?waypoints=/data/waypoints.json&relay=wss%3A%2F%2FRELAY-HOST%2Frelay
```

The `relay` value must be the actual team's endpoint. A page served over HTTPS requires WSS. USB-localhost can use WS to a forwarded local endpoint. External routes require an explicit matching relay; the headset will not silently mix real waypoints with fake mission values. No telemetry is shown until a valid snapshot arrives.

For a display-only, unsynchronized demo use `?standalone=1`. This runs the same synthetic reducer locally and is labelled BROWSER DEMO. It is not an automatic fallback from a failed live relay.

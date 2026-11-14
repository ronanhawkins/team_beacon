# Radiation dose model

Every dose Beacon shows comes from one algorithm, in `engine/src/dose.rs`: the dose bar on each waypoint, the microgray figures in the briefing, and the storm decision's score (`docs/decision-model.md`).

## The algorithm

The dose rate at a point, at a moment, is:

```
rate = quiet rate  x  f(place)  x  m(time)
```

- **Quiet rate: 6.3 microgray per hour.** Measured by Curiosity's Radiation Assessment Detector at Gale on a quiet day (detector E, the median of sol 4186). This is open ground with no storm.
- **f, the place factor:**
  - On the terrain: `f = 1 - 0.5 x (blocked sky - 0.075)`, kept between 0.5 and 1.05. Open ground has 0.075 of its sky blocked and `f = 1`. The 0.5 is calibrated to Curiosity at Murray Butte: about 9 more points of blocked sky cut the dose by about 5 percent (Ehresmann et al. 2021).
  - Inside the base: a fixed 0.5 (an assumption for a normal shielded habitat).
- **m, the storm multiplier:** 1 on a quiet day. While a storm is on it is 33.3, the mean rate over the first 4 hours of the 20 May 2024 storm as Curiosity measured it, relative to the quiet rate.

The dose is the rate added up over time. Along a route, each leg between two waypoints takes the mean place factor of its two ends, times its walking minutes.

### The storm's timeline

A reroute starts when a storm is declared at a main waypoint. The storm arrives 5 minutes later (`storm.leadMinutes`) and lasts 240 minutes (`storm.stormMinutes`). A leg that crosses the arrival is split there: the part before it is charged at the quiet rate, the part after at 33.3 times. A reroute that reaches cover within the warning therefore adds very little dose; being caught in the open adds a lot.

The storm decision uses the same timeline for each candidate site: walking there on open ground, waiting at the site until the storm arrives, then sitting out the rest of the storm at the site's factor.

## Units

The engine works in "open-ground minutes": one minute on open ground on a quiet day is 1. Microgray = open-ground minutes x 6.3 / 60, so one unit is about 0.105 microgray.

## What the outputs mean

| Output | Meaning |
|---|---|
| `doseMicroGray` (waypoint, relay state) | Dose since the start of the walk, microgray |
| `doseRateMicroGrayPerHour` (waypoint, relay state) | Dose rate at that point at that moment |
| `doseFraction` (waypoint, relay state) | `doseMicroGray / doseBudgetMicroGray`. The budget is set so that the largest value on the main route or any reroute is 0.9 |
| `briefing.plannedDoseMicroGray` | Dose of the whole planned walk |
| `briefing.stormDoseMicroGrayMax` | The worst storm: from the waypoint where it costs most, walking to the chosen cover and sitting out the whole storm |
| `rerouteInfo[i].stormDoseMicroGray` | The same, from main waypoint `i` |

On the planned walk, the dose is about 1.1 microgray (10.5 minutes at a little under the open-ground rate). A storm caught at the far point costs about 765 microgray: 4.5 minutes' walk to shelter s03, then 4 hours there at 33 times the quiet rate, cut by 9 percent by the terrain.

## Limits

- **Absorbed dose, not risk.** These are micrograys of absorbed dose as RAD measures it, not sieverts. No quality factor is applied.
- **Curiosity is not a suit.** The quiet rate was measured inside the rover's own structure, and an astronaut's suit shields differently.
- **One storm profile.** Every storm is treated like the first 4 hours of May 2024. Real storms vary by orders of magnitude.
- **The terrain factor is simple.** It is a straight-line fit to one measurement, not a radiation transport model. The far horizon is computed once at the parking spot and reused everywhere.
- **NASA's public figure is not reproduced.** NASA said astronauts beside Curiosity "would have received a radiation dose of 8,100 micrograys" for this event. RAD's own dose-rate readings add up to about 1,700 microgray above the quiet level over the two storm sols. The page does not say how its figure was derived, so the model uses the measured readings.

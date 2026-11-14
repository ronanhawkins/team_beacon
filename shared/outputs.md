# Other engine outputs

Files the engine writes into `data/out/` besides `waypoints.json` (`waypoints.md`) and the map layers (`layers.md`). All fields are optional for clients: read what you need and ignore the rest.

## briefing.json

A summary of the planned walk, for the hub's briefing screen.

| Field | Type | Meaning |
|---|---|---|
| `version` | number | 1 |
| `routeLengthM` | number | Length of the main route, metres |
| `minutes` | number | Walking time of the main route |
| `waypoints` | number | Number of main waypoints |
| `worstMinutesToRefuge` | number | Longest walk to the chosen cover from any main waypoint |
| `baseLinkFraction` | number | Share of main waypoints with line of sight to the base mast |
| `sunlitFraction` | number | Share of main waypoints in sunlight |
| `endDoseFraction` | number | `doseFraction` at the last main waypoint |
| `endOxygenFraction` | number | `oxygenFraction` at the last main waypoint |
| `shelterCount` | number | Natural shelters found in the planning area |
| `slopeAtBaseDeg` | number | Ground slope at the base |

Added when the engine has the measured Curiosity RAD storm (`data/cache/rad_storm.json`):

| Field | Type | Meaning |
|---|---|---|
| `doseRateMicroGrayPerHour` | number | Measured quiet dose rate on open ground |
| `plannedDoseMicroGray` | number | Dose over the whole main route |
| `stormDoseMicroGrayMax` | number | Largest modelled storm dose (walking, waiting and the whole storm at the chosen site) from any main waypoint |
| `stormDoseMaxAt` | string | The main waypoint it is from |
| `doseBudgetMicroGray` | number | The `doseFraction` budget: `doseFraction` = dose / budget. Chosen so the largest `doseFraction` over the main route and every reroute is 0.9 |
| `stormMinutes` | number | Storm length used by the decision |
| `stormDoseMultiplier` | number | Storm dose rate relative to the quiet rate, used by the decision |

Added when the engine has the DONKI forecasts (`data/cache/donki_mars.json`):

| Field | Type | Meaning |
|---|---|---|
| `spaceWeather.marsArrivals` | number | Forecast coronal mass ejection arrivals at Mars within `windowHours` (72) either side of the sky time |
| `spaceWeather.nearest` | object or null | The nearest of those: `arrivalTime`, `hoursFromSkyTime` (negative = before), `isGlancingBlow`, `modelCompletionTime`, `leadHours` (arrival minus model completion), `link` |
| `spaceWeather.searched` | string | Dates of the forecasts searched |
| `spaceWeather.may2024` | string | One line on the forecasts for the May 2024 storm |
| `spaceWeather.source`, `windowHours` | | Where the data came from, and the window |

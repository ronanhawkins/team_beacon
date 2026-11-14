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

Added when the engine has the REMS weather feed (`data/cache/rems.json`), as `latestWeatherReport`. Values are from the latest sol in the feed, which may be weeks before the sky time: `ageDays` is how many. The feed is for outreach use only (`disclaimer`). Missing values are null. The same object without `ageDays` is also written as `conditions`, its earlier name, so older readers keep working; new code should read `latestWeatherReport`. The fields below are listed as `conditions.*` and are the same in both.

| Field | Type | Meaning |
|---|---|---|
| `conditions.sol`, `earthDate`, `daysBeforeSkyTime` | | Which sol the values are from |
| `conditions.minAirTempC`, `maxAirTempC` | number | Air temperature, degrees C |
| `conditions.minGroundTempC`, `maxGroundTempC` | number | Ground temperature, degrees C |
| `conditions.pressurePa` | number | Air pressure, pascals |
| `conditions.uvIndex`, `opacity`, `season` | string | As the feed gives them (for example "Moderate", "Sunny", "Month 12") |
| `conditions.sunrise`, `sunset` | string | Local mean solar time at the rover, "HH:MM" |
| `conditions.ls` | number | Solar longitude of that sol, degrees |
| `conditions.skyTimeLocal` | `{lmst, ltst, ls}` | The sky time as local mean and true solar time at the site, and its solar longitude (Mars24 algorithm) |
| `conditions.source`, `disclaimer` | string | Where the data came from, and the feed's disclaimer |

## shelters.json

Every refuge the planner found: the base first, then the natural shelters.

| Field | Type | Meaning |
|---|---|---|
| `refuges[].id` | string | `"base"`, or `s-<x>-<y>` from the shelter's position in metres, stable when the shelter set changes |
| `refuges[].label` | string | Optional name from `data/site.json` `shelterLabels`, such as `"Butte M12 shelter"`; empty for most |
| `refuges[].kind` | string | `"base"` or `"shelter"` |
| `refuges[].x`, `y` | number | Local metres |
| `refuges[].blocked` | number | Blocked-sky fraction there |
| `refuges[].baseLink`, `sunlit`, `earthLink` | boolean | As on a waypoint |

## stops.json

Every labelled stop of the planned walk, at its main waypoint, with Curiosity images for the science stops. Written by `engine plan`.

| Field | Type | Meaning |
|---|---|---|
| `version` | number | 1 |
| `stops` | array | One entry per labelled stop, in route order |
| `stops[].id`, `label` | string | The stop's id and label from `data/site.json` `routeStops` |
| `stops[].waypoint` | string | The main waypoint at the stop, like `m19` |
| `stops[].x`, `y` | number | Local metres |
| `stops[].minutesFromStart`, `openSky`, `baseLink` | | As on that waypoint |
| `stops[].isScienceStop` | boolean | |
| `stops[].shelter` | `{id, label, minutes}` | The site chosen from that stop if a storm is declared there, as on its waypoint |
| `stops[].images` | array | Empty when there are none. Each: `nasa_id`, `title`, `date`, `description`, `credit`, `thumbnailUrl`, `page`, and `file`: the thumbnail's path relative to `data/out` (served by the relay at `/data/` + `file`) |

Images come from the NASA Image and Video Library (`tools/fetch_stop_images.py`, cached in `data/cache/stop_images.json`). Credit them as given in `credit`.

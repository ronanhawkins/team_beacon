# Where to go when a solar storm is declared

**The rule: get under cover before the storm arrives. Of the places the astronaut can reach in time, go to the one that gives the lowest radiation dose.**

When a solar storm is declared, the astronaut has a few minutes of warning. Beacon answers one question from wherever they are standing: where to take cover.

## The options

From any point on the walk, Beacon considers:

- **The base.** A normal shielded habitat that halves the radiation dose compared with open ground.
- **Every natural shelter.** These are places at the foot of the buttes where the terrain blocks a large part of the sky, the ground is flat enough to wait on, and the patch is at least three map cells across. There are 35 inside the planning area.

For each option, Beacon works out the walking time over the real terrain (slower on slopes, and avoiding ground steeper than 25 degrees), how much of the sky is blocked there, and whether the site can see the base mast for radio contact.

## The rule, step by step

1. **Reachable in time.** A site counts only if the astronaut can walk there within the time limit, which is normally the warning time. Nobody should be walking in the open when the storm arrives.
2. **Lowest dose among those.** Each reachable site gets a score, and the lowest wins.
3. **If nothing is reachable**, the astronaut goes to the nearest site anyway, and Beacon marks the reroute as late, with how many minutes over the limit it is.

## The score among reachable sites

Doses are measured in "minutes at the open-ground dose rate": one minute standing on open ground on a normal day counts as 1. Curiosity measured that rate at Gale as 6.3 microgray per hour, so one unit is about 0.105 microgray.

| Symbol | Meaning |
|---|---|
| `t` | Walking time to the site |
| `L` | Warning time before the storm arrives |
| `D` | How long the storm lasts |
| `M` | How much stronger the radiation is during the storm |
| `f` | The site's dose rate relative to open ground |

```
f       = 0.5 at the base;
          at a shelter, 1 - 0.5 x (blocked sky - 0.075), kept between 0.5 and 1.05
walking = minutes walked before the storm x 1  +  minutes walked during the storm x M
waiting = minutes waited at the site before the storm x f
storm   = minutes of the storm spent at the site x M x f
dose    = walking + waiting + storm
score   = dose, made 5% worse if the site has no line of sight to the base
```

If two scores are equal, the shorter walk wins.

The shelter formula is calibrated to Curiosity's measurement in this exact place. When the rover parked beside Murray Butte, where the terrain blocked about 9 more percentage points of the sky than open ground, the radiation dose fell by about 5% (Ehresmann et al. 2021). The base's shielding is far better than any natural shelter, so it wins whenever it is in reach.

## Assumptions

Most numbers below are assumptions for the demo. The storm's length and strength are measured: they come from Curiosity's radiation detector during the solar storm of 20 May 2024. They are all in `data/site.json`, each with a note, so they can be changed in one place.

| Assumption | Value | Why it matters |
|---|---|---|
| Time limit to be under cover | 5 minutes | Hard rule. Normally equal to the warning time |
| Warning time `L` | 5 minutes | Time before the storm arrives |
| Storm length `D` | 240 minutes | Measured: the May 2024 storm stayed above 1.5 times the normal rate for about 38 hours. The model caps it at 4 hours |
| Storm multiplier `M` | 33 | Measured: the mean rate over the first 4 hours, relative to normal. The peak was 56 times normal; over the whole 38 hours the mean was 8 |
| Base dose factor | 0.5 | The base is a normal shielded habitat |
| Shelter shielding factor | 0.5 | Converts blocked sky into dose, using the calibration above |
| Open-ground blocked sky | 0.075 | The blocked fraction where the dose rate is exactly 1 (measured at sol1468, with the distant horizon from MOLA) |
| No-link penalty | 5% | A shelter without radio contact to the base scores 5% worse |
| Walking speed | 0.8 m/s on flat ground | Slower on slopes; ground steeper than 25 degrees is impassable |

## What it decides on the planned walk

With a 5-minute limit, every point of the walk has somewhere to go in time:

- **The first third of the walk (waypoints m00 to m14):** back to the base, at most 4.7 minutes away.
- **From just before the Quela drill site to the far point (m15 to m30):** shelter s03, a hollow at the foot of the butte next to Quela. It has a quarter of the sky blocked and radio contact with the base, and it's at most 4.5 minutes away.

The longest walk to cover anywhere on the route is 4.7 minutes, inside the limit.

## How the choice changes with warning time

The time limit is set equal to the warning in each column. Each cell shows the chosen site and the walk to it, or "late" and the minutes over the limit when nothing can be reached in time. Run `engine decide --sweep` to reproduce it.

| Waypoint | No warning | 2 min | 5 min | 10 min | 15 min |
|---|---|---|---|---|---|
| m10, open ground a third of the way out | s03, late by 3.4 | s03, late by 1.4 | base, 3.5 min | base, 3.5 min | base, 3.5 min |
| m19, Quela drill site | s03, late by 0.8 | s03, 0.8 min | s03, 0.8 min | base, 6.6 min | base, 6.6 min |
| m25, butte outcrop | s05, late by 1.0 | s06, 1.5 min | s03, 2.8 min | base, 8.0 min | base, 8.0 min |
| m30, far point | s21, late by 1.5 | s17, 2.0 min | s03, 4.5 min | base, 9.7 min | base, 9.7 min |

How to read it:

- **With no warning**, nothing is ever "in time", so the astronaut goes to the nearest cover.
- **With a short warning**, the choice is the best shelter in reach. At the far point with 2 minutes, that shelter (s17) has no radio contact with the base, but it is the only one in reach.
- **With 10 minutes or more**, the base is in reach from every point tested, and its shielding wins.

## Forecasts days ahead, warnings minutes ahead

The briefing's `spaceWeather` lists NASA's DONKI forecasts of coronal mass ejections arriving at Mars. Those clouds travel for days, so the forecasts come with lead times of days (30 to 114 hours for the May 2024 storm). They are for deciding whether to go out at all. The model's short warning time is for something else: the fast particles from a solar flare, which reach Mars within minutes. In May 2024 Curiosity's detector rose about 1.3 hours before the earliest forecast arrival of the cloud.

## Limits

- **This is an operating rule, not a dose-optimal result.** The dose model on its own would accept a longer walk to the shielded base, even arriving after the storm has started, because the base cuts the dose so much. The rule exists because the onset is the most intense and least predictable part of a storm, so being caught in the open then is the risk to avoid. Once the peak has passed, the astronaut returns to base.
- The dose model is a simple, calibrated rule of thumb, not a radiation transport calculation.
- Walking times assume the astronaut keeps to the planned speed in an emergency and takes the fastest path over the terrain.
- Shelters are found from the terrain model at 2 m resolution. Every one would need checking on the ground.

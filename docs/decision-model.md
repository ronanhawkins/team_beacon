# Where to go when a solar storm is declared

When a solar storm is declared, the astronaut has a few minutes before the particles arrive. Beacon has to answer one question from wherever they are standing: **which shelter gives the lowest radiation dose over the whole storm?**

The nearest shelter is not always the best one. A deeper hollow under a butte blocks more of the sky, which cuts the dose for the whole time the astronaut waits there, and a few more minutes of walking can be worth it. Beacon scores every option the same way and picks the lowest score.

## The options

From any point on the walk, Beacon considers:

- **Every natural shelter.** These are places at the foot of the buttes where the terrain blocks a large part of the sky, the ground is flat enough to wait on, and the patch is at least three map cells across. On the planned route there are 28.
- **The base site.** This is the rover and its relay mast. It has no shielding of its own, so it is only as good as the open ground around it.
- **The habitat.** This is the shielded habitat, a long drive away. Getting there means walking to the base and then driving back.

For each option Beacon knows the walking time `t` from the astronaut's position (over the real terrain, slower on slopes), how much of the sky is blocked there, and whether the site can see the base mast for radio contact.

## The score

All doses are measured in "minutes at the open-ground dose rate": one minute standing on open ground on a normal day counts as 1.

| Symbol | Meaning |
|---|---|
| `L` | Warning time before the storm arrives (lead time) |
| `D` | How long the storm lasts |
| `M` | How much stronger the radiation is during the storm |
| `f` | The site's dose rate relative to open ground. Under a butte it is lower |

```
f       = 1 - 0.5 x (blocked sky - 0.06), kept between 0.5 and 1.05   (the habitat uses 0.5)
walking = minutes walked before the storm x 1  +  minutes walked during the storm x M
waiting = minutes waited at the site before the storm x f
storm   = minutes of the storm spent at the site x M x f
dose    = walking + waiting + storm
score   = dose, made 5% worse if the site has no line of sight to the base
```

The lowest score wins. If two scores are equal, the shorter walk wins.

The dose-rate formula is calibrated to Curiosity's measurement in this exact place. When the rover parked beside Murray Butte, where the terrain blocked about 9 more percentage points of the sky than open ground, the radiation dose fell by about 5% (Ehresmann et al. 2021).

## Assumptions

Every number below is an assumption for the demo, not a measured value. They are all in `data/site.json`, each with a note, so they can be changed in one place.

| Assumption | Value | Why it matters |
|---|---|---|
| Lead time `L` | 5 minutes | Warning before the storm arrives. Time walked inside it counts as walking during the storm |
| Storm length `D` | 120 minutes | How long the astronaut shelters |
| Storm multiplier `M` | 2 | Radiation during the storm relative to normal |
| No-link penalty | 5% | A shelter without radio contact to the base is scored 5% worse |
| Shielding factor | 0.5 | Converts blocked sky into dose: the calibration above |
| Open-ground blocked sky | 0.06 | The blocked fraction where the dose rate is exactly 1 |
| Habitat return | 150 minutes | Walking to the base plus driving back to the habitat |
| Habitat dose factor | 0.5 | The habitat halves the dose compared with open ground |
| Walking speed | 0.8 m/s on flat ground | Slower on slopes; ground steeper than 25 degrees is impassable |

## What it decides on the planned walk

With the values above, the best choice from every point on the walk is **shelter s04**. It is a hollow at the foot of the butte next to the Quela drill site, with 25% of the sky blocked, and it can see the base. From the far point of the walk it is 4.5 minutes away, and it beats the nearest shelter (2 minutes away, but out of radio contact). The storm lasts much longer than any walk here, so how good the shelter is matters more than how close it is.

The base site is never chosen: the mast gives no shielding. The habitat is 160 minutes away from the far point, so it would mean spending most of the storm on the road.

## How the choice changes with warning time and distance to the habitat

This sweep is for the far point of the walk (waypoint m30, local position 1500.0, 1627.7). Each cell shows the chosen site and its score; lower is better. Run `engine decide 30 --sweep` to reproduce it.

| Lead time | Habitat 30 min | 60 min | 90 min | 120 min | 150 min |
|---|---|---|---|---|---|
| 0 min | habitat (160) | habitat (190) | s04 (218) | s04 (218) | s04 (218) |
| 5 min | habitat (160) | habitat (190) | habitat (220) | s04 (222) | s04 (222) |
| 15 min | habitat (160) | habitat (190) | habitat (220) | s04 (231) | s04 (231) |
| 30 min | habitat (160) | habitat (190) | habitat (220) | s04 (244) | s04 (244) |
| 60 min | habitat (170) | habitat (190) | habitat (220) | habitat (250) | s04 (271) |

How to read it:

- **A close habitat always wins.** Within about an hour's return, its heavy shielding outweighs the time spent getting there.
- **A far habitat only wins with a long warning.** With the default 150-minute return, it takes about an hour's warning before the trip pays off. With shorter warnings the astronaut is better off in s04.
- **More warning makes the shelter's score worse, not better.** The shelter's score rises with lead time because the model counts the whole storm plus the waiting before it. That isn't extra danger: the extra minutes are just spent sheltering at a low rate.

## Limits

- The dose model is a simple, calibrated rule of thumb, not a radiation transport calculation.
- Walking times assume the astronaut keeps to the planned speed during an emergency and takes the fastest path over the terrain.
- The habitat's position is not on the map; only its return time is modelled.
- Shelters are found from the terrain model at 2 m resolution. Every one would need checking on the ground.

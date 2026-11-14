# Conventions

These apply to every contract in this folder. Read this first.

## Units

| Quantity | Unit | Notes |
|---|---|---|
| Angles | degrees | Never radians in any shared file or message |
| Azimuth | degrees, 0 to 360 | 0 is north, increasing clockwise (90 is east) |
| Elevation | degrees | Above the horizontal. Negative means below it |
| Distance | metres | |
| Time | minutes | Decimal minutes, e.g. 2.5 |
| Fractions | 0 to 1 | Never percentages. 0.88, not 88 |

## Skyline

- An array of 72 elevation angles, one per 5 degrees of azimuth.
- Index 0 is north. Index increases clockwise, so index 18 is east.
- Each value is the highest terrain elevation angle seen in that direction from the point.

## Position

- Local frame in metres. Origin is the south-west corner of the terrain crop.
- x is east, y is north, z is up.
- z is the terrain height from the elevation model, so it is a large negative number in Gale crater. Only differences in z matter.

## Fractions that count

- `openSky`: fraction of the sky dome not blocked by terrain. 1 is a flat open plain.
- `doseFraction`: radiation dose so far as a fraction of the walk's budget. Counts up from 0.
- `oxygenFraction`: oxygen remaining. Counts down from 1.

## Changing a contract

- Every file and message carries a `version` number.
- During the weekend, only add fields. Clients must ignore fields they do not know.
- Renaming or removing a field needs the whole team told before it is pushed.

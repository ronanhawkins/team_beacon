//! Skyline: the highest terrain elevation angle in each compass direction.
//!
//! Index 0 is north and indices increase clockwise (shared/conventions.md).
//! Angles are computed in radians and returned in degrees.

use crate::terrain::Grid;

/// Mars mean radius used for the curvature drop (same sphere as the mosaic).
pub const MARS_RADIUS_M: f64 = 3_396_190.0;

/// Fast settings for map layers: 72 directions out to 700 m.
pub const FAST_DIRS: usize = 72;
pub const FAST_MAX_M: f64 = 700.0;

/// Elevation angle in degrees per direction, from local position (x, y) in
/// metres (x east, y north, shared/conventions.md), marching in even steps.
///
/// For azimuth a, each metre moves x by sin(a) and y by cos(a). The eye is the
/// terrain at the point plus `eye_height_m`. Each direction is marched from
/// `step_m` to `max_dist_m`; no-data samples are skipped and the march stops
/// when it leaves the grid. A direction with no samples gives 0.
///
/// Errors if the observer's own position is outside the grid or no-data.
pub fn skyline(
    grid: &Grid,
    x: f64,
    y: f64,
    eye_height_m: f64,
    n_dirs: usize,
    step_m: f64,
    max_dist_m: f64,
) -> Result<Vec<f32>, String> {
    let steps = (max_dist_m / step_m).floor() as usize;
    let distances: Vec<f64> = (1..=steps).map(|k| k as f64 * step_m).collect();
    skyline_at_distances(grid, x, y, eye_height_m, n_dirs, &distances)
}

/// Distances for the fast skyline: every 1 m out to 50 m, then each step 2%
/// longer than the one before, out to 700 m.
pub fn fast_distances() -> Vec<f64> {
    let (mut out, mut d, mut step) = (Vec::new(), 0.0, 1.0);
    loop {
        d += step;
        if d > FAST_MAX_M {
            break;
        }
        out.push(d);
        if d >= 50.0 {
            step *= 1.02;
        }
    }
    out
}

/// The fast skyline used for map layers: 72 directions, `distances` from
/// `fast_distances()` (passed in so callers compute them once).
pub fn fast_skyline(grid: &Grid, x: f64, y: f64, eye_height_m: f64, distances: &[f64]) -> Result<Vec<f32>, String> {
    skyline_at_distances(grid, x, y, eye_height_m, FAST_DIRS, distances)
}

/// Shared march for `skyline` and `fast_skyline`: same maths, any list of
/// increasing distances in metres.
pub fn skyline_at_distances(
    grid: &Grid,
    x: f64,
    y: f64,
    eye_height_m: f64,
    n_dirs: usize,
    distances: &[f64],
) -> Result<Vec<f32>, String> {
    let ground = grid
        .sample_local(x, y)
        .ok_or_else(|| format!("observer at x {x}, y {y} is outside the grid or on no-data"))?;
    let eye = ground as f64 + eye_height_m;

    let mut out = Vec::with_capacity(n_dirs);
    for i in 0..n_dirs {
        let az = (i as f64) * std::f64::consts::TAU / n_dirs as f64;
        let (dx, dy) = (az.sin(), az.cos()); // east and north per metre
        let mut best: Option<f64> = None;

        for &dist in distances {
            let (px, py) = (x + dx * dist, y + dy * dist);
            if !grid.contains_local(px, py) {
                break;
            }
            let Some(h) = grid.sample_local(px, py) else { continue }; // no-data: skip
            let angle = (h as f64 - eye).atan2(dist);
            best = Some(best.map_or(angle, |b| b.max(angle)));
        }

        out.push(best.unwrap_or(0.0).to_degrees() as f32);
    }
    Ok(out)
}

/// Far-field skyline through a coarse grid (far.bin), from the point at
/// `easting`, `northing` with the eye at absolute elevation `eye_elevation`.
///
/// Each direction is marched from `from_m` to the edge of the grid in steps of
/// one far-grid cell (20 m for far.bin). Each terrain height is lowered by
/// d^2 / (2R) for the planet's curvature before taking the angle. No-data is
/// skipped. A direction with no samples gives -90, so merging ignores it.
pub fn far_skyline(far: &Grid, easting: f64, northing: f64, eye_elevation: f64, n_dirs: usize, from_m: f64) -> Vec<f32> {
    let (x, y) = far.en_to_local(easting, northing);
    let step = far.metres_per_pixel;
    (0..n_dirs)
        .map(|i| {
            let az = (i as f64) * std::f64::consts::TAU / n_dirs as f64;
            let (dx, dy) = (az.sin(), az.cos());
            let mut best: Option<f64> = None;
            let mut dist = from_m;
            loop {
                let (px, py) = (x + dx * dist, y + dy * dist);
                if !far.contains_local(px, py) {
                    break;
                }
                if let Some(h) = far.sample_local(px, py) {
                    let drop = dist * dist / (2.0 * MARS_RADIUS_M);
                    let angle = (h as f64 - drop - eye_elevation).atan2(dist);
                    best = Some(best.map_or(angle, |b| b.max(angle)));
                }
                dist += step;
            }
            best.map_or(-90.0, |b| b.to_degrees() as f32)
        })
        .collect()
}

/// The higher angle in each direction. Both skylines must have the same length.
pub fn merge(a: &[f32], b: &[f32]) -> Vec<f32> {
    assert_eq!(a.len(), b.len(), "merging skylines of different lengths");
    a.iter().zip(b).map(|(&p, &q)| p.max(q)).collect()
}

/// Skyline elevation at any azimuth, interpolating linearly between the two
/// neighbouring directions (wrapping past north).
pub fn elevation_at(skyline: &[f32], az_deg: f64) -> f32 {
    let n = skyline.len();
    let pos = az_deg.rem_euclid(360.0) / (360.0 / n as f64);
    let i0 = pos.floor() as usize % n;
    let i1 = (i0 + 1) % n;
    let t = (pos - pos.floor()) as f32;
    skyline[i0] * (1.0 - t) + skyline[i1] * t
}

/// True if a body at (az, el) degrees clears the skyline.
pub fn visible(skyline: &[f32], az_deg: f64, el_deg: f64) -> bool {
    el_deg as f32 > elevation_at(skyline, az_deg)
}

/// Fraction of the sky dome blocked: mean of sin(angle), negative angles as 0.
pub fn blocked_fraction(skyline: &[f32]) -> f32 {
    if skyline.is_empty() {
        return 0.0;
    }
    let sum: f64 = skyline
        .iter()
        .map(|&deg| (deg.max(0.0) as f64).to_radians().sin())
        .sum();
    (sum / skyline.len() as f64) as f32
}

/// Index of the direction nearest to `az_deg` in a skyline of `n` values.
pub fn index_for_azimuth(az_deg: f64, n: usize) -> usize {
    let step = 360.0 / n as f64;
    ((az_deg.rem_euclid(360.0) / step + 0.5).floor() as usize) % n
}

/// Reduce to `n` evenly spaced directions by taking the value at each
/// target azimuth (nearest source direction).
pub fn resample(skyline: &[f32], n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| skyline[index_for_azimuth(i as f64 * 360.0 / n as f64, skyline.len())])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::NO_DATA;

    const SIZE: usize = 201;
    const CENTRE: f64 = 100.0; // array index of the observer's cell
    // Local metres of that cell's centre (1 m cells): x = col + 0.5, y = SIZE - row - 0.5.
    const OBS_X: f64 = CENTRE + 0.5;
    const OBS_Y: f64 = SIZE as f64 - CENTRE - 0.5;

    fn grid_from(f: impl Fn(f64, f64) -> f32) -> Grid {
        let mut data = Vec::with_capacity(SIZE * SIZE);
        for row in 0..SIZE {
            for col in 0..SIZE {
                data.push(f(col as f64, row as f64));
            }
        }
        Grid::synthetic(SIZE, SIZE, data, 1.0)
    }

    fn argmax(v: &[f32]) -> usize {
        (0..v.len()).max_by(|&a, &b| v[a].total_cmp(&v[b])).unwrap()
    }

    #[test]
    fn flat_plane_is_open() {
        let g = grid_from(|_, _| -4400.0);
        let sky = skyline(&g, OBS_X, OBS_Y, 1.0, 360, 0.5, 90.0).unwrap();
        assert_eq!(sky.len(), 360);
        assert!(sky.iter().all(|&a| a <= 0.0), "max {}", sky[argmax(&sky)]);
        assert_eq!(blocked_fraction(&sky), 0.0);
    }

    #[test]
    fn cone_gives_thirty_degrees() {
        // Bilinear blending cuts the corner at the cone's apex, which reads as
        // a slightly steeper angle at the first step. A 0.1 m grid keeps that
        // well under the tolerance and also exercises metres_per_pixel.
        let (size, mpp) = (801usize, 0.1);
        let centre = (size / 2) as f64;
        let (ox, oy) = ((centre + 0.5) * mpp, (size as f64 - centre - 0.5) * mpp);
        let tan30 = 30f64.to_radians().tan();
        let mut data = Vec::with_capacity(size * size);
        for row in 0..size {
            for col in 0..size {
                let dist_m = (col as f64 - centre).hypot(row as f64 - centre) * mpp;
                data.push((dist_m * tan30) as f32);
            }
        }
        let g = Grid::synthetic(size, size, data, mpp);
        let sky = skyline(&g, ox, oy, 0.0, 360, 0.5, 39.0).unwrap();
        for (i, &a) in sky.iter().enumerate() {
            assert!((a - 30.0).abs() < 0.5, "direction {i}: {a}");
        }
        let blocked = blocked_fraction(&sky);
        assert!((blocked - 0.5).abs() < 0.01, "blocked {blocked}");
    }

    #[test]
    fn direction_mapping() {
        // (azimuth, column offset, row offset) of a tall block 40 m away.
        let cases = [(0.0, 0.0, -40.0), (90.0, 40.0, 0.0), (180.0, 0.0, 40.0), (270.0, -40.0, 0.0)];
        for (az, dc, dr) in cases {
            let (bc, br) = (CENTRE + dc, CENTRE + dr);
            let g = grid_from(|c, r| if (c - bc).abs() <= 3.0 && (r - br).abs() <= 3.0 { 50.0 } else { 0.0 });
            let sky = skyline(&g, OBS_X, OBS_Y, 1.0, 360, 0.5, 90.0).unwrap();
            let peak = argmax(&sky) as f64; // 360 directions: index = degrees
            let diff = ((peak - az + 180.0).rem_euclid(360.0) - 180.0).abs();
            assert!(diff <= 5.0, "block at {az}: peak at {peak}");
        }
    }

    #[test]
    fn no_data_is_skipped() {
        // A no-data patch 10-20 m north, and a tall block 40 m north behind it.
        let g = grid_from(|c, r| {
            let dc = (c - CENTRE).abs();
            if dc <= 3.0 && (CENTRE - 20.0..=CENTRE - 10.0).contains(&r) {
                NO_DATA
            } else if dc <= 3.0 && (r - (CENTRE - 40.0)).abs() <= 3.0 {
                50.0
            } else {
                0.0
            }
        });
        let sky = skyline(&g, OBS_X, OBS_Y, 1.0, 360, 0.5, 90.0).unwrap();
        // The block behind the patch is still seen: the march skipped, not stopped.
        assert!(sky[0] > 45.0, "north angle {}", sky[0]);
    }

    #[test]
    fn observer_on_no_data_is_an_error() {
        let g = grid_from(|c, r| if c == CENTRE && r == CENTRE { NO_DATA } else { 0.0 });
        assert!(skyline(&g, OBS_X, OBS_Y, 1.0, 36, 0.5, 50.0).is_err());
    }

    #[test]
    fn resample_takes_values_at_target_azimuths() {
        let sky: Vec<f32> = (0..360).map(|i| i as f32).collect();
        let r = resample(&sky, 72);
        assert_eq!(r.len(), 72);
        assert_eq!(r[0], 0.0);
        assert_eq!(r[18], 90.0);
        assert_eq!(r[71], 355.0);
    }

    #[test]
    fn far_field_on_a_flat_grid_falls_with_distance() {
        // Flat 20 m grid, 40 km square; observer in the middle with the eye at ground level.
        let (size, mpp) = (2001usize, 20.0);
        let g = Grid::synthetic(size, size, vec![-4400.0; size * size], mpp);
        let (e, n) = g.local_to_en(20010.0, 20010.0);
        let angle_from = |from_m: f64| far_skyline(&g, e, n, -4400.0, 8, from_m);
        for from_m in [1000.0, 5000.0, 15000.0] {
            let sky = angle_from(from_m);
            // The nearest sample is the highest: d / (2R) radians below the horizontal.
            let expected = -(from_m / (2.0 * MARS_RADIUS_M)).atan().to_degrees() as f32;
            for &a in &sky {
                assert!(a < 0.0 && (a - expected).abs() < 1e-3, "from {from_m}: {a}, expected {expected}");
            }
        }
        assert!(angle_from(5000.0)[0] < angle_from(1000.0)[0]);
        assert!(angle_from(15000.0)[0] < angle_from(5000.0)[0]);
    }

    #[test]
    fn low_sun_behind_a_wall() {
        // 1 m grid, flat, with a 10 m wall along x = 20..22 m. Sun low in the west.
        let size = 401usize;
        let mut data = Vec::with_capacity(size * size);
        for _row in 0..size {
            for col in 0..size {
                data.push(if (20..=22).contains(&col) { 10.0 } else { 0.0 });
            }
        }
        let g = Grid::synthetic(size, size, data, 1.0);
        let dists = fast_distances();
        let (sun_az, sun_el) = (270.0, 10.0);
        let near_wall = fast_skyline(&g, 26.5, 200.5, 1.0, &dists).unwrap();
        let far_away = fast_skyline(&g, 300.5, 200.5, 1.0, &dists).unwrap();
        assert!(!visible(&near_wall, sun_az, sun_el), "west angle {}", elevation_at(&near_wall, 270.0));
        assert!(visible(&far_away, sun_az, sun_el), "west angle {}", elevation_at(&far_away, 270.0));
    }

    #[test]
    fn interpolation_between_directions() {
        let sky: Vec<f32> = (0..72).map(|i| i as f32).collect();
        assert_eq!(elevation_at(&sky, 10.0), 2.0);
        assert!((elevation_at(&sky, 12.5) - 2.5).abs() < 1e-6);
        // Between 355 and 360 (= index 0) it wraps.
        assert!((elevation_at(&sky, 357.5) - 35.5).abs() < 1e-6);
    }

    #[test]
    fn fast_distances_grow() {
        let d = fast_distances();
        assert_eq!(d[0], 1.0);
        assert_eq!(d[49], 50.0);
        assert!(*d.last().unwrap() <= FAST_MAX_M && *d.last().unwrap() > 680.0);
        assert!(d.len() < 200, "{} steps", d.len());
    }
}

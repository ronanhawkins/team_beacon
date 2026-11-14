//! Skyline: the highest terrain elevation angle in each compass direction.
//!
//! Index 0 is north and indices increase clockwise (shared/conventions.md).
//! Angles are computed in radians and returned in degrees.

use crate::terrain::Grid;

/// Elevation angle in degrees per direction, from local position (x, y) in
/// metres (x east, y north, shared/conventions.md).
///
/// For azimuth a, each metre moves x by sin(a) and y by cos(a). The eye is the terrain at the point plus `eye_height_m`. Each
/// direction is marched from `step_m` to `max_dist_m`; no-data samples are
/// skipped and the march stops when it leaves the grid. A direction with no
/// samples gives 0.
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
    let ground = grid
        .sample_local(x, y)
        .ok_or_else(|| format!("observer at x {x}, y {y} is outside the grid or on no-data"))?;
    let eye = ground as f64 + eye_height_m;
    let steps = (max_dist_m / step_m).floor() as usize;

    let mut out = Vec::with_capacity(n_dirs);
    for i in 0..n_dirs {
        let az = (i as f64) * std::f64::consts::TAU / n_dirs as f64;
        let (dx, dy) = (az.sin(), az.cos()); // east and north per metre
        let mut best: Option<f64> = None;

        for k in 1..=steps {
            let dist = k as f64 * step_m;
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
        Grid { width: SIZE, height: SIZE, data, metres_per_pixel: 1.0 }
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
        let g = Grid { width: size, height: size, data, metres_per_pixel: mpp };
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
}

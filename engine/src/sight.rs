//! Line of sight between two points above the terrain.

use crate::terrain::Grid;

/// True if a straight line from `from` (`from_height_m` above the ground) to
/// `to` (`to_height_m` above the ground) clears the terrain. Positions are
/// local metres. The line is sampled every `step_m`; no-data samples are
/// skipped. Returns false if either end is outside the grid or on no-data.
pub fn line_of_sight(grid: &Grid, from: (f64, f64), from_height_m: f64, to: (f64, f64), to_height_m: f64, step_m: f64) -> bool {
    let (Some(g0), Some(g1)) = (grid.sample_local(from.0, from.1), grid.sample_local(to.0, to.1)) else {
        return false;
    };
    let (z0, z1) = (g0 as f64 + from_height_m, g1 as f64 + to_height_m);
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let length = dx.hypot(dy);
    let steps = (length / step_m).floor() as usize;
    // Interior samples only: the ends sit on the ground plus their heights by construction.
    for k in 1..steps {
        let t = k as f64 * step_m / length;
        if let Some(h) = grid.sample_local(from.0 + dx * t, from.1 + dy * t) {
            if h as f64 > z0 + (z1 - z0) * t {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Flat 1 m grid with a 5 m ridge along x = 99..101 m.
    fn ridge() -> Grid {
        let size = 201usize;
        let mut data = Vec::with_capacity(size * size);
        for _row in 0..size {
            for col in 0..size {
                data.push(if (99..=101).contains(&col) { 5.0 } else { 0.0 });
            }
        }
        Grid::synthetic(size, size, data, 1.0)
    }

    #[test]
    fn ridge_blocks_and_a_tall_mast_clears_it() {
        let g = ridge();
        let (a, b) = ((50.5, 100.5), (150.5, 100.5));
        // 1 m eye to a 1 m mast: the line is 1 m up at the ridge, which is 5 m.
        assert!(!line_of_sight(&g, a, 1.0, b, 1.0, 1.0));
        // A 20 m mast lifts the line to about 10.5 m over the ridge.
        assert!(line_of_sight(&g, a, 1.0, b, 20.0, 1.0));
    }

    #[test]
    fn flat_ground_is_always_in_sight() {
        let g = Grid::synthetic(50, 50, vec![0.0; 2500], 1.0);
        assert!(line_of_sight(&g, (5.5, 5.5), 1.0, (44.5, 40.5), 1.0, 1.0));
    }
}

//! Planning grid, shelters, minutes to refuge and A* routes.
//!
//! The grid has 2 m cells over the planner bounds, values at cell centres.
//! Internally cells are indexed i = row * w + col with row 0 at the south
//! edge; positions outside this module are local metres.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, VecDeque};

use rayon::prelude::*;
use serde::Deserialize;

use crate::layers::{base_link, Base};
use crate::skyline;
use crate::terrain::Grid;

pub const CELL_M: f64 = 2.0;
const EYE_HEIGHT_M: f64 = 1.0;
/// Slope (degrees) at which walking time per metre doubles.
const SLOPE_SCALE_DEG: f64 = 15.0;
/// Minimum group size for a shelter, in cells.
const SHELTER_MIN_CELLS: usize = 3;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlannerConfig {
    pub walk_speed: f64,
    pub max_slope_deg: f64,
    pub shelter_extra_blocked: f64,
    pub shelter_max_slope_deg: f64,
    pub minutes_to_shelter_limit: f64,
    pub waypoint_spacing: f64,
    pub open_blocked: f64,
    pub dose_shielding_factor: f64,
    pub oxygen_minutes: f64,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x_min: f64,
    pub x_max: f64,
    pub y_min: f64,
    pub y_max: f64,
}

pub struct PlanGrid {
    pub bounds: Bounds,
    pub w: usize,
    pub h: usize,
    pub blocked: Vec<f32>,
    pub sunlit: Vec<bool>,
    pub earth_link: Vec<bool>,
    pub base_link: Vec<bool>,
    pub slope: Vec<f32>,
    pub passable: Vec<bool>,
}

impl PlanGrid {
    /// An empty grid over `bounds` with every value at its neutral default. Used by tests and `build`.
    pub fn blank(bounds: Bounds) -> PlanGrid {
        let w = ((bounds.x_max - bounds.x_min) / CELL_M).round() as usize;
        let h = ((bounds.y_max - bounds.y_min) / CELL_M).round() as usize;
        let n = w * h;
        PlanGrid {
            bounds,
            w,
            h,
            blocked: vec![0.0; n],
            sunlit: vec![true; n],
            earth_link: vec![true; n],
            base_link: vec![true; n],
            slope: vec![0.0; n],
            passable: vec![true; n],
        }
    }

    pub fn len(&self) -> usize {
        self.w * self.h
    }

    pub fn centre(&self, i: usize) -> (f64, f64) {
        let (col, row) = (i % self.w, i / self.w);
        (self.bounds.x_min + (col as f64 + 0.5) * CELL_M, self.bounds.y_min + (row as f64 + 0.5) * CELL_M)
    }

    /// The cell containing a local position, if inside the bounds.
    pub fn cell_at(&self, x: f64, y: f64) -> Option<usize> {
        let col = ((x - self.bounds.x_min) / CELL_M).floor();
        let row = ((y - self.bounds.y_min) / CELL_M).floor();
        if col < 0.0 || row < 0.0 || col >= self.w as f64 || row >= self.h as f64 {
            return None;
        }
        Some(row as usize * self.w + col as usize)
    }

    /// Nearest passable cell centre to a position, and its distance.
    pub fn nearest_passable(&self, x: f64, y: f64) -> Option<(usize, f64)> {
        (0..self.len())
            .filter(|&i| self.passable[i])
            .map(|i| {
                let (cx, cy) = self.centre(i);
                (i, (cx - x).hypot(cy - y))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
    }

    /// Walking minutes per metre in a cell.
    pub fn minutes_per_metre(&self, i: usize, cfg: &PlannerConfig) -> f64 {
        let s = self.slope[i] as f64 / SLOPE_SCALE_DEG;
        (1.0 / cfg.walk_speed) * (1.0 + s * s) / 60.0
    }

    /// Walking minutes for a move between neighbouring cells, using the mean of the two cells.
    pub fn step_minutes(&self, a: usize, b: usize, dist_m: f64, cfg: &PlannerConfig) -> f64 {
        dist_m * 0.5 * (self.minutes_per_metre(a, cfg) + self.minutes_per_metre(b, cfg))
    }

    /// Passable 8-connected neighbours with their distance in metres.
    pub fn neighbours(&self, i: usize) -> impl Iterator<Item = (usize, f64)> + '_ {
        let (col, row) = ((i % self.w) as i64, (i / self.w) as i64);
        const D: [(i64, i64); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];
        D.iter().filter_map(move |&(dc, dr)| {
            let (c, r) = (col + dc, row + dr);
            if c < 0 || r < 0 || c >= self.w as i64 || r >= self.h as i64 {
                return None;
            }
            let j = r as usize * self.w + c as usize;
            let dist = if dc != 0 && dr != 0 { CELL_M * std::f64::consts::SQRT_2 } else { CELL_M };
            self.passable[j].then_some((j, dist))
        })
    }
}

/// What the planning grid needs to know about the site.
pub struct SiteSky<'a> {
    pub far72: &'a [f32],
    pub sun: (f64, f64),
    pub earth: (f64, f64),
    pub base: &'a Base,
}

/// Computes the planning grid from the terrain, in parallel.
pub fn build(near: &Grid, sky: &SiteSky, bounds: Bounds, cfg: &PlannerConfig) -> PlanGrid {
    let mut g = PlanGrid::blank(bounds);
    let (w, h) = (g.w, g.h);

    // 2 m mean heights with a one-cell ring, for the slope.
    let ring_w = w + 2;
    let heights: Vec<Option<f32>> = (0..ring_w * (h + 2))
        .into_par_iter()
        .map(|k| {
            let (c, r) = ((k % ring_w) as f64 - 1.0, (k / ring_w) as f64 - 1.0);
            near.block_mean_local(bounds.x_min + c * CELL_M, bounds.y_min + r * CELL_M, CELL_M)
        })
        .collect();
    let slope_at = |col: usize, row: usize| -> Option<f32> {
        let at = |c: usize, r: usize| heights[r * ring_w + c].map(|v| v as f64);
        let (c, r) = (col + 1, row + 1);
        let dzdx = (at(c + 1, r)? - at(c - 1, r)?) / (2.0 * CELL_M);
        let dzdy = (at(c, r + 1)? - at(c, r - 1)?) / (2.0 * CELL_M);
        Some(dzdx.hypot(dzdy).atan().to_degrees() as f32)
    };

    let distances = skyline::fast_distances();
    let cells: Vec<(f32, bool, bool, bool, f32, bool)> = (0..w * h)
        .into_par_iter()
        .map(|i| {
            let (x, y) = g.centre(i);
            let slope = slope_at(i % w, i / w);
            let Ok(near_sky) = skyline::fast_skyline(near, x, y, EYE_HEIGHT_M, &distances) else {
                return (0.0, false, false, false, f32::NAN, false);
            };
            let merged = skyline::merge(&near_sky, sky.far72);
            let slope_v = slope.unwrap_or(f32::NAN);
            let passable = slope.is_some_and(|s| (s as f64) <= cfg.max_slope_deg);
            (
                skyline::blocked_fraction(&merged),
                skyline::visible(&merged, sky.sun.0, sky.sun.1),
                skyline::visible(&merged, sky.earth.0, sky.earth.1),
                base_link(near, x, y, sky.base),
                slope_v,
                passable,
            )
        })
        .collect();
    for (i, c) in cells.into_iter().enumerate() {
        (g.blocked[i], g.sunlit[i], g.earth_link[i], g.base_link[i], g.slope[i], g.passable[i]) = c;
    }
    g
}

/// Shelter points: groups of touching candidate cells (blocked >= min, slope <= max,
/// passable) of at least 3 cells; the most blocked cell of each group.
pub fn find_shelters(g: &PlanGrid, cfg: &PlannerConfig) -> Vec<usize> {
    let candidate: Vec<bool> = (0..g.len())
        .map(|i| {
            g.passable[i] && g.blocked[i] as f64 >= cfg.open_blocked + cfg.shelter_extra_blocked && (g.slope[i] as f64) <= cfg.shelter_max_slope_deg
        })
        .collect();
    let mut seen = vec![false; g.len()];
    let mut out = Vec::new();
    for start in 0..g.len() {
        if !candidate[start] || seen[start] {
            continue;
        }
        let (mut group, mut queue) = (Vec::new(), VecDeque::from([start]));
        seen[start] = true;
        while let Some(i) = queue.pop_front() {
            group.push(i);
            for (j, _) in g.neighbours(i) {
                if candidate[j] && !seen[j] {
                    seen[j] = true;
                    queue.push_back(j);
                }
            }
        }
        if group.len() >= SHELTER_MIN_CELLS {
            out.push(*group.iter().max_by(|&&a, &&b| g.blocked[a].total_cmp(&g.blocked[b])).unwrap());
        }
    }
    out
}

/// Min-heap entry ordered by cost.
#[derive(PartialEq)]
struct Entry(f64, usize);
impl Eq for Entry {}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.total_cmp(&self.0).then_with(|| other.1.cmp(&self.1))
    }
}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Per cell: walking minutes to its refuge (without handicap), path metres,
/// which refuge, and the next cell towards it. Unreachable cells have
/// infinite minutes and no refuge.
pub struct RefugeField {
    pub minutes: Vec<f64>,
    pub metres: Vec<f64>,
    pub refuge: Vec<Option<usize>>,
    pub next: Vec<Option<usize>>,
}

impl RefugeField {
    /// Cells from `start` to its refuge, following the pointers (start included).
    pub fn route_from(&self, start: usize) -> Vec<usize> {
        let mut path = vec![start];
        let mut i = start;
        while let Some(j) = self.next[i] {
            path.push(j);
            i = j;
            if path.len() > self.next.len() {
                break; // cannot happen with a correct search; guards against a loop
            }
        }
        path
    }
}

/// One multi-source search over walking time. `sources` are (cell, handicap minutes)
/// per refuge; the handicap orders the search but is not counted in `minutes`.
pub fn refuge_field(g: &PlanGrid, sources: &[(usize, f64)], cfg: &PlannerConfig) -> RefugeField {
    let n = g.len();
    let mut key = vec![f64::INFINITY; n];
    let mut field = RefugeField { minutes: vec![f64::INFINITY; n], metres: vec![f64::INFINITY; n], refuge: vec![None; n], next: vec![None; n] };
    let mut done = vec![false; n];
    let mut heap = BinaryHeap::new();
    for (r, &(cell, handicap)) in sources.iter().enumerate() {
        if handicap < key[cell] {
            key[cell] = handicap;
            field.minutes[cell] = 0.0;
            field.metres[cell] = 0.0;
            field.refuge[cell] = Some(r);
            field.next[cell] = None;
            heap.push(Entry(handicap, cell));
        }
    }
    while let Some(Entry(k, i)) = heap.pop() {
        if done[i] || k > key[i] {
            continue;
        }
        done[i] = true;
        for (j, dist) in g.neighbours(i) {
            let step = g.step_minutes(i, j, dist, cfg);
            if k + step < key[j] {
                key[j] = k + step;
                field.minutes[j] = field.minutes[i] + step;
                field.metres[j] = field.metres[i] + dist;
                field.refuge[j] = field.refuge[i];
                field.next[j] = Some(i);
                heap.push(Entry(key[j], j));
            }
        }
    }
    field
}

/// A* from `start` to `goal`. Each move costs its walking minutes times `mult` of the cell entered.
pub fn astar(g: &PlanGrid, start: usize, goal: usize, cfg: &PlannerConfig, mult: impl Fn(usize) -> f64) -> Option<Vec<usize>> {
    let n = g.len();
    let min_per_m = 1.0 / cfg.walk_speed / 60.0; // the cheapest possible move: flat ground, multiplier 1
    let (gx, gy) = g.centre(goal);
    let heuristic = |i: usize| {
        let (x, y) = g.centre(i);
        (x - gx).hypot(y - gy) * min_per_m
    };
    let mut cost = vec![f64::INFINITY; n];
    let mut prev: Vec<Option<usize>> = vec![None; n];
    let mut heap = BinaryHeap::new();
    cost[start] = 0.0;
    heap.push(Entry(heuristic(start), start));
    while let Some(Entry(_, i)) = heap.pop() {
        if i == goal {
            let mut path = vec![goal];
            while let Some(p) = prev[*path.last().unwrap()] {
                path.push(p);
            }
            path.reverse();
            return Some(path);
        }
        for (j, dist) in g.neighbours(i) {
            let c = cost[i] + g.step_minutes(i, j, dist, cfg) * mult(j);
            if c < cost[j] {
                cost[j] = c;
                prev[j] = Some(i);
                heap.push(Entry(c + heuristic(j), j));
            }
        }
    }
    None
}

/// Relative dose rate at a point with this blocked-sky fraction.
pub fn dose_rate(blocked: f64, cfg: &PlannerConfig) -> f64 {
    (1.0 - cfg.dose_shielding_factor * (blocked - cfg.open_blocked)).clamp(0.5, 1.05)
}

/// Dose fraction at each point along a route: starts at `start`, adds the mean rate of
/// each leg times its minutes times `multiplier`, divided by `budget`, clamped to 0..1.
pub fn accumulate_dose(rates: &[f64], minutes: &[f64], start: f64, multiplier: f64, budget: f64) -> Vec<f64> {
    let mut out = Vec::with_capacity(rates.len());
    let mut dose = start;
    for i in 0..rates.len() {
        if i > 0 {
            let dt = (minutes[i] - minutes[i - 1]).max(0.0);
            dose += 0.5 * (rates[i] + rates[i - 1]) * multiplier * dt / budget;
        }
        out.push(dose.clamp(0.0, 1.0));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skyline::FAST_DIRS;

    fn cfg() -> PlannerConfig {
        PlannerConfig {
            walk_speed: 0.8,
            max_slope_deg: 25.0,
            shelter_extra_blocked: 0.09,
            shelter_max_slope_deg: 15.0,
            minutes_to_shelter_limit: 5.0,
            waypoint_spacing: 15.0,
            open_blocked: 0.06,
            dose_shielding_factor: 0.5,
            oxygen_minutes: 480.0,
        }
    }

    fn square(size_m: f64) -> Bounds {
        Bounds { x_min: 0.0, x_max: size_m, y_min: 0.0, y_max: size_m }
    }

    #[test]
    fn astar_goes_round_a_wall() {
        // 100 m square; an impassable wall along x = 50 m from y = 0 to 80 m.
        let mut g = PlanGrid::blank(square(100.0));
        for i in 0..g.len() {
            let (x, y) = g.centre(i);
            if (x - 51.0).abs() < 1.5 && y < 80.0 {
                g.passable[i] = false;
            }
        }
        let (start, goal) = (g.cell_at(20.0, 10.0).unwrap(), g.cell_at(80.0, 10.0).unwrap());
        let path = astar(&g, start, goal, &cfg(), |_| 1.0).expect("a path round the wall");
        assert_eq!((path[0], *path.last().unwrap()), (start, goal));
        assert!(path.iter().all(|&i| g.passable[i]), "path crosses the wall");
        let highest = path.iter().map(|&i| g.centre(i).1).fold(0.0, f64::max);
        assert!(highest >= 80.0, "path should go over the wall's end at y 80, went to {highest}");
    }

    #[test]
    fn minutes_to_refuge_on_flat_ground_is_distance_over_speed() {
        let c = cfg();
        let g = PlanGrid::blank(square(200.0));
        let refuge = g.cell_at(101.0, 101.0).unwrap();
        let field = refuge_field(&g, &[(refuge, 0.0)], &c);
        for (x, y) in [(161.0, 101.0), (101.0, 21.0), (141.0, 141.0), (61.0, 61.0)] {
            let i = g.cell_at(x, y).unwrap();
            let dist = (x - 101.0f64).hypot(y - 101.0);
            let expected = dist / c.walk_speed / 60.0;
            assert!((field.minutes[i] - expected).abs() < 1e-9, "({x}, {y}): {} vs {expected}", field.minutes[i]);
            assert!((field.metres[i] - dist).abs() < 1e-9);
        }
    }

    #[test]
    fn handicap_prefers_a_linked_refuge_when_nearly_as_close() {
        let c = cfg();
        let g = PlanGrid::blank(square(200.0));
        let (a, b) = (g.cell_at(51.0, 101.0).unwrap(), g.cell_at(151.0, 101.0).unwrap());
        // A point 4 m nearer to b. b has a 1 minute handicap (about 48 m at 0.8 m/s), so a wins.
        let field = refuge_field(&g, &[(a, 0.0), (b, 1.0)], &c);
        let p = g.cell_at(103.0, 101.0).unwrap();
        assert_eq!(field.refuge[p], Some(0));
        // The reported minutes leave the handicap out: right next to b, b wins with ~0 minutes.
        let q = g.cell_at(149.0, 101.0).unwrap();
        assert_eq!(field.refuge[q], Some(1));
        assert!(field.minutes[q] < 0.1);
    }

    #[test]
    fn every_emergency_route_ends_at_a_refuge() {
        let c = cfg();
        let mut g = PlanGrid::blank(square(120.0));
        for i in 0..g.len() {
            let (x, y) = g.centre(i);
            g.slope[i] = ((x * 0.1).sin() * 10.0 + 10.0) as f32; // varied walking cost
            if (x - 61.0).abs() < 1.5 && (20.0..100.0).contains(&y) {
                g.passable[i] = false;
            }
        }
        let refuges = [g.cell_at(11.0, 11.0).unwrap(), g.cell_at(101.0, 101.0).unwrap(), g.cell_at(61.0, 111.0).unwrap()];
        let sources: Vec<(usize, f64)> = refuges.iter().enumerate().map(|(k, &r)| (r, if k == 2 { 1.0 } else { 0.0 })).collect();
        let field = refuge_field(&g, &sources, &c);
        for i in (0..g.len()).filter(|&i| g.passable[i]) {
            let route = field.route_from(i);
            let end = *route.last().unwrap();
            let r = field.refuge[i].expect("every passable cell reaches a refuge here");
            assert_eq!(end, refuges[r], "cell {i} ends at {end}, not its refuge");
            assert!(route.len() <= g.len());
            // Minutes fall along the route.
            assert!(route.windows(2).all(|w| field.minutes[w[1]] <= field.minutes[w[0]]));
        }
    }

    #[test]
    fn synthetic_butte_gives_a_shelter_at_its_foot() {
        // 1 m terrain, 300 m square, with a 15 m butte of radius 30 m in the middle (steep 3 m flank).
        let size = 300usize;
        let mut data = Vec::with_capacity(size * size);
        for row in 0..size {
            for col in 0..size {
                let (x, y) = (col as f64 + 0.5, (size - row) as f64 - 0.5);
                let r = (x - 150.0).hypot(y - 150.0);
                data.push(if r <= 30.0 { 15.0 } else if r < 33.0 { 15.0 * (33.0 - r) / 3.0 } else { 0.0 } as f32);
            }
        }
        let near = Grid::synthetic(size, size, data, 1.0);
        let far = vec![-90.0f32; FAST_DIRS];
        let base = Base { x: 20.0, y: 20.0, mast_height_m: 10.0 };
        let sky = SiteSky { far72: &far, sun: (270.0, 30.0), earth: (90.0, 40.0), base: &base };
        let c = cfg();
        let g = build(&near, &sky, Bounds { x_min: 90.0, x_max: 210.0, y_min: 90.0, y_max: 210.0 }, &c);
        let shelters = find_shelters(&g, &c);
        assert!(!shelters.is_empty(), "no shelter found");
        for &s in &shelters {
            let (x, y) = g.centre(s);
            let r = (x - 150.0).hypot(y - 150.0);
            assert!((33.0..45.0).contains(&r), "shelter at ({x}, {y}) is {r:.1} m from the centre, not at the foot");
        }
    }

    #[test]
    fn dose_never_decreases() {
        let c = cfg();
        let blocked = [0.02, 0.3, 0.6, 0.1, 0.0, 0.25, 0.9];
        let rates: Vec<f64> = blocked.iter().map(|&b| dose_rate(b, &c)).collect();
        assert!(rates.iter().all(|&r| (0.5..=1.05).contains(&r)));
        let minutes = [0.0, 1.0, 1.0, 2.5, 4.0, 4.1, 9.0];
        for mult in [1.0, 2.0] {
            let dose = accumulate_dose(&rates, &minutes, 0.1, mult, 20.0);
            assert!(dose.windows(2).all(|w| w[1] >= w[0]), "{dose:?}");
            assert_eq!(dose[0], 0.1);
        }
    }
}

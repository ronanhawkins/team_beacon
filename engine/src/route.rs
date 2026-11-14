//! The main route, waypoints, storm reroutes and output files (shared/waypoints.md).

use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;
use serde_json::{json, Map, Value};

use crate::decision::{self, Candidate, Decision, Kind, Scored, StormConfig};
use crate::layers::{self, Base};
use crate::planner::{self, Bounds, PlanGrid, PlannerConfig, RefugeField, SiteSky};
use crate::sight::line_of_sight;
use crate::skyline;
use crate::terrain::Grid;

const EYE_HEIGHT_M: f64 = 1.0;
const SHELTER_RADIUS_M: f64 = 3.0;
const CONTRACT_SAMPLES: usize = 72;
const MINUTES_LAYER_MAX: f64 = 30.0;
// Precise waypoint skylines: as in `check`, out to where the far field starts.
const PRECISE_DIRS: usize = 360;
const PRECISE_STEP_M: f64 = 0.5;
const PRECISE_MAX_M: f64 = 700.0;
/// rerouteInfo lists every candidate within this many walking minutes.
const OPTIONS_WITHIN_MINUTES: f64 = 12.0;

pub struct Stop {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub science: bool,
}

pub struct PlanInputs<'a> {
    pub near: &'a Grid,
    pub far72: &'a [f32],
    pub far360: &'a [f32],
    pub sun: (f64, f64),
    pub earth: (f64, f64),
    pub base: Base,
    pub bounds: Bounds,
    pub cfg: PlannerConfig,
    pub storm: StormConfig,
    /// Dose rate inside the base (a shielded habitat), relative to open ground.
    pub base_dose_factor: f64,
    /// Measured quiet open-ground dose rate in microgray per hour (Curiosity RAD), when known.
    /// Adds the microgray fields to the outputs.
    pub dose_rate_ugy_h: Option<f64>,
    /// DONKI forecasts for the briefing (space.rs), when known.
    pub space_weather: Option<Value>,
    /// REMS conditions for the briefing (rems.rs), when known.
    pub conditions: Option<Value>,
    pub stops: Vec<Stop>,
}

/// The doseFraction budget is set so the largest doseFraction over every route is this.
const LARGEST_DOSE_FRACTION: f64 = 0.9;

pub struct Refuge {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub cell: usize,
    pub is_base: bool,
}

/// The planning grid, refuges (index 0 is the base) and plain walking minutes to the nearest refuge.
pub struct Context {
    pub g: PlanGrid,
    pub refuges: Vec<Refuge>,
    pub base_cell: usize,
    pub nearest: RefugeField,
    pub shelter_count: usize,
}

/// Candidate sites from one position, with the refuge each one is.
pub struct Options {
    pub candidates: Vec<Candidate>,
    /// Refuge index for each candidate (index 0 is the base).
    pub refuge_of: Vec<usize>,
    /// Walking field from the position: minutes and metres to every cell, pointers back to the position.
    pub walk: RefugeField,
}

/// A planned point before it is described: position, minutes from start, and stop index if it is a stop.
#[derive(Clone)]
struct PlanPoint {
    x: f64,
    y: f64,
    minutes: f64,
    stop: Option<usize>,
}

/// Everything about a position that does not depend on the route.
struct Desc {
    z: f64,
    sky72: Vec<f64>,
    blocked: f64,
    sun_visible: bool,
    earth_visible: bool,
    base_az: f64,
    base_dist: f64,
    base_visible: bool,
}

fn bearing(from: (f64, f64), to: (f64, f64)) -> f64 {
    (to.0 - from.0).atan2(to.1 - from.1).to_degrees().rem_euclid(360.0)
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    (b.0 - a.0).hypot(b.1 - a.1)
}

fn r(v: f64, decimals: i32) -> f64 {
    let f = 10f64.powi(decimals);
    (v * f).round() / f
}

/// The point a stop is routed through: itself if its cell is passable, else the nearest passable cell centre.
fn snap(g: &PlanGrid, x: f64, y: f64) -> Result<(usize, (f64, f64), f64), String> {
    if let Some(i) = g.cell_at(x, y).filter(|&i| g.passable[i]) {
        return Ok((i, (x, y), 0.0));
    }
    let (i, d) = g.nearest_passable(x, y).ok_or("no passable cell in the planner bounds")?;
    Ok((i, g.centre(i), d))
}

/// 5-point moving average with both ends fixed; points that land on impassable cells are put back.
fn smooth(g: &PlanGrid, pts: &[(f64, f64)]) -> (Vec<(f64, f64)>, usize) {
    let n = pts.len();
    let mut out = pts.to_vec();
    let mut reverted = 0;
    for i in 1..n.saturating_sub(1) {
        let (lo, hi) = (i.saturating_sub(2), (i + 2).min(n - 1));
        let k = (hi - lo + 1) as f64;
        let p = (pts[lo..=hi].iter().map(|p| p.0).sum::<f64>() / k, pts[lo..=hi].iter().map(|p| p.1).sum::<f64>() / k);
        if g.cell_at(p.0, p.1).is_some_and(|c| g.passable[c]) {
            out[i] = p;
        } else {
            reverted += 1;
        }
    }
    (out, reverted)
}

/// Points every ~`spacing` metres along a polyline (equal pieces, both ends included):
/// (x, y, interpolated time, distance along the polyline).
fn resample(pts: &[(f64, f64)], times: &[f64], spacing: f64) -> Vec<(f64, f64, f64, f64)> {
    let mut cum = vec![0.0];
    for w in pts.windows(2) {
        cum.push(cum.last().unwrap() + dist(w[0], w[1]));
    }
    let total = *cum.last().unwrap();
    if pts.len() == 1 {
        return vec![(pts[0].0, pts[0].1, times[0], 0.0)];
    }
    let n = ((total / spacing).round() as usize).max(1);
    let mut out = Vec::with_capacity(n + 1);
    let mut seg = 0;
    for j in 0..=n {
        let s = total * j as f64 / n as f64;
        while seg + 1 < pts.len() - 1 && cum[seg + 1] < s {
            seg += 1;
        }
        let len = cum[seg + 1] - cum[seg];
        let t = if len > 0.0 { ((s - cum[seg]) / len).clamp(0.0, 1.0) } else { 0.0 };
        let lerp = |a: f64, b: f64| a + (b - a) * t;
        out.push((lerp(pts[seg].0, pts[seg + 1].0), lerp(pts[seg].1, pts[seg + 1].1), lerp(times[seg], times[seg + 1]), s));
    }
    out
}

fn describe(inp: &PlanInputs, x: f64, y: f64) -> Result<Desc, String> {
    let near_sky = skyline::skyline(inp.near, x, y, EYE_HEIGHT_M, PRECISE_DIRS, PRECISE_STEP_M, PRECISE_MAX_M)?;
    let merged = skyline::merge(&near_sky, inp.far360);
    let z = inp.near.sample_local(x, y).ok_or("waypoint on no-data")? as f64;
    Ok(Desc {
        z,
        sky72: skyline::resample(&merged, CONTRACT_SAMPLES).iter().map(|&a| r(a as f64, 1)).collect(),
        blocked: skyline::blocked_fraction(&merged) as f64,
        sun_visible: skyline::visible(&merged, inp.sun.0, inp.sun.1),
        earth_visible: skyline::visible(&merged, inp.earth.0, inp.earth.1),
        base_az: bearing((x, y), (inp.base.x, inp.base.y)),
        base_dist: dist((x, y), (inp.base.x, inp.base.y)),
        base_visible: dist((x, y), (inp.base.x, inp.base.y)) < 0.5
            || line_of_sight(inp.near, (x, y), EYE_HEIGHT_M, (inp.base.x, inp.base.y), inp.base.mast_height_m, 1.0),
    })
}

fn headings(pts: &[PlanPoint], fallback: f64) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::with_capacity(pts.len());
    for i in 0..pts.len() {
        if i + 1 < pts.len() && dist((pts[i].x, pts[i].y), (pts[i + 1].x, pts[i + 1].y)) > 1e-6 {
            out.push(bearing((pts[i].x, pts[i].y), (pts[i + 1].x, pts[i + 1].y)));
        } else {
            out.push(out.last().copied().unwrap_or(fallback));
        }
    }
    out
}

/// Builds the planning grid, finds shelters (stopping if there are fewer than 4 or more than 40),
/// and computes plain walking minutes to the nearest refuge of any kind.
pub fn prepare(inp: &PlanInputs) -> Result<Context, String> {
    let cfg = &inp.cfg;
    let started = Instant::now();
    let site_sky = SiteSky { far72: inp.far72, sun: inp.sun, earth: inp.earth, base: &inp.base };
    let g = planner::build(inp.near, &site_sky, inp.bounds, cfg);
    let b = inp.bounds;
    println!(
        "Planning grid: {} x {} cells of {} m over x {}..{}, y {}..{}; {} passable; built in {:.2} s",
        g.w, g.h, planner::CELL_M, b.x_min, b.x_max, b.y_min, b.y_max,
        g.passable.iter().filter(|&&p| p).count(), started.elapsed().as_secs_f64()
    );
    let shelter_cells = planner::find_shelters(&g, cfg);
    println!(
        "Shelters found: {} (blocked >= {} + {} = {:.3}, slope <= {} deg, groups of 3+ cells)",
        shelter_cells.len(), cfg.open_blocked, cfg.shelter_extra_blocked, cfg.open_blocked + cfg.shelter_extra_blocked, cfg.shelter_max_slope_deg
    );
    if shelter_cells.len() < 4 || shelter_cells.len() > 40 {
        return Err(format!(
            "{} shelters is outside the expected 4 to 40. Stopping without tuning the threshold; change the planner values in data/site.json deliberately",
            shelter_cells.len()
        ));
    }
    let (base_cell, base_pt, _) = snap(&g, inp.base.x, inp.base.y)?;
    let mut refuges = vec![Refuge { id: "base".into(), x: base_pt.0, y: base_pt.1, cell: base_cell, is_base: true }];
    for (k, &c) in shelter_cells.iter().enumerate() {
        let (x, y) = g.centre(c);
        refuges.push(Refuge { id: format!("s{:02}", k + 1), x, y, cell: c, is_base: false });
    }
    let sources: Vec<(usize, f64)> = refuges.iter().map(|rf| (rf.cell, 0.0)).collect();
    let nearest = planner::refuge_field(&g, &sources, cfg);
    Ok(Context { g, refuges, base_cell, nearest, shelter_count: shelter_cells.len() })
}

/// Candidate sites from a position: the base and every shelter, with walking minutes.
pub fn options_from(ctx: &Context, inp: &PlanInputs, x: f64, y: f64) -> Result<Options, String> {
    let g = &ctx.g;
    let start = g.cell_at(x, y).filter(|&c| g.passable[c]).ok_or_else(|| format!("({x:.1}, {y:.1}) is not on passable ground inside the planner bounds"))?;
    let walk = planner::refuge_field(g, &[(start, 0.0)], &inp.cfg);
    let (mut candidates, mut refuge_of) = (Vec::new(), Vec::new());
    for (k, rf) in ctx.refuges.iter().enumerate() {
        let t = walk.minutes[rf.cell];
        if !t.is_finite() {
            continue;
        }
        let blocked = g.blocked[rf.cell] as f64;
        candidates.push(Candidate {
            id: rf.id.clone(),
            kind: if rf.is_base { Kind::Base } else { Kind::Shelter },
            t,
            blocked,
            f: if rf.is_base {
                inp.base_dose_factor
            } else {
                decision::site_factor(blocked, inp.cfg.dose_shielding_factor, inp.cfg.open_blocked)
            },
            base_link: rf.is_base || g.base_link[rf.cell],
        });
        refuge_of.push(k);
    }
    if candidates.is_empty() {
        return Err(format!("no refuge reachable from ({x:.1}, {y:.1})"));
    }
    Ok(Options { candidates, refuge_of, walk })
}

fn option_json(s: &Scored) -> Value {
    let c = &s.candidate;
    json!({
        "id": c.id, "kind": c.kind.as_str(), "minutes": r(c.t, 2), "blocked": r(c.blocked, 3),
        "baseLink": c.base_link, "reachable": s.reachable, "score": r(s.score, 1),
    })
}

/// The chosen site, every option within OPTIONS_WITHIN_MINUTES, and the base's walking time.
fn reroute_info(d: &Decision, s: &StormConfig) -> Value {
    let mut chosen = option_json(&d.chosen);
    chosen["dose"] = json!(r(d.chosen.dose, 1));
    chosen["late"] = json!(d.minutes_late.is_some());
    if let Some(late) = d.minutes_late {
        chosen["minutesLate"] = json!(r(late, 2));
    }
    let options: Vec<Value> = d.ranked.iter().filter(|o| o.candidate.t <= OPTIONS_WITHIN_MINUTES).map(option_json).collect();
    let base = d.ranked.iter().find(|o| o.candidate.kind == Kind::Base).map(|b| {
        json!({ "minutes": r(b.candidate.t, 2), "excludedByLimit": b.candidate.t > s.max_minutes_to_cover })
    });
    json!({ "chosen": chosen, "options": options, "base": base })
}

/// Prints the scored table for one position.
pub fn print_table(d: &Decision, storm: &StormConfig) {
    println!(
        "Lead {} min, limit {} min to cover, storm {} min, multiplier {}, no-link penalty {}\n",
        storm.lead_minutes, storm.max_minutes_to_cover, storm.storm_minutes, storm.dose_multiplier, storm.no_link_penalty
    );
    println!("  {:<6} {:<8} {:>7} {:>8} {:>6} {:>5} {:>6} {:>8} {:>8} {:>8} {:>8} {:>8}", "id", "kind", "t min", "blocked", "f", "link", "in time", "walking", "waiting", "storm", "dose", "score");
    for s in &d.ranked {
        let c = &s.candidate;
        let mark = if c.id == d.chosen.candidate.id { ">" } else { " " };
        println!(
            "{mark} {:<6} {:<8} {:>7.2} {:>8.3} {:>6.3} {:>5} {:>6} {:>8.1} {:>8.1} {:>8.1} {:>8.1} {:>8.1}",
            c.id, c.kind.as_str(), c.t, c.blocked, c.f, if c.base_link { "yes" } else { "-" }, if s.reachable { "yes" } else { "-" },
            s.walking, s.waiting, s.storm, s.dose, s.score
        );
    }
    match d.minutes_late {
        Some(late) => println!("\nNothing reachable within {} min: nearest is {}, {:.2} min late", storm.max_minutes_to_cover, d.chosen.candidate.id, late),
        None => println!("\nChosen: {} ({}), {:.2} min", d.chosen.candidate.id, d.chosen.candidate.kind.as_str(), d.chosen.candidate.t),
    }
}

/// Builds the plan and writes waypoints.json, shelters.json, briefing.json and the minutesToShelter layer into `out_dir`.
pub fn run(inp: &PlanInputs, out_dir: &Path) -> Result<(), String> {
    let cfg = &inp.cfg;
    let started = Instant::now();
    let ctx = prepare(inp)?;
    let (g, refuges, field) = (&ctx.g, &ctx.refuges, &ctx.nearest);

    // Main route: snap, A* between consecutive stops, smooth.
    let snapped: Vec<(usize, (f64, f64), f64)> = inp.stops.iter().map(|s| snap(g, s.x, s.y)).collect::<Result<_, _>>()?;
    let limit = cfg.minutes_to_shelter_limit;
    let mult = |j: usize| {
        1.0 + if g.base_link[j] { 0.0 } else { 1.0 } + if g.sunlit[j] { 0.0 } else { 0.2 } + if field.minutes[j] > limit { 0.5 } else { 0.0 }
    };
    let mut legs: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut reverted = 0;
    for k in 1..inp.stops.len() {
        let path = planner::astar(g, snapped[k - 1].0, snapped[k].0, cfg, mult)
            .ok_or_else(|| format!("no passable route from {} to {}", inp.stops[k - 1].id, inp.stops[k].id))?;
        let mut pts: Vec<(f64, f64)> = path.iter().map(|&i| g.centre(i)).collect();
        if pts.len() == 1 {
            pts.push(pts[0]);
        }
        pts[0] = snapped[k - 1].1;
        *pts.last_mut().unwrap() = snapped[k].1;
        let (smoothed, n) = smooth(g, &pts);
        reverted += n;
        legs.push(smoothed);
    }

    // Walking minutes along each leg, then resample every waypointSpacing with stops kept.
    let per_metre = |x: f64, y: f64| g.cell_at(x, y).filter(|&c| g.passable[c]).map_or(1.0 / cfg.walk_speed / 60.0, |c| g.minutes_per_metre(c, cfg));
    let mut main_pts: Vec<PlanPoint> = vec![PlanPoint { x: snapped[0].1.0, y: snapped[0].1.1, minutes: 0.0, stop: Some(0) }];
    let mut route_len = 0.0;
    for (k, leg) in legs.iter().enumerate() {
        let mut times = vec![main_pts.last().unwrap().minutes];
        for w in leg.windows(2) {
            let mid = ((w[0].0 + w[1].0) / 2.0, (w[0].1 + w[1].1) / 2.0);
            times.push(times.last().unwrap() + dist(w[0], w[1]) * per_metre(mid.0, mid.1));
            route_len += dist(w[0], w[1]);
        }
        let samples = resample(leg, &times, cfg.waypoint_spacing);
        for (j, &(x, y, t, _)) in samples.iter().enumerate().skip(1) {
            main_pts.push(PlanPoint { x, y, minutes: t, stop: (j == samples.len() - 1).then_some(k + 1) });
        }
    }

    // Storm decision and reroute from every main waypoint.
    struct Reroute {
        pts: Vec<PlanPoint>,
        /// Path metres still to walk at each point.
        remaining_m: Vec<f64>,
        total_minutes: f64,
        refuge: usize,
        kind: Kind,
        id: String,
        minutes_late: Option<f64>,
        info: Value,
        /// The decision's dose at the chosen site (walking, waiting and the storm), open-ground minutes.
        storm_dose: f64,
    }
    let mut reroutes_plan: Vec<Reroute> = Vec::new();
    for p in &main_pts {
        let opts = options_from(&ctx, inp, p.x, p.y)?;
        let decision = decision::decide(&opts.candidates, &inp.storm);
        let best = &decision.chosen;
        let idx = opts.candidates.iter().position(|c| c.id == best.candidate.id).unwrap();
        let rf = opts.refuge_of[idx];
        let target_cell = refuges[rf].cell;
        let target = (refuges[rf].x, refuges[rf].y);
        let (walk_min, walk_m) = (opts.walk.minutes[target_cell], opts.walk.metres[target_cell]);
        let (pts, remaining_m) = if walk_min == 0.0 || dist((p.x, p.y), target) < SHELTER_RADIUS_M {
            (vec![PlanPoint { stop: None, ..p.clone() }], vec![0.0])
        } else {
            // The walk field points back towards this waypoint, so follow it from the target and reverse.
            let mut cells = opts.walk.route_from(target_cell);
            cells.reverse();
            let mut poly = vec![(p.x, p.y)];
            let mut times = vec![p.minutes];
            for &c in &cells[1..cells.len() - 1] {
                poly.push(g.centre(c));
                times.push(p.minutes + opts.walk.minutes[c]);
            }
            poly.push(target);
            times.push(p.minutes + walk_min);
            let samples = resample(&poly, &times, cfg.waypoint_spacing);
            let along_total = samples.last().unwrap().3.max(1e-9);
            (
                samples.iter().map(|&(x, y, t, _)| PlanPoint { x, y, minutes: t, stop: None }).collect(),
                samples.iter().map(|&(_, _, _, s)| walk_m * (1.0 - s / along_total)).collect(),
            )
        };
        reroutes_plan.push(Reroute {
            pts,
            remaining_m,
            total_minutes: walk_min,
            refuge: rf,
            kind: best.candidate.kind,
            id: best.candidate.id.clone(),
            minutes_late: decision.minutes_late,
            info: reroute_info(&decision, &inp.storm),
            storm_dose: decision.chosen.dose,
        });
    }

    // Describe every point in parallel (main first, then reroutes in order).
    let all: Vec<(f64, f64)> = main_pts.iter().map(|p| (p.x, p.y)).chain(reroutes_plan.iter().flat_map(|rr| rr.pts.iter().map(|p| (p.x, p.y)))).collect();
    let descs: Vec<Desc> = all.par_iter().map(|&(x, y)| describe(inp, x, y)).collect::<Result<_, _>>()?;
    let (main_descs, mut rest) = (&descs[..main_pts.len()], &descs[main_pts.len()..]);

    let near_refuge = |x: f64, y: f64| refuges.iter().any(|rf| dist((x, y), (rf.x, rf.y)) <= SHELTER_RADIUS_M);
    let shelter_json = |id: &str, x: f64, y: f64, target: (f64, f64), metres: f64, minutes: f64, heading: f64| -> Value {
        let az = if dist((x, y), target) < 0.5 { heading } else { bearing((x, y), target) };
        json!({ "id": id, "az": r(az, 1), "distance": r(metres, 1), "minutes": r(minutes, 2) })
    };
    // Doses in minutes at the open-ground rate: the main route at the normal rate, each reroute
    // from its main waypoint's dose at the storm multiplier. The budget makes the largest 0.9.
    let total_minutes = main_pts.last().unwrap().minutes;
    let main_rates: Vec<f64> = main_descs.iter().map(|d| planner::dose_rate(d.blocked, cfg)).collect();
    let main_minutes: Vec<f64> = main_pts.iter().map(|p| p.minutes).collect();
    let main_dose = planner::accumulate_dose(&main_rates, &main_minutes, 0.0, 1.0);
    let mut reroute_descs: Vec<&[Desc]> = Vec::new();
    let mut reroute_dose: Vec<Vec<f64>> = Vec::new();
    for (k, rr) in reroutes_plan.iter().enumerate() {
        let (d_here, d_rest) = rest.split_at(rr.pts.len());
        rest = d_rest;
        let rates: Vec<f64> = d_here.iter().map(|d| planner::dose_rate(d.blocked, cfg)).collect();
        let minutes: Vec<f64> = rr.pts.iter().map(|p| p.minutes).collect();
        reroute_dose.push(planner::accumulate_dose(&rates, &minutes, main_dose[k], inp.storm.dose_multiplier));
        reroute_descs.push(d_here);
    }
    let largest = main_dose.iter().chain(reroute_dose.iter().flatten()).fold(0.0f64, |a, &b| a.max(b));
    let budget = (largest / LARGEST_DOSE_FRACTION).max(1e-6);
    let ugy = |dose: f64| inp.dose_rate_ugy_h.map(|rate| r(dose * rate / 60.0, 1));

    let waypoint = |id: String, label: &str, p: &PlanPoint, d: &Desc, heading: f64, shelter: Value, dose: f64, is_shelter: bool, science: bool| -> Value {
        let mut w = json!({
            "id": id,
            "label": label,
            "pos": { "x": r(p.x, 2), "y": r(p.y, 2), "z": r(d.z, 2) },
            "headingDeg": r(heading, 1),
            "skyline": d.sky72,
            "openSky": r(1.0 - d.blocked, 3),
            "sun": { "az": inp.sun.0, "el": inp.sun.1, "visible": d.sun_visible },
            "earth": { "az": inp.earth.0, "el": inp.earth.1, "visible": d.earth_visible },
            "base": { "az": r(d.base_az, 1), "distance": r(d.base_dist, 1), "visible": d.base_visible },
            "shelter": shelter,
            "minutesFromStart": r(p.minutes, 2),
            "doseFraction": r((dose / budget).clamp(0.0, 1.0), 4),
            "oxygenFraction": r((1.0 - p.minutes / cfg.oxygen_minutes).clamp(0.0, 1.0), 4),
            "isShelter": is_shelter,
            "isScienceStop": science,
        });
        if let Some(v) = ugy(dose) {
            w["doseMicroGray"] = json!(v);
        }
        w
    };

    // Main waypoints with dose; each one's shelter is the model's choice from there.
    let main_head = headings(&main_pts, 0.0);
    let mut main_json = Vec::new();
    for (i, p) in main_pts.iter().enumerate() {
        let rr = &reroutes_plan[i];
        let target = (refuges[rr.refuge].x, refuges[rr.refuge].y);
        let stop = p.stop.map(|s| &inp.stops[s]);
        main_json.push(waypoint(
            format!("m{i:02}"),
            stop.map_or("", |s| s.label.as_str()),
            p,
            &main_descs[i],
            main_head[i],
            shelter_json(&rr.id, p.x, p.y, target, rr.remaining_m[0], rr.total_minutes, main_head[i]),
            main_dose[i],
            near_refuge(p.x, p.y),
            stop.is_some_and(|s| s.science),
        ));
    }

    // Reroute waypoints.
    let mut reroutes = Map::new();
    let mut info_map = Map::new();
    for (k, rr) in reroutes_plan.iter().enumerate() {
        let (d_here, dose) = (reroute_descs[k], &reroute_dose[k]);
        let head = headings(&rr.pts, main_head[k]);
        let target = (refuges[rr.refuge].x, refuges[rr.refuge].y);
        let end_label = match rr.kind {
            Kind::Base => "Base",
            Kind::Shelter => "Shelter",
        };
        let start_minutes = rr.pts[0].minutes;
        let list: Vec<Value> = rr
            .pts
            .iter()
            .enumerate()
            .map(|(j, p)| {
                let last = j == rr.pts.len() - 1;
                let left = (rr.total_minutes - (p.minutes - start_minutes)).max(0.0);
                let shelter = shelter_json(&rr.id, p.x, p.y, target, if last { 0.0 } else { rr.remaining_m[j] }, if last { 0.0 } else { left }, head[j]);
                waypoint(format!("r{k:02}-{j:02}"), if last { end_label } else { "" }, p, &d_here[j], head[j], shelter, dose[j], last || near_refuge(p.x, p.y), false)
            })
            .collect();
        reroutes.insert(k.to_string(), Value::Array(list));
        let mut info = rr.info.clone();
        if let (Some(planned), Some(storm)) = (ugy(main_dose[k]), ugy(rr.storm_dose)) {
            info["plannedDoseMicroGray"] = json!(planned);
            info["stormDoseMicroGray"] = json!(storm);
        }
        info_map.insert(k.to_string(), info);
    }

    let doc = json!({
        "version": 1, "skylineSamples": CONTRACT_SAMPLES, "main": main_json, "reroutes": reroutes, "rerouteInfo": info_map,
    });

    // shelters.json
    let shelter_list: Vec<Value> = refuges
        .iter()
        .map(|rf| {
            json!({
                "id": rf.id, "kind": if rf.is_base { "base" } else { "shelter" },
                "x": r(rf.x, 2), "y": r(rf.y, 2), "blocked": r(g.blocked[rf.cell] as f64, 3),
                "baseLink": rf.is_base || g.base_link[rf.cell], "sunlit": g.sunlit[rf.cell], "earthLink": g.earth_link[rf.cell],
            })
        })
        .collect();

    // briefing.json
    let n = main_json.len() as f64;
    let count = |key: &str| main_json.iter().filter(|w| w[key]["visible"].as_bool() == Some(true)).count() as f64 / n;
    let (worst_i, worst) = main_json
        .iter()
        .enumerate()
        .map(|(i, w)| (i, w["shelter"]["minutes"].as_f64().unwrap_or(0.0)))
        .fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
    let (storm_max_i, storm_max) = reroutes_plan.iter().enumerate().map(|(i, rr)| (i, rr.storm_dose)).fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
    let mut briefing = json!({
        "version": 1,
        "routeLengthM": r(route_len, 1),
        "minutes": r(total_minutes, 2),
        "waypoints": main_json.len(),
        "worstMinutesToRefuge": worst,
        "baseLinkFraction": r(count("base"), 3),
        "sunlitFraction": r(count("sun"), 3),
        "endDoseFraction": main_json.last().unwrap()["doseFraction"],
        "endOxygenFraction": main_json.last().unwrap()["oxygenFraction"],
        "shelterCount": ctx.shelter_count,
        "slopeAtBaseDeg": r(g.slope[ctx.base_cell] as f64, 1),
    });
    if let Some(rate) = inp.dose_rate_ugy_h {
        briefing["doseRateMicroGrayPerHour"] = json!(rate);
        briefing["plannedDoseMicroGray"] = json!(ugy(*main_dose.last().unwrap()));
        briefing["stormDoseMicroGrayMax"] = json!(ugy(storm_max));
        briefing["stormDoseMaxAt"] = json!(format!("m{storm_max_i:02}"));
        briefing["doseBudgetMicroGray"] = json!(ugy(budget));
        briefing["stormMinutes"] = json!(inp.storm.storm_minutes);
        briefing["stormDoseMultiplier"] = json!(inp.storm.dose_multiplier);
    }
    if let Some(sw) = &inp.space_weather {
        briefing["spaceWeather"] = sw.clone();
    }
    if let Some(c) = &inp.conditions {
        briefing["conditions"] = c.clone();
    }

    // Write files.
    std::fs::create_dir_all(out_dir.join("layers")).map_err(|e| format!("cannot create {}: {}", out_dir.display(), e))?;
    let write = |name: &str, v: &Value| -> Result<(), String> {
        let path = out_dir.join(name);
        std::fs::write(&path, serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("cannot write {}: {}", path.display(), e))
    };
    write("waypoints.json", &doc)?;
    write("shelters.json", &json!({ "version": 1, "refuges": shelter_list }))?;
    write("briefing.json", &briefing)?;
    write_minutes_layer(g, field, &out_dir.join("layers"))?;

    // Report.
    println!("Main route: {} legs, {} smoothed points put back on passable ground; {} waypoints; {} reroutes; done in {:.2} s\n",
        legs.len(), reverted, main_json.len(), reroutes.len(), started.elapsed().as_secs_f64());
    println!("Briefing\n{}\n", serde_json::to_string_pretty(&briefing).unwrap());
    println!(
        "Largest shelter.minutes on the main route: {worst:.2} at m{worst_i:02} ({}): {} the minutesToShelterLimit of {limit}",
        main_json[worst_i]["shelter"]["id"].as_str().unwrap_or("?"),
        if worst > limit { "EXCEEDS" } else { "within" }
    );

    println!("\nStops");
    println!("  {:<8} {:<17} {:>6} {:>8} {:>8} {:>5} {:>6} {:>9} {:>8}", "id", "label", "snap m", "minutes", "openSky", "base", "sunlit", "to refuge", "storm to");
    for (s_idx, s) in inp.stops.iter().enumerate() {
        let i = main_pts.iter().position(|p| p.stop == Some(s_idx)).unwrap();
        let w = &main_json[i];
        let c = g.cell_at(main_pts[i].x, main_pts[i].y).unwrap();
        println!(
            "  {:<8} {:<17} {:>6.2} {:>8.2} {:>8.3} {:>5} {:>6} {:>9.2} {:>8}",
            s.id, s.label, snapped[s_idx].2, w["minutesFromStart"].as_f64().unwrap(), w["openSky"].as_f64().unwrap(),
            if w["base"]["visible"] == true { "yes" } else { "-" }, if w["sun"]["visible"] == true { "yes" } else { "-" },
            field.minutes[c], w["shelter"]["id"].as_str().unwrap()
        );
    }

    println!("\nStorm choice from every main waypoint (limit {} min to cover)", inp.storm.max_minutes_to_cover);
    println!("  {:<4} {:<17} {:<6} {:<8} {:>7} {:>9}", "wp", "label", "site", "kind", "minutes", "base min");
    for (i, rr) in reroutes_plan.iter().enumerate() {
        let base_min = rr.info["base"]["minutes"].as_f64().unwrap_or(f64::NAN);
        let late = rr.minutes_late.map_or(String::new(), |l| format!("  LATE by {l:.2} min"));
        println!(
            "  m{i:02}  {:<17} {:<6} {:<8} {:>7.2} {:>9.2}{late}",
            main_json[i]["label"].as_str().unwrap_or(""), rr.id, rr.kind.as_str(), rr.total_minutes, base_min
        );
    }
    let late_count = reroutes_plan.iter().filter(|rr| rr.minutes_late.is_some()).count();
    println!("  {} of {} waypoints have a site within the limit", reroutes_plan.len() - late_count, reroutes_plan.len());
    println!("\nWrote waypoints.json, shelters.json, briefing.json and layers/minutesToShelter.png to {}", out_dir.display());
    Ok(())
}

/// minutesToShelter at layer resolution: plain walking minutes to the nearest refuge of any kind.
/// Cells outside the planner bounds (or unreachable) get the maximum.
fn write_minutes_layer(g: &PlanGrid, field: &RefugeField, dir: &Path) -> Result<(), String> {
    let n = layers::CELLS;
    let bytes: Vec<u8> = (0..n * n)
        .map(|i| {
            let (x, y) = layers::cell_centre(i % n, i / n);
            let minutes = g.cell_at(x, y).map(|c| field.minutes[c]).filter(|m| m.is_finite()).unwrap_or(MINUTES_LAYER_MAX);
            ((minutes / MINUTES_LAYER_MAX).clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect();
    let img = image::GrayImage::from_raw(n as u32, n as u32, bytes).ok_or("image buffer has the wrong size")?;
    let path = dir.join("minutesToShelter.png");
    img.save(&path).map_err(|e| format!("cannot write {}: {}", path.display(), e))?;
    let b = g.bounds;
    let mut entry = Map::new();
    entry.insert(
        "minutesToShelter".into(),
        json!({ "file": "minutesToShelter.png", "min": 0.0, "max": MINUTES_LAYER_MAX,
                "validBounds": { "xMin": b.x_min, "xMax": b.x_max, "yMin": b.y_min, "yMax": b.y_max } }),
    );
    layers::update_meta(dir, entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_keeps_ends_and_spacing() {
        let pts = [(0.0, 0.0), (30.0, 0.0), (30.0, 31.0)];
        let times = [0.0, 1.0, 2.0];
        let s = resample(&pts, &times, 15.0);
        assert_eq!((s[0].0, s[0].1, s[0].2), (0.0, 0.0, 0.0));
        let last = s.last().unwrap();
        assert_eq!((last.0, last.1, last.2, last.3), (30.0, 31.0, 2.0, 61.0));
        assert_eq!(s.len(), 5); // 61 m in 4 pieces of 15.25 m
        assert!(s.windows(2).all(|w| w[1].2 >= w[0].2));
    }
}

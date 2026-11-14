//! The main route, waypoints, reroutes and output files (shared/waypoints.md).

use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;
use serde_json::{json, Map, Value};

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
    pub stops: Vec<Stop>,
}

struct Refuge {
    id: String,
    x: f64,
    y: f64,
    cell: usize,
    is_base: bool,
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
    cell: Option<usize>,
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

/// Points every ~`spacing` metres along a polyline (equal pieces, both ends included), with times interpolated.
fn resample(pts: &[(f64, f64)], times: &[f64], spacing: f64) -> Vec<(f64, f64, f64)> {
    let mut cum = vec![0.0];
    for w in pts.windows(2) {
        cum.push(cum.last().unwrap() + dist(w[0], w[1]));
    }
    let total = *cum.last().unwrap();
    let n = ((total / spacing).round() as usize).max(1);
    let mut out = Vec::with_capacity(n + 1);
    let mut seg = 0;
    for j in 0..=n {
        let s = total * j as f64 / n as f64;
        while seg + 1 < pts.len() - 1 && cum[seg + 1] < s {
            seg += 1;
        }
        if pts.len() == 1 {
            out.push((pts[0].0, pts[0].1, times[0]));
            break;
        }
        let len = cum[seg + 1] - cum[seg];
        let t = if len > 0.0 { ((s - cum[seg]) / len).clamp(0.0, 1.0) } else { 0.0 };
        let lerp = |a: f64, b: f64| a + (b - a) * t;
        out.push((lerp(pts[seg].0, pts[seg + 1].0), lerp(pts[seg].1, pts[seg + 1].1), lerp(times[seg], times[seg + 1])));
    }
    out
}

fn describe(inp: &PlanInputs, g: &PlanGrid, x: f64, y: f64) -> Result<Desc, String> {
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
        cell: g.cell_at(x, y),
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

/// Builds the plan and writes waypoints.json, shelters.json, briefing.json and the minutesToShelter layer into `out_dir`.
pub fn run(inp: &PlanInputs, out_dir: &Path) -> Result<(), String> {
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

    // Shelters and refuges.
    let shelter_cells = planner::find_shelters(&g, cfg);
    println!(
        "Shelters found: {} (blocked >= {}, slope <= {} deg, groups of 3+ cells)",
        shelter_cells.len(), cfg.shelter_blocked_min, cfg.shelter_max_slope_deg
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
    let sources: Vec<(usize, f64)> =
        refuges.iter().map(|rf| (rf.cell, if rf.is_base || g.base_link[rf.cell] { 0.0 } else { 1.0 })).collect();
    let field = planner::refuge_field(&g, &sources, cfg);

    // Main route: snap, A* between consecutive stops, smooth.
    let snapped: Vec<(usize, (f64, f64), f64)> = inp.stops.iter().map(|s| snap(&g, s.x, s.y)).collect::<Result<_, _>>()?;
    let limit = cfg.minutes_to_shelter_limit;
    let mult = |j: usize| {
        1.0 + if g.base_link[j] { 0.0 } else { 1.0 } + if g.sunlit[j] { 0.0 } else { 0.2 } + if field.minutes[j] > limit { 0.5 } else { 0.0 }
    };
    let mut legs: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut reverted = 0;
    for k in 1..inp.stops.len() {
        let path = planner::astar(&g, snapped[k - 1].0, snapped[k].0, cfg, mult)
            .ok_or_else(|| format!("no passable route from {} to {}", inp.stops[k - 1].id, inp.stops[k].id))?;
        let mut pts: Vec<(f64, f64)> = path.iter().map(|&i| g.centre(i)).collect();
        if pts.len() == 1 {
            pts.push(pts[0]);
        }
        pts[0] = snapped[k - 1].1;
        *pts.last_mut().unwrap() = snapped[k].1;
        let (smoothed, n) = smooth(&g, &pts);
        reverted += n;
        legs.push(smoothed);
    }

    // Walking minutes along each leg, then resample every waypointSpacing with stops kept.
    let per_metre = |x: f64, y: f64| g.cell_at(x, y).filter(|&c| g.passable[c]).map_or(1.0 / cfg.walk_speed / 60.0, |c| g.minutes_per_metre(c, cfg));
    let mut main_pts: Vec<PlanPoint> = vec![PlanPoint { x: snapped[0].1.0, y: snapped[0].1.1, minutes: 0.0, stop: Some(0) }];
    let mut route_len = 0.0;
    for (k, leg) in legs.iter().enumerate() {
        let start_min = main_pts.last().unwrap().minutes;
        let mut times = vec![start_min];
        for w in leg.windows(2) {
            let mid = ((w[0].0 + w[1].0) / 2.0, (w[0].1 + w[1].1) / 2.0);
            times.push(times.last().unwrap() + dist(w[0], w[1]) * per_metre(mid.0, mid.1));
            route_len += dist(w[0], w[1]);
        }
        let samples = resample(leg, &times, cfg.waypoint_spacing);
        for (j, &(x, y, t)) in samples.iter().enumerate().skip(1) {
            let stop = (j == samples.len() - 1).then_some(k + 1);
            main_pts.push(PlanPoint { x, y, minutes: t, stop });
        }
    }

    // Reroutes: from each main waypoint along the refuge pointers.
    let mut reroute_plans: Vec<(Vec<PlanPoint>, usize)> = Vec::new();
    for p in &main_pts {
        let cell = g.cell_at(p.x, p.y).ok_or("main waypoint outside the planner bounds")?;
        let rf = field.refuge[cell].ok_or("main waypoint cannot reach any refuge")?;
        let target = (refuges[rf].x, refuges[rf].y);
        if field.minutes[cell] == 0.0 || dist((p.x, p.y), target) < SHELTER_RADIUS_M {
            reroute_plans.push((vec![PlanPoint { stop: None, ..p.clone() }], rf));
            continue;
        }
        let cells = field.route_from(cell);
        let mut pts = vec![(p.x, p.y)];
        let mut times = vec![p.minutes];
        for &c in &cells[1..cells.len() - 1] {
            pts.push(g.centre(c));
            times.push(p.minutes + field.minutes[cell] - field.minutes[c]);
        }
        pts.push(target);
        times.push(p.minutes + field.minutes[cell]);
        let samples = resample(&pts, &times, cfg.waypoint_spacing);
        reroute_plans.push((samples.into_iter().map(|(x, y, t)| PlanPoint { x, y, minutes: t, stop: None }).collect(), rf));
    }

    // Describe every point in parallel (main first, then reroutes in order).
    let all: Vec<(f64, f64)> = main_pts.iter().map(|p| (p.x, p.y)).chain(reroute_plans.iter().flat_map(|(pts, _)| pts.iter().map(|p| (p.x, p.y)))).collect();
    let descs: Vec<Desc> = all.par_iter().map(|&(x, y)| describe(inp, &g, x, y)).collect::<Result<_, _>>()?;
    let (main_descs, mut rest) = (&descs[..main_pts.len()], &descs[main_pts.len()..]);

    let near_refuge = |x: f64, y: f64| refuges.iter().any(|rf| dist((x, y), (rf.x, rf.y)) <= SHELTER_RADIUS_M);
    let shelter_of = |d: &Desc, x: f64, y: f64, heading: f64, at_end: Option<usize>| -> Value {
        let (rf, minutes, metres) = match at_end {
            Some(rf) => (rf, 0.0, 0.0),
            None => {
                let c = d.cell.unwrap_or(0);
                (field.refuge[c].unwrap_or(0), field.minutes[c], field.metres[c])
            }
        };
        let target = (refuges[rf].x, refuges[rf].y);
        let az = if dist((x, y), target) < 0.5 { heading } else { bearing((x, y), target) };
        json!({ "az": r(az, 1), "distance": r(metres, 1), "minutes": r(minutes, 2) })
    };
    let waypoint = |id: String, label: &str, p: &PlanPoint, d: &Desc, heading: f64, shelter: Value, dose: f64, is_shelter: bool, science: bool| -> Value {
        json!({
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
            "doseFraction": r(dose, 4),
            "oxygenFraction": r((1.0 - p.minutes / cfg.oxygen_minutes).clamp(0.0, 1.0), 4),
            "isShelter": is_shelter,
            "isScienceStop": science,
        })
    };

    // Main waypoints with dose.
    let total_minutes = main_pts.last().unwrap().minutes;
    let budget = 2.0 * total_minutes.max(1e-6);
    let main_rates: Vec<f64> = main_descs.iter().map(|d| planner::dose_rate(d.blocked, cfg)).collect();
    let main_minutes: Vec<f64> = main_pts.iter().map(|p| p.minutes).collect();
    let main_dose = planner::accumulate_dose(&main_rates, &main_minutes, 0.0, 1.0, budget);
    let main_head = headings(&main_pts, 0.0);
    let mut main_json = Vec::new();
    for (i, p) in main_pts.iter().enumerate() {
        let d = &main_descs[i];
        let stop = p.stop.map(|s| &inp.stops[s]);
        main_json.push(waypoint(
            format!("m{i:02}"),
            stop.map_or("", |s| s.label.as_str()),
            p,
            d,
            main_head[i],
            shelter_of(d, p.x, p.y, main_head[i], None),
            main_dose[i],
            near_refuge(p.x, p.y),
            stop.is_some_and(|s| s.science),
        ));
    }

    // Reroute waypoints.
    let mut reroutes = Map::new();
    let mut far_point_reroute = None;
    for (k, (pts, rf)) in reroute_plans.iter().enumerate() {
        let (d_here, d_rest) = rest.split_at(pts.len());
        rest = d_rest;
        let rates: Vec<f64> = d_here.iter().map(|d| planner::dose_rate(d.blocked, cfg)).collect();
        let minutes: Vec<f64> = pts.iter().map(|p| p.minutes).collect();
        let dose = planner::accumulate_dose(&rates, &minutes, main_dose[k], cfg.storm_dose_multiplier, budget);
        let head = headings(pts, main_head[k]);
        let refuge = &refuges[*rf];
        let list: Vec<Value> = pts
            .iter()
            .enumerate()
            .map(|(j, p)| {
                let last = j == pts.len() - 1;
                let label = if last { if refuge.is_base { "Base" } else { "Shelter" } } else { "" };
                let shelter = shelter_of(&d_here[j], p.x, p.y, head[j], last.then_some(*rf));
                waypoint(format!("r{k:02}-{j:02}"), label, p, &d_here[j], head[j], shelter, dose[j], last || near_refuge(p.x, p.y), false)
            })
            .collect();
        if k == main_pts.len() - 1 {
            far_point_reroute = Some((refuge.id.clone(), refuge.x, refuge.y, pts.last().unwrap().minutes - pts[0].minutes, pts.len()));
        }
        reroutes.insert(k.to_string(), Value::Array(list));
    }

    let doc = json!({ "version": 1, "skylineSamples": CONTRACT_SAMPLES, "main": main_json, "reroutes": reroutes });

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
    let worst = main_json.iter().map(|w| w["shelter"]["minutes"].as_f64().unwrap_or(0.0)).fold(0.0, f64::max);
    let base_slope = g.slope[base_cell] as f64;
    let briefing = json!({
        "version": 1,
        "routeLengthM": r(route_len, 1),
        "minutes": r(total_minutes, 2),
        "waypoints": main_json.len(),
        "worstMinutesToRefuge": worst,
        "baseLinkFraction": r(count("base"), 3),
        "sunlitFraction": r(count("sun"), 3),
        "endDoseFraction": main_json.last().unwrap()["doseFraction"],
        "endOxygenFraction": main_json.last().unwrap()["oxygenFraction"],
        "shelterCount": shelter_cells.len(),
        "slopeAtBaseDeg": r(base_slope, 1),
    });

    // Write files.
    std::fs::create_dir_all(out_dir.join("layers")).map_err(|e| format!("cannot create {}: {}", out_dir.display(), e))?;
    let write = |name: &str, v: &Value| -> Result<(), String> {
        let path = out_dir.join(name);
        std::fs::write(&path, serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("cannot write {}: {}", path.display(), e))
    };
    write("waypoints.json", &doc)?;
    write("shelters.json", &json!({ "version": 1, "refuges": shelter_list }))?;
    write("briefing.json", &briefing)?;
    write_minutes_layer(&g, &field, &out_dir.join("layers"))?;

    // Report.
    println!("Main route: {} legs, {} smoothed points put back on passable ground; {} waypoints; {} reroutes; done in {:.2} s\n",
        legs.len(), reverted, main_json.len(), reroutes.len(), started.elapsed().as_secs_f64());
    println!("Briefing\n{}\n", serde_json::to_string_pretty(&briefing).unwrap());

    println!("Stops");
    println!("  {:<8} {:<17} {:>6} {:>8} {:>8} {:>5} {:>6} {:>9}", "id", "label", "snap m", "minutes", "openSky", "base", "sunlit", "to refuge");
    for (s_idx, s) in inp.stops.iter().enumerate() {
        let i = main_pts.iter().position(|p| p.stop == Some(s_idx)).unwrap();
        let w = &main_json[i];
        println!(
            "  {:<8} {:<17} {:>6.2} {:>8.2} {:>8.3} {:>5} {:>6} {:>9.2}",
            s.id, s.label, snapped[s_idx].2, w["minutesFromStart"].as_f64().unwrap(), w["openSky"].as_f64().unwrap(),
            if w["base"]["visible"] == true { "yes" } else { "-" }, if w["sun"]["visible"] == true { "yes" } else { "-" },
            w["shelter"]["minutes"].as_f64().unwrap()
        );
    }

    println!("\nRefuges");
    println!("  {:<5} {:>8} {:>8} {:>8} {:>5} {:>6} {:>6}", "id", "x", "y", "blocked", "base", "sunlit", "earth");
    for s in &shelter_list {
        let yn = |k: &str| if s[k] == true { "yes" } else { "-" };
        println!("  {:<5} {:>8.1} {:>8.1} {:>8.3} {:>5} {:>6} {:>6}", s["id"].as_str().unwrap(), s["x"].as_f64().unwrap(), s["y"].as_f64().unwrap(),
            s["blocked"].as_f64().unwrap(), yn("baseLink"), yn("sunlit"), yn("earthLink"));
    }

    if let Some((id, x, y, minutes, n_wp)) = far_point_reroute {
        let far = main_pts.last().unwrap();
        let far_cell = g.cell_at(far.x, far.y).unwrap();
        let back = planner::astar(&g, far_cell, base_cell, cfg, |_| 1.0).map(|p| {
            p.windows(2).map(|w| {
                let (a, b) = (g.centre(w[0]), g.centre(w[1]));
                g.step_minutes(w[0], w[1], dist(a, b), cfg)
            }).sum::<f64>()
        });
        println!("\nReroute from the far point (m{:02}): to {} at ({:.1}, {:.1}), {:.2} min, {} waypoints",
            main_pts.len() - 1, id, x, y, minutes, n_wp);
        match back {
            Some(b) => println!("  Walking straight back to base instead: {:.2} min (fastest path); the planned walk out took {:.2} min", b, total_minutes),
            None => println!("  No walkable path back to base"),
        }
    }
    println!("\nWrote waypoints.json, shelters.json, briefing.json and layers/minutesToShelter.png to {}", out_dir.display());
    Ok(())
}

/// minutesToShelter at layer resolution; cells outside the planner bounds (or unreachable) get the maximum.
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
        assert_eq!((last.0, last.1, last.2), (30.0, 31.0, 2.0));
        assert_eq!(s.len(), 5); // 61 m in 4 pieces of 15.25 m
        assert!(s.windows(2).all(|w| w[1].2 >= w[0].2));
    }
}

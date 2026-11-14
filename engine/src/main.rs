//! Beacon terrain engine.
//!
//!   engine check                  skyline at the parking spot vs data/site.json referenceCheck,
//!                                 fast-vs-precise check, and proof numbers with the far field
//!   engine point <x> <y>          blocked fraction and 72-value skyline as one line of JSON (near field only)
//!   engine layers                 map layers into data/out/layers/ (shared/layers.md)
//!   engine base-candidates        base link coverage for each candidate base position
//!
//! Positions are local metres: x east, y north, origin at the crop's south-west
//! outer corner (shared/conventions.md).
//!
//! Paths are relative to the repo root (the folder above engine/). Override with --root <dir>.

mod layers;
mod sight;
mod skyline;
mod terrain;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;

const NEAR_BIN: &str = "data/raw/near.bin";
const FAR_BIN: &str = "data/raw/far.bin";
const LAYERS_DIR: &str = "data/out/layers";
const SITE_JSON: &str = "data/site.json";

// Settings matching referenceCheck.method in data/site.json.
const EYE_HEIGHT_M: f64 = 1.0;
const N_DIRS: usize = 360;
const STEP_M: f64 = 0.5;
const MAX_DIST_M: f64 = 280.0;

const CONTRACT_SAMPLES: usize = 72;
const BLOCKED_TOLERANCE: f32 = 0.01;
const ANGLE_TOLERANCE_DEG: f32 = 1.5;

// Far field: computed once at the parking spot from this distance outwards, reused everywhere.
const FAR_FROM_M: f64 = 700.0;
// Proof numbers march the near field out to where the far field starts, so nothing in between is missed.
const PROOF_MAX_DIST_M: f64 = 700.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Site {
    near_crop: NearCrop,
    reference_check: ReferenceCheck,
    paper_target: PaperTarget,
    sky: SkyFile,
    base: BaseFile,
    route_stops: Vec<RouteStop>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperTarget {
    sky_blocked_at_butte: f32,
    sky_blocked_reference: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkyFile {
    time_u_t: String,
    sun: AzEl,
    earth: AzEl,
}

#[derive(Deserialize, Clone, Copy)]
struct AzEl {
    az: f64,
    el: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseFile {
    x: f64,
    y: f64,
    mast_height: f64,
}

#[derive(Deserialize)]
struct RouteStop {
    id: String,
    x: f64,
    y: f64,
}

impl Site {
    fn stop(&self, id: &str) -> Result<(f64, f64), String> {
        self.route_stops
            .iter()
            .find(|s| s.id == id)
            .map(|s| (s.x, s.y))
            .ok_or_else(|| format!("{SITE_JSON}: no routeStops entry with id {id:?}"))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearCrop {
    parking_spot_local: LocalXY,
}

#[derive(Deserialize)]
struct LocalXY {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceCheck {
    blocked_at_parking_spot: f32,
    skyline_at_parking_spot_deg: BTreeMap<String, f32>,
}

fn load_site(root: &Path) -> Result<Site, String> {
    let path = root.join(SITE_JSON);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {}", path.display(), e))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {}", path.display(), e))
}

fn load_grid(root: &Path) -> Result<terrain::Grid, String> {
    terrain::load(&root.join(NEAR_BIN))
}

fn load_far(root: &Path) -> Result<terrain::Grid, String> {
    terrain::load(&root.join(FAR_BIN))
}

/// Far-field skyline at the parking spot with `n_dirs` directions, from FAR_FROM_M outwards.
fn far_at_parking(near: &terrain::Grid, far: &terrain::Grid, spot: &LocalXY, n_dirs: usize) -> Result<Vec<f32>, String> {
    let ground = near.sample_local(spot.x, spot.y).ok_or("parking spot is on no-data")?;
    let (e, n) = near.local_to_en(spot.x, spot.y);
    Ok(skyline::far_skyline(far, e, n, ground as f64 + EYE_HEIGHT_M, n_dirs, FAR_FROM_M))
}

fn check(root: &Path) -> Result<bool, String> {
    let site = load_site(root)?;
    let grid = load_grid(root)?;
    let reference_ok = check_reference(&site, &grid)?;
    let fast_ok = check_fast(&site, &grid)?;
    proof_numbers(root, &site, &grid)?;
    println!();
    println!("{}", if reference_ok && fast_ok { "PASS  all checks" } else { "FAIL  see above" });
    Ok(reference_ok && fast_ok)
}

fn check_reference(site: &Site, grid: &terrain::Grid) -> Result<bool, String> {
    let spot = &site.near_crop.parking_spot_local;
    let reference = &site.reference_check;

    let sky = skyline::skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?;
    let blocked = skyline::blocked_fraction(&sky);
    let blocked_diff = blocked - reference.blocked_at_parking_spot;

    println!("Parking spot: x {} m, y {} m in {} ({} x {})", spot.x, spot.y, NEAR_BIN, grid.width, grid.height);
    println!("Eye {EYE_HEIGHT_M} m, {N_DIRS} directions, step {STEP_M} m, out to {MAX_DIST_M} m\n");
    println!(
        "Blocked fraction: {:.3}   reference {:.3}   diff {:+.3}\n",
        blocked, reference.blocked_at_parking_spot, blocked_diff
    );

    let mut rows: Vec<(f64, f32)> = reference
        .skyline_at_parking_spot_deg
        .iter()
        .map(|(k, &v)| k.parse::<f64>().map(|az| (az, v)).map_err(|_| format!("bad azimuth key {k:?}")))
        .collect::<Result<_, _>>()?;
    rows.sort_by(|a, b| a.0.total_cmp(&b.0));

    println!("  az   computed  reference    diff");
    let mut worst: Option<(f64, f32)> = None;
    for &(az, want) in &rows {
        let got = sky[skyline::index_for_azimuth(az, sky.len())];
        let diff = got - want;
        let flag = if diff.abs() > ANGLE_TOLERANCE_DEG { "  <" } else { "" };
        println!("{az:5.0}   {got:8.1}  {want:9.1}  {diff:+6.1}{flag}");
        if worst.is_none_or(|(_, d)| diff.abs() > d.abs()) {
            worst = Some((az, diff));
        }
    }

    let blocked_ok = blocked_diff.abs() <= BLOCKED_TOLERANCE;
    let (worst_az, worst_diff) = worst.unwrap_or((0.0, 0.0));
    let angles_ok = worst_diff.abs() <= ANGLE_TOLERANCE_DEG;
    println!();
    if blocked_ok && angles_ok {
        println!(
            "PASS  blocked within {BLOCKED_TOLERANCE}, every angle within {ANGLE_TOLERANCE_DEG} deg (worst {worst_diff:+.1} at {worst_az:.0})"
        );
    } else {
        let mut why = Vec::new();
        if !blocked_ok {
            why.push(format!("blocked off by {blocked_diff:+.3} (limit {BLOCKED_TOLERANCE})"));
        }
        if !angles_ok {
            why.push(format!("worst direction {worst_az:.0} deg off by {worst_diff:+.1} (limit {ANGLE_TOLERANCE_DEG})"));
        }
        println!("FAIL  {}", why.join("; "));
    }
    Ok(blocked_ok && angles_ok)
}

/// The fast layer settings must agree with the precise settings at the parking spot.
fn check_fast(site: &Site, grid: &terrain::Grid) -> Result<bool, String> {
    let spot = &site.near_crop.parking_spot_local;
    let precise = skyline::blocked_fraction(&skyline::skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?);
    let dists = skyline::fast_distances();
    let fast = skyline::blocked_fraction(&skyline::fast_skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, &dists)?);
    let diff = fast - precise;
    let ok = diff.abs() <= BLOCKED_TOLERANCE;
    println!(
        "\nFast layer settings ({} directions, {} steps out to {} m): blocked {:.3} vs precise {:.3}, diff {:+.3}",
        skyline::FAST_DIRS,
        dists.len(),
        skyline::FAST_MAX_M,
        fast,
        precise,
        diff
    );
    println!("{}  fast within {BLOCKED_TOLERANCE} of precise", if ok { "PASS" } else { "FAIL" });
    Ok(ok)
}

/// Blocked fraction and merged skyline at a point with precise settings out to PROOF_MAX_DIST_M plus the far field.
fn precise_with_far(grid: &terrain::Grid, far: &[f32], x: f64, y: f64) -> Result<(f32, Vec<f32>), String> {
    let near = skyline::skyline(grid, x, y, EYE_HEIGHT_M, N_DIRS, STEP_M, PROOF_MAX_DIST_M)?;
    let merged = skyline::merge(&near, far);
    Ok((skyline::blocked_fraction(&merged), merged))
}

fn proof_numbers(root: &Path, site: &Site, grid: &terrain::Grid) -> Result<(), String> {
    let spot = &site.near_crop.parking_spot_local;
    let far_grid = load_far(root)?;
    let far = far_at_parking(grid, &far_grid, spot, N_DIRS)?;
    let paper = &site.paper_target;

    let near_280 = skyline::blocked_fraction(&skyline::skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?);
    let near_700 = skyline::blocked_fraction(&skyline::skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, N_DIRS, STEP_M, PROOF_MAX_DIST_M)?);
    let (with_far, spot_sky) = precise_with_far(grid, &far, spot.x, spot.y)?;
    let far_only = skyline::blocked_fraction(&far);

    let mut around = Vec::new();
    for i in -2..=2 {
        for j in -2..=2 {
            around.push(precise_with_far(grid, &far, spot.x + i as f64 * 2.5, spot.y + j as f64 * 2.5)?.0);
        }
    }
    let (lo, hi) = around.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));

    let (ox, oy) = site.stop("sol1468")?;
    let (open_ground, _) = precise_with_far(grid, &far, ox, oy)?;

    println!("\nProof numbers (eye {EYE_HEIGHT_M} m, {N_DIRS} directions, step {STEP_M} m; far field from {FAR_FROM_M} m on far.bin, computed at the parking spot)");
    println!("  Blocked fraction                                     engine   paper");
    println!("  parking spot, near field to {MAX_DIST_M} m (reference)         {near_280:.3}");
    println!("  parking spot, near field to {PROOF_MAX_DIST_M} m                     {near_700:.3}");
    println!("  far field alone                                       {far_only:.3}");
    println!("  parking spot, near to {PROOF_MAX_DIST_M} m + far field              {with_far:.3}    {:.2}", paper.sky_blocked_at_butte);
    println!("  5 x 5 points, 2.5 m apart, around the spot: min      {lo:.3}");
    println!("                                               max      {hi:.3}    {:.2}", paper.sky_blocked_at_butte);
    println!("  open ground at sol1468 ({ox}, {oy}), with far field   {open_ground:.3}    {:.2}", paper.sky_blocked_reference);

    let (sx, sy) = site.stop("sol1471")?;
    let (_, sol1471_sky) = precise_with_far(grid, &far, sx, sy)?;
    println!("\n  Sky at {} UT: Sun az {} el {}, Earth az {} el {}", site.sky.time_u_t, site.sky.sun.az, site.sky.sun.el, site.sky.earth.az, site.sky.earth.el);
    for (name, sky) in [("parking spot", &spot_sky), ("sol1471", &sol1471_sky)] {
        let describe = |body: AzEl| {
            let horizon = skyline::elevation_at(sky, body.az);
            let seen = if skyline::visible(sky, body.az, body.el) { "visible" } else { "hidden " };
            format!("{seen} (skyline {horizon:.1} deg)")
        };
        println!("  {name:<13} Sun {}   Earth {}", describe(site.sky.sun), describe(site.sky.earth));
    }
    Ok(())
}

/// Candidate base positions (local metres) compared by `base-candidates`.
const BASE_CANDIDATES: [(&str, f64, f64, &str); 4] = [
    ("A", 1596.6, 1312.7, "Curiosity sol 1480"),
    ("B", 1592.7, 1389.5, "sol 1471"),
    ("C", 1598.0, 1250.0, ""),
    ("D", 1506.1, 1678.3, "previous base, sol 1439"),
];
const CANDIDATE_MAST_M: f64 = 10.0;

fn base_candidates(root: &Path) -> Result<(), String> {
    let site = load_site(root)?;
    let grid = load_grid(root)?;
    let stops: Vec<&RouteStop> = site.route_stops.iter().filter(|s| s.id != "base").collect();
    println!("Mast {CANDIDATE_MAST_M} m, eye 1 m, {} x {} layer cells of {} m over x/y {}..{} m\n",
        layers::CELLS, layers::CELLS, layers::CELL_M, layers::ORIGIN_M, layers::ORIGIN_M + layers::CELLS as f64 * layers::CELL_M);
    let header: Vec<String> = stops.iter().map(|s| format!("{:>8}", s.id)).collect();
    println!("{:<3} {:>7} {:>7} {:>10} {:>6}  {}   note", "id", "x", "y", "ground m", "link", header.join(""));
    for (id, x, y, note) in BASE_CANDIDATES {
        let base = layers::Base { x, y, mast_height_m: CANDIDATE_MAST_M };
        let ground = grid.sample_local(x, y).ok_or_else(|| format!("candidate {id} is on no-data"))?;
        let fraction = layers::base_link_fraction(&grid, &base);
        let links: Vec<String> = stops
            .iter()
            .map(|s| format!("{:>8}", if layers::base_link(&grid, s.x, s.y, &base) { "yes" } else { "-" }))
            .collect();
        println!("{id:<3} {x:>7.1} {y:>7.1} {ground:>10.2} {fraction:>6.3}  {}   {note}", links.join(""));
    }
    Ok(())
}

fn layers_command(root: &Path) -> Result<(), String> {
    let site = load_site(root)?;
    let grid = load_grid(root)?;
    let far_grid = load_far(root)?;
    let far = far_at_parking(&grid, &far_grid, &site.near_crop.parking_spot_local, skyline::FAST_DIRS)?;
    let sky = layers::Sky { sun: (site.sky.sun.az, site.sky.sun.el), earth: (site.sky.earth.az, site.sky.earth.el) };
    let base = layers::Base { x: site.base.x, y: site.base.y, mast_height_m: site.base.mast_height };
    println!("Sun az {} el {}, Earth az {} el {}, base ({}, {}) mast {} m", sky.sun.0, sky.sun.1, sky.earth.0, sky.earth.1, base.x, base.y, base.mast_height_m);
    layers::write_layers(&grid, &far, &sky, &base, &root.join(LAYERS_DIR))
}

fn point(root: &Path, x: f64, y: f64) -> Result<(), String> {
    let grid = load_grid(root)?;
    let sky = skyline::skyline(&grid, x, y, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?;
    let blocked = skyline::blocked_fraction(&sky);
    let sky72: Vec<f64> = skyline::resample(&sky, CONTRACT_SAMPLES)
        .iter()
        .map(|&a| (a as f64 * 10.0).round() / 10.0)
        .collect();
    let out = serde_json::json!({
        "x": x,
        "y": y,
        "blocked": (blocked as f64 * 1000.0).round() / 1000.0,
        "skyline": sky72,
    });
    println!("{out}");
    Ok(())
}

fn usage() -> String {
    "usage: engine [--root <dir>] check\n       engine [--root <dir>] point <x> <y>   (local metres)\n       engine [--root <dir>] layers\n       engine [--root <dir>] base-candidates".to_string()
}

fn run() -> Result<bool, String> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    if let Some(i) = args.iter().position(|a| a == "--root") {
        let dir = args.get(i + 1).ok_or_else(usage)?.clone();
        root = PathBuf::from(dir);
        args.drain(i..=i + 1);
    }

    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["check"] => check(&root),
        ["layers"] => layers_command(&root).map(|_| true),
        ["base-candidates"] => base_candidates(&root).map(|_| true),
        ["point", x, y] => {
            let parse = |s: &str| s.parse::<f64>().map_err(|_| format!("not a number: {s}"));
            point(&root, parse(x)?, parse(y)?).map(|_| true)
        }
        _ => Err(usage()),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}

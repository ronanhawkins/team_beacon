//! Beacon terrain engine.
//!
//!   engine check                  skyline at the parking spot vs data/site.json referenceCheck,
//!                                 fast-vs-precise check, and proof numbers with the far field
//!   engine point <x> <y>          blocked fraction and 72-value skyline as one line of JSON (near field only)
//!   engine layers                 map layers into data/out/layers/ (shared/layers.md)
//!   engine base-candidates        base link coverage for each candidate base position
//!   engine plan                   planner: shelters, main route, reroutes -> data/out/
//!   engine plan --stops "x,y;x,y,label;..." --out <dir>   plan other stops into <dir>: first is the start, last the end, the rest science stops
//!   engine decide <mainIndex> [--lead L] [--limit X]   storm decision table at one main waypoint
//!   engine decide --sweep         chosen site at four waypoints for warnings of 0 to 15 minutes
//!
//! Positions are local metres: x east, y north, origin at the crop's south-west
//! outer corner (shared/conventions.md).
//!
//! Paths are relative to the repo root (the folder above engine/). Override with --root <dir>.
//!
//! Site: with no site chosen (the default, Gale), the engine reads data/site.json and data/raw/ and
//! writes data/out/. With SITE=<name> in the environment, or --site <name>, it reads
//! data/sites/<name>/site.json and data/raw/<name>/ and writes data/out/<name>/. Site-independent caches
//! (the RAD storm, DONKI) stay in data/cache/; site-specific ones (REMS, stop images) go in
//! data/cache/<name>/. --site wins over SITE.

mod decision;
mod dose;
mod layers;
mod planner;
mod rems;
mod route;
mod sight;
mod skyline;
mod space;
mod terrain;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;

/// Where one site's files are. Every path is relative to the repo root; `file` joins it on.
struct Paths {
    root: PathBuf,
    /// None for the default site (Gale), which keeps the original layout.
    site: Option<String>,
    site_json: String,
    raw: String,
    out: String,
    /// Caches that do not depend on the site: the RAD storm and DONKI.
    cache_shared: String,
    /// Caches that do: REMS weather, stop images. data/cache/ for the default site.
    cache_site: String,
}

impl Paths {
    fn new(root: PathBuf, site: Option<String>) -> Result<Paths, String> {
        let Some(name) = site else {
            return Ok(Paths {
                root,
                site: None,
                site_json: "data/site.json".into(),
                raw: "data/raw".into(),
                out: "data/out".into(),
                cache_shared: "data/cache".into(),
                cache_site: "data/cache".into(),
            });
        };
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(format!("site name {name:?} must be letters, digits, - or _"));
        }
        let p = Paths {
            site_json: format!("data/sites/{name}/site.json"),
            raw: format!("data/raw/{name}"),
            out: format!("data/out/{name}"),
            cache_shared: "data/cache".into(),
            cache_site: format!("data/cache/{name}"),
            root,
            site: Some(name),
        };
        if !p.file(&p.site_json).exists() {
            return Err(format!("no site file at {} for site {:?}", p.site_json, p.site.as_deref().unwrap_or_default()));
        }
        Ok(p)
    }
    fn file(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }
    fn near_bin(&self) -> String {
        format!("{}/near.bin", self.raw)
    }
    fn far_bin(&self) -> String {
        format!("{}/far.bin", self.raw)
    }
    fn mola_bin(&self) -> String {
        format!("{}/mola.bin", self.raw)
    }
    fn rad_cache(&self) -> String {
        format!("{}/rad_storm.json", self.cache_shared)
    }
    fn donki_cache(&self) -> String {
        format!("{}/donki_mars.json", self.cache_shared)
    }
    fn rems_cache(&self) -> String {
        format!("{}/rems.json", self.cache_site)
    }
    fn images_cache(&self) -> String {
        format!("{}/stop_images.json", self.cache_site)
    }
}

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
    /// Only its longitude is used, for local solar time in the REMS conditions.
    #[serde(default)]
    parking_spot: Option<ParkingSpot>,
    /// The frame of the crops in the raw folder; checked against near.bin's header.
    grid: GridFrame,
    /// Where the far-field skyline is computed once and reused for every point (local metres).
    far_field_centre: LocalXY,
    /// The square the map layers cover.
    layers_region: layers::Region,
    /// Ground truth for `engine check`. Absent at sites that have none.
    #[serde(default)]
    validation: Option<Validation>,
    /// Positions compared by `engine base-candidates` (optional).
    #[serde(default)]
    base_candidates: Option<BaseCandidates>,
    /// Main waypoints, by label, that `engine decide --sweep` reports besides open ground and the far point (optional).
    #[serde(default)]
    decision_sweep: Vec<SweepStop>,
    sky: SkyFile,
    base: BaseFile,
    route_stops: Vec<RouteStop>,
    planner: planner::PlannerConfig,
    planner_bounds: planner::Bounds,
    storm: decision::StormConfig,
    /// Names for the shelter nearest a route stop (optional).
    #[serde(default)]
    shelter_labels: Vec<ShelterLabel>,
    /// The measured storm from data/cache/rad_storm.json, when present.
    #[serde(skip)]
    rad: Option<RadCache>,
    /// The briefing's spaceWeather, from data/cache/donki_mars.json when present.
    #[serde(skip)]
    space_weather: Option<serde_json::Value>,
    /// The briefing's conditions and a sunset check line, from data/cache/rems.json when present.
    #[serde(skip)]
    conditions: Option<(serde_json::Value, String)>,
    /// Images per stop id, from data/cache/stop_images.json when present.
    #[serde(skip)]
    stop_images: Option<serde_json::Value>,
    /// The site file's path, for messages.
    #[serde(skip)]
    file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridFrame {
    metres_per_pixel: f64,
    south_west_easting: f64,
    south_west_northing: f64,
    /// Projection of the crops (WKT, as in their ENVI headers). Recorded for tools; not parsed by the engine.
    #[allow(dead_code)]
    projection: String,
}

/// Ground truth for `engine check`: an independent skyline at one point, published values, and the
/// routeStops used as the open-ground reference and for the Sun and Earth line.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Validation {
    check_point: NamedPoint,
    open_ground_stop: String,
    #[serde(default)]
    sky_check_stops: Vec<String>,
    paper_target: PaperTarget,
    reference_check: ReferenceCheck,
}

#[derive(Deserialize)]
struct NamedPoint {
    name: String,
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseCandidates {
    mast_height: f64,
    candidates: Vec<BaseCandidate>,
}

#[derive(Deserialize)]
struct BaseCandidate {
    id: String,
    x: f64,
    y: f64,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct SweepStop {
    /// A main waypoint label in waypoints.json.
    label: String,
    /// How the row is described in the output.
    what: String,
}

#[derive(Deserialize)]
struct ShelterLabel {
    /// A routeStops id: the shelter nearest that stop gets the label.
    near: String,
    label: String,
}

#[derive(Deserialize)]
struct ParkingSpot {
    lon: f64,
}

/// The fields of data/cache/rad_storm.json (tools/fetch_rad.py) that the engine uses.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RadCache {
    /// Quiet open-ground dose rate, microgray per hour.
    baseline_rate: f64,
    /// Minutes above 1.5 x the baseline.
    minutes_above: f64,
    /// Mean dose rate over those minutes, as a multiple of the baseline.
    mean_multiplier_above: f64,
    /// First reading above 1.5 x the baseline, UTC.
    #[serde(default)]
    onset: Option<String>,
    /// "B" or "E": the detector the summary fields are for.
    primary_detector: String,
    /// Every reading: start time, length and dose rate per detector.
    series: Vec<RadReading>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RadReading {
    time: String,
    duration_s: f64,
    dose_b: Option<f64>,
    dose_e: Option<f64>,
}

impl RadCache {
    /// Mean dose rate over the first `minutes` after onset, as a multiple of the baseline,
    /// weighted by observation length. None without an onset or readings in that window.
    fn mean_multiplier_first(&self, minutes: f64) -> Option<f64> {
        let start = space::hours(self.onset.as_deref()?)?;
        let end = start + minutes / 60.0;
        let (mut sum, mut secs) = (0.0, 0.0);
        for r in &self.series {
            let t = space::hours(&r.time)?;
            let dose = if self.primary_detector == "B" { r.dose_b } else { r.dose_e };
            if let (true, Some(d)) = (t >= start - 1e-9 && t < end, dose) {
                sum += d * r.duration_s;
                secs += r.duration_s;
            }
        }
        (secs > 0.0).then(|| sum / secs / self.baseline_rate)
    }
}

/// Default for storm.stormMinutesCap.
const STORM_MINUTES_CAP: f64 = 240.0;

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
    dose_factor: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteStop {
    id: String,
    x: f64,
    y: f64,
    #[serde(default)]
    label: String,
    #[serde(default)]
    science_stop: bool,
}

impl Site {
    fn stop(&self, id: &str) -> Result<(f64, f64), String> {
        self.route_stops
            .iter()
            .find(|s| s.id == id)
            .map(|s| (s.x, s.y))
            .ok_or_else(|| format!("{}: no routeStops entry with id {id:?}", self.file))
    }
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

fn load_site(p: &Paths) -> Result<Site, String> {
    let path = p.file(&p.site_json);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {}", path.display(), e))?;
    let mut site: Site = serde_json::from_str(&text).map_err(|e| format!("{}: {}", path.display(), e))?;
    site.file = p.site_json.clone();
    if let Some(name) = &p.site {
        eprintln!("site {name}: {}, raw {}, out {}", p.site_json, p.raw, p.out);
    }
    site.rad = load_rad(p, &site.file);
    if let Some(rad) = &site.rad {
        let cap = site.storm.storm_minutes_cap.unwrap_or(STORM_MINUTES_CAP);
        site.storm.storm_minutes = rad.minutes_above.min(cap);
        // The multiplier is the mean over the minutes the model simulates: the whole period above
        // 1.5 x baseline, or its first `cap` minutes when the cap shortens it.
        site.storm.dose_multiplier = if rad.minutes_above <= cap {
            rad.mean_multiplier_above
        } else {
            rad.mean_multiplier_first(cap).map_or(rad.mean_multiplier_above, |m| (m * 1000.0).round() / 1000.0)
        };
    }
    site.space_weather = load_space_weather(p, &site);
    site.conditions = load_conditions(p, &site);
    site.stop_images = load_stop_images(p);
    Ok(site)
}

/// DONKI forecasts summarised for the briefing, or None (with a warning if the file is there but unreadable).
fn load_space_weather(p: &Paths, site: &Site) -> Option<serde_json::Value> {
    let cache = p.donki_cache();
    let text = std::fs::read_to_string(p.file(&cache)).ok()?;
    let onset = site.rad.as_ref().and_then(|r| r.onset.as_deref());
    match serde_json::from_str::<space::Cache>(&text).map_err(|e| e.to_string()).and_then(|c| space::briefing(&c, &site.sky.time_u_t, onset)) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("warning: cannot read {cache} ({e}); the briefing has no spaceWeather");
            None
        }
    }
}

/// REMS conditions for the briefing, or None (with a warning if the file is there but unreadable).
fn load_conditions(p: &Paths, site: &Site) -> Option<(serde_json::Value, String)> {
    let cache = p.rems_cache();
    let text = std::fs::read_to_string(p.file(&cache)).ok()?;
    let Some(spot) = &site.parking_spot else {
        eprintln!("warning: {} has no parkingSpot.lon for local time; the briefing has no conditions", site.file);
        return None;
    };
    match serde_json::from_str::<rems::Cache>(&text).map_err(|e| e.to_string()).and_then(|c| rems::briefing(&c, &site.sky.time_u_t, spot.lon, &cache)) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("warning: cannot read {cache} ({e}); the briefing has no conditions");
            None
        }
    }
}

/// The "stops" map of data/cache/stop_images.json, or None (with a warning if the file is there but unreadable).
fn load_stop_images(p: &Paths) -> Option<serde_json::Value> {
    let cache = p.images_cache();
    let text = std::fs::read_to_string(p.file(&cache)).ok()?;
    match serde_json::from_str::<serde_json::Value>(&text).map(|v| v["stops"].clone()) {
        Ok(stops) if stops.is_object() => Some(stops),
        Ok(_) => {
            eprintln!("warning: {cache} has no \"stops\" object; stops.json will have no images");
            None
        }
        Err(e) => {
            eprintln!("warning: cannot read {cache} ({e}); stops.json will have no images");
            None
        }
    }
}

/// The measured storm, or None (with a warning if the file is there but unreadable).
/// Without it the storm settings in data/site.json are used as they are.
fn load_rad(p: &Paths, site_file: &str) -> Option<RadCache> {
    let cache = p.rad_cache();
    let path = p.file(&cache);
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<RadCache>(&text) {
        Ok(rad) if rad.baseline_rate > 0.0 && rad.minutes_above > 0.0 && rad.mean_multiplier_above > 0.0 => Some(rad),
        Ok(_) => {
            eprintln!("warning: {cache} has non-positive values; using the storm settings in {site_file}");
            None
        }
        Err(e) => {
            eprintln!("warning: cannot read {cache} ({e}); using the storm settings in {site_file}");
            None
        }
    }
}

/// near.bin, after checking that its header agrees with the site file's grid frame.
fn load_grid(p: &Paths, site: &Site) -> Result<terrain::Grid, String> {
    let grid = terrain::load(&p.file(&p.near_bin()))?;
    let f = &site.grid;
    let (e, n) = grid.local_to_en(0.0, 0.0);
    let close = |a: f64, b: f64| (a - b).abs() <= 1e-3;
    if !close(grid.metres_per_pixel, f.metres_per_pixel) || !close(e, f.south_west_easting) || !close(n, f.south_west_northing) {
        return Err(format!(
            "{} does not match the grid in {}: header has {} m per pixel, south-west corner {e:.3}, {n:.3}; site file has {} m, {:.3}, {:.3}",
            p.near_bin(), site.file, grid.metres_per_pixel, f.metres_per_pixel, f.south_west_easting, f.south_west_northing
        ));
    }
    Ok(grid)
}

/// The far-field grids: far.bin, and the MOLA crop when it has been downloaded.
struct FarGrids {
    far: terrain::Grid,
    mola: Option<terrain::Grid>,
}

impl FarGrids {
    fn describe(&self) -> String {
        match self.mola {
            Some(_) => format!("far.bin, then mola.bin to {} km", skyline::MOLA_MAX_M / 1000.0),
            None => "far.bin only".into(),
        }
    }
}

fn load_far(p: &Paths) -> Result<FarGrids, String> {
    let far = terrain::load(&p.file(&p.far_bin()))?;
    let mola_path = p.file(&p.mola_bin());
    let mola = if mola_path.exists() {
        Some(terrain::load(&mola_path)?)
    } else {
        let site = p.site.as_deref().map_or(String::new(), |s| format!(" --site {s}"));
        eprintln!("warning: {} not found (run python3 tools/fetch_mola.py{site}); the far field stops at the edge of far.bin", p.mola_bin());
        None
    };
    Ok(FarGrids { far, mola })
}

/// Far-field skyline at the site's farFieldCentre with `n_dirs` directions, from FAR_FROM_M outwards.
fn far_at_centre(near: &terrain::Grid, far: &FarGrids, spot: &LocalXY, n_dirs: usize) -> Result<Vec<f32>, String> {
    let ground = near.sample_local(spot.x, spot.y).ok_or("farFieldCentre is on no-data")?;
    let (e, n) = near.local_to_en(spot.x, spot.y);
    Ok(skyline::far_skyline(&far.far, far.mola.as_ref(), e, n, ground as f64 + EYE_HEIGHT_M, n_dirs, FAR_FROM_M))
}

fn check(p: &Paths) -> Result<bool, String> {
    let site = load_site(p)?;
    let grid = load_grid(p, &site)?;
    let Some(v) = &site.validation else {
        // No ground truth: only the fast-against-precise self-check, at the first route stop.
        println!("no ground truth at this site ({} has no validation section)", site.file);
        let first = site.route_stops.first().ok_or_else(|| format!("{}: no routeStops", site.file))?;
        let at = NamedPoint { name: format!("route stop {}", first.id), x: first.x, y: first.y };
        let ok = check_fast(&at, &grid)?;
        println!();
        println!("{}", if ok { "PASS  self-check" } else { "FAIL  see above" });
        return Ok(ok);
    };
    let reference_ok = check_reference(p, v, &grid)?;
    let fast_ok = check_fast(&v.check_point, &grid)?;
    proof_numbers(p, &site, v, &grid)?;
    println!();
    println!("{}", if reference_ok && fast_ok { "PASS  all checks" } else { "FAIL  see above" });
    Ok(reference_ok && fast_ok)
}

/// "parking spot" -> "Parking spot".
fn capitalised(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or(String::new(), |f| f.to_uppercase().collect::<String>() + c.as_str())
}

fn check_reference(p: &Paths, v: &Validation, grid: &terrain::Grid) -> Result<bool, String> {
    let spot = &v.check_point;
    let reference = &v.reference_check;

    let sky = skyline::skyline(grid, spot.x, spot.y, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?;
    let blocked = skyline::blocked_fraction(&sky);
    let blocked_diff = blocked - reference.blocked_at_parking_spot;

    println!("{}: x {} m, y {} m in {} ({} x {})", capitalised(&spot.name), spot.x, spot.y, p.near_bin(), grid.width, grid.height);
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

/// The fast layer settings must agree with the precise settings at one point.
fn check_fast(spot: &NamedPoint, grid: &terrain::Grid) -> Result<bool, String> {
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

fn proof_numbers(p: &Paths, site: &Site, v: &Validation, grid: &terrain::Grid) -> Result<(), String> {
    let far_grid = load_far(p)?;
    let far = far_at_centre(grid, &far_grid, &site.far_field_centre, N_DIRS)?;
    let paper = &v.paper_target;
    let spot = &v.check_point;
    let name = &spot.name;

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

    let open_id = &v.open_ground_stop;
    let (ox, oy) = site.stop(open_id)?;
    let (open_ground, _) = precise_with_far(grid, &far, ox, oy)?;

    // The far field is computed at farFieldCentre; at Gale that is the check point, the parking spot.
    println!("\nProof numbers (eye {EYE_HEIGHT_M} m, {N_DIRS} directions, step {STEP_M} m; far field from {FAR_FROM_M} m on {}, computed at the {name})", far_grid.describe());
    println!("  Blocked fraction                                     engine   paper");
    println!("  {name}, near field to {MAX_DIST_M} m (reference)         {near_280:.3}");
    println!("  {name}, near field to {PROOF_MAX_DIST_M} m                     {near_700:.3}");
    println!("  far field alone                                       {far_only:.3}");
    println!("  {name}, near to {PROOF_MAX_DIST_M} m + far field              {with_far:.3}    {:.2}", paper.sky_blocked_at_butte);
    println!("  5 x 5 points, 2.5 m apart, around the spot: min      {lo:.3}");
    println!("                                               max      {hi:.3}    {:.2}", paper.sky_blocked_at_butte);
    println!("  open ground at {open_id} ({ox}, {oy}), with far field   {open_ground:.3}    {:.2}", paper.sky_blocked_reference);

    let mut skies: Vec<(String, Vec<f32>)> = vec![(name.clone(), spot_sky)];
    for id in &v.sky_check_stops {
        let (sx, sy) = site.stop(id)?;
        skies.push((id.clone(), precise_with_far(grid, &far, sx, sy)?.1));
    }
    println!("\n  Sky at {} UT: Sun az {} el {}, Earth az {} el {}", site.sky.time_u_t, site.sky.sun.az, site.sky.sun.el, site.sky.earth.az, site.sky.earth.el);
    for (name, sky) in &skies {
        let describe = |body: AzEl| {
            let horizon = skyline::elevation_at(sky, body.az);
            let seen = if skyline::visible(sky, body.az, body.el) { "visible" } else { "hidden " };
            format!("{seen} (skyline {horizon:.1} deg)")
        };
        println!("  {name:<13} Sun {}   Earth {}", describe(site.sky.sun), describe(site.sky.earth));
    }
    Ok(())
}

/// Compares the site file's baseCandidates (local metres) by base-link coverage and links to each route stop.
fn base_candidates(p: &Paths) -> Result<(), String> {
    let site = load_site(p)?;
    let grid = load_grid(p, &site)?;
    let bc = site.base_candidates.as_ref().ok_or_else(|| format!("{} has no baseCandidates", site.file))?;
    let mast = bc.mast_height;
    let r = &site.layers_region;
    let stops: Vec<&RouteStop> = site.route_stops.iter().filter(|s| s.id != "base").collect();
    println!("Mast {mast} m, eye 1 m, {} x {} layer cells of {} m over x/y {}..{} m\n",
        r.cells, r.cells, r.metres_per_pixel, r.origin_x, r.origin_x + r.cells as f64 * r.metres_per_pixel);
    let header: Vec<String> = stops.iter().map(|s| format!("{:>8}", s.id)).collect();
    println!("{:<3} {:>7} {:>7} {:>10} {:>6}  {}   note", "id", "x", "y", "ground m", "link", header.join(""));
    for c in &bc.candidates {
        let (id, x, y, note) = (&c.id, c.x, c.y, &c.note);
        let base = layers::Base { x, y, mast_height_m: mast };
        let ground = grid.sample_local(x, y).ok_or_else(|| format!("candidate {id} is on no-data"))?;
        let fraction = layers::base_link_fraction(&grid, &base, r);
        let links: Vec<String> = stops
            .iter()
            .map(|s| format!("{:>8}", if layers::base_link(&grid, s.x, s.y, &base) { "yes" } else { "-" }))
            .collect();
        println!("{id:<3} {x:>7.1} {y:>7.1} {ground:>10.2} {fraction:>6.3}  {}   {note}", links.join(""));
    }
    Ok(())
}

fn plan_command(p: &Paths, stops_arg: Option<&str>, out: Option<&str>) -> Result<(), String> {
    let site = load_site(p)?;
    let grid = load_grid(p, &site)?;
    let far_grid = load_far(p)?;
    let spot = &site.far_field_centre;
    let far72 = far_at_centre(&grid, &far_grid, spot, skyline::FAST_DIRS)?;
    let far360 = far_at_centre(&grid, &far_grid, spot, N_DIRS)?;
    let stops: Vec<route::Stop> = match stops_arg {
        None => site
            .route_stops
            .iter()
            .map(|s| route::Stop { id: s.id.clone(), x: s.x, y: s.y, label: s.label.clone(), science: s.science_stop })
            .collect(),
        Some(text) => parse_stops(text)?,
    };
    if stops.len() < 2 {
        return Err("a plan needs at least two stops".into());
    }
    let out_dir = out.map_or_else(|| p.file(&p.out), PathBuf::from);
    if let Some((_, line)) = &site.conditions {
        println!("{line}\n");
    }
    let inputs = plan_inputs(&site, &grid, &far72, &far360, stops);
    route::run(&inputs, &out_dir)
}

/// `--stops "x,y;x,y,label;..."`: the first point is the start and the last the end; the points between are
/// science stops, named by the optional label or "Stop N". Labels cannot contain ';' or ','.
fn parse_stops(text: &str) -> Result<Vec<route::Stop>, String> {
    let parts: Vec<&str> = text.split(';').filter(|p| !p.trim().is_empty()).collect();
    let n = parts.len();
    parts
        .iter()
        .enumerate()
        .map(|(i, part)| {
            let f: Vec<&str> = part.split(',').map(str::trim).collect();
            if f.len() < 2 || f.len() > 3 {
                return Err(format!("stop {part:?} is not x,y or x,y,label"));
            }
            let num = |v: &str| v.parse::<f64>().ok().filter(|x| x.is_finite()).ok_or_else(|| format!("not a number: {v}"));
            let science = i > 0 && i + 1 < n;
            let label = match f.get(2) {
                Some(l) if !l.is_empty() => l.to_string(),
                _ if science => format!("Stop {i}"),
                _ => String::new(),
            };
            Ok(route::Stop { id: format!("p{i:02}"), x: num(f[0])?, y: num(f[1])?, label, science })
        })
        .collect()
}

fn plan_inputs<'a>(site: &Site, grid: &'a terrain::Grid, far72: &'a [f32], far360: &'a [f32], stops: Vec<route::Stop>) -> route::PlanInputs<'a> {
    route::PlanInputs {
        near: grid,
        far72,
        far360,
        sun: (site.sky.sun.az, site.sky.sun.el),
        earth: (site.sky.earth.az, site.sky.earth.el),
        base: layers::Base { x: site.base.x, y: site.base.y, mast_height_m: site.base.mast_height },
        bounds: site.planner_bounds,
        cfg: site.planner.clone(),
        storm: site.storm,
        base_dose_factor: site.base.dose_factor,
        dose_rate_ugy_h: site.rad.as_ref().map(|r| r.baseline_rate),
        space_weather: site.space_weather.clone(),
        conditions: site.conditions.as_ref().map(|c| c.0.clone()),
        stop_images: site.stop_images.clone(),
        shelter_labels: site
            .shelter_labels
            .iter()
            .filter_map(|l| match site.stop(&l.near) {
                Ok((x, y)) => Some((x, y, l.label.clone())),
                Err(e) => {
                    eprintln!("warning: shelterLabels: {e}");
                    None
                }
            })
            .collect(),
        stops,
        region: site.layers_region,
    }
}

/// Warnings for the sweep; the limit to cover equals the warning.
const SWEEP_WARNINGS: [f64; 5] = [0.0, 2.0, 5.0, 10.0, 15.0];

struct DecideArgs {
    index: Option<usize>,
    lead: Option<f64>,
    limit: Option<f64>,
    sweep: bool,
}

/// Storm decisions at main waypoints of data/out/waypoints.json (run `engine plan` first).
fn decide_command(p: &Paths, a: DecideArgs) -> Result<(), String> {
    let site = load_site(p)?;
    let wp_path = p.file(&format!("{}/waypoints.json", p.out));
    let doc: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&wp_path).map_err(|e| format!("cannot read {} (run engine plan first): {}", wp_path.display(), e))?,
    )
    .map_err(|e| format!("{}: {}", wp_path.display(), e))?;
    let main = doc["main"].as_array().ok_or("waypoints.json has no main route")?.clone();
    if main.is_empty() {
        return Err("waypoints.json has an empty main route".into());
    }
    let pos = |i: usize| (main[i]["pos"]["x"].as_f64().unwrap_or(f64::NAN), main[i]["pos"]["y"].as_f64().unwrap_or(f64::NAN));
    let name = |i: usize| main[i]["id"].as_str().unwrap_or("?").to_string();

    let grid = load_grid(p, &site)?;
    let far_grid = load_far(p)?;
    let spot = &site.far_field_centre;
    let far72 = far_at_centre(&grid, &far_grid, spot, skyline::FAST_DIRS)?;
    let far360 = far_at_centre(&grid, &far_grid, spot, N_DIRS)?;
    let inputs = plan_inputs(&site, &grid, &far72, &far360, Vec::new());
    let ctx = route::prepare(&inputs)?;

    if !a.sweep {
        let i = a.index.ok_or_else(usage)?;
        if i >= main.len() {
            return Err(format!("main index {i} is out of range (0..{})", main.len() - 1));
        }
        let mut storm = site.storm;
        storm.lead_minutes = a.lead.unwrap_or(storm.lead_minutes);
        storm.max_minutes_to_cover = a.limit.unwrap_or(storm.max_minutes_to_cover);
        let (x, y) = pos(i);
        println!("\nStorm decision at {} ({x:.1}, {y:.1})", name(i));
        let opts = route::options_from(&ctx, &inputs, x, y)?;
        route::print_table(&decision::decide(&opts.candidates, &storm), &storm);
        return Ok(());
    }

    // Open ground about a third of the way out, the site file's decisionSweep stops (at Gale the Quela stop
    // and the butte outcrop), and the far point.
    let by_label = |label: &str| main.iter().position(|w| w["label"] == label).ok_or_else(|| format!("no main waypoint labelled {label:?}"));
    let mut picks = vec![("open ground".to_string(), (main.len() as f64 / 3.0).round() as usize)];
    for s in &site.decision_sweep {
        picks.push((s.what.clone(), by_label(&s.label)?));
    }
    picks.push(("far point".to_string(), main.len() - 1));
    println!("\nChosen site by warning time (limit to cover = warning); storm {} min, multiplier {}\n", site.storm.storm_minutes, site.storm.dose_multiplier);
    println!("  {:<22} {}", "waypoint", SWEEP_WARNINGS.iter().map(|w| format!("{:>22}", format!("{w} min"))).collect::<String>());
    let mut rows = Vec::new();
    for (what, i) in picks {
        let (x, y) = pos(i);
        let opts = route::options_from(&ctx, &inputs, x, y)?;
        let mut line = format!("  {:<22}", format!("{} {}", name(i), what));
        let mut results = Vec::new();
        for warning in SWEEP_WARNINGS {
            let mut storm = site.storm;
            storm.lead_minutes = warning;
            storm.max_minutes_to_cover = warning;
            let d = decision::decide(&opts.candidates, &storm);
            let c = &d.chosen.candidate;
            let cell = match d.minutes_late {
                Some(late) => format!("{} LATE {:.1}", c.id, late),
                None => format!("{} {:.1}m", c.id, c.t),
            };
            line += &format!("{cell:>22}");
            let mut chosen = serde_json::json!({
                "id": c.id, "label": c.label, "kind": c.kind.as_str(), "minutes": (c.t * 100.0).round() / 100.0,
                "score": (d.chosen.score * 10.0).round() / 10.0, "late": d.minutes_late.is_some(),
            });
            if let Some(late) = d.minutes_late {
                chosen["minutesLate"] = serde_json::json!((late * 100.0).round() / 100.0);
            }
            results.push(serde_json::json!({ "warningMinutes": warning, "limitMinutes": warning, "chosen": chosen }));
        }
        println!("{line}");
        rows.push(serde_json::json!({
            "waypoint": name(i), "mainIndex": i, "what": what, "label": main[i]["label"], "pos": { "x": x, "y": y }, "results": results,
        }));
    }
    println!("\n  (each cell: chosen site and walking minutes, or LATE and minutes past the limit when nothing is reachable)");
    let out = serde_json::json!({
        "version": 1, "stormMinutes": site.storm.storm_minutes, "doseMultiplier": site.storm.dose_multiplier,
        "noLinkPenalty": site.storm.no_link_penalty, "baseDoseFactor": site.base.dose_factor, "waypoints": rows,
    });
    let path = p.file(&format!("{}/decision-sweep.json", p.out));
    std::fs::write(&path, serde_json::to_string_pretty(&out).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("cannot write {}: {}", path.display(), e))?;
    println!("wrote {}", path.display());
    Ok(())
}

fn layers_command(p: &Paths) -> Result<(), String> {
    let site = load_site(p)?;
    let grid = load_grid(p, &site)?;
    let far_grid = load_far(p)?;
    let far = far_at_centre(&grid, &far_grid, &site.far_field_centre, skyline::FAST_DIRS)?;
    let sky = layers::Sky { sun: (site.sky.sun.az, site.sky.sun.el), earth: (site.sky.earth.az, site.sky.earth.el) };
    let base = layers::Base { x: site.base.x, y: site.base.y, mast_height_m: site.base.mast_height };
    println!("Sun az {} el {}, Earth az {} el {}, base ({}, {}) mast {} m", sky.sun.0, sky.sun.1, sky.earth.0, sky.earth.1, base.x, base.y, base.mast_height_m);
    layers::write_layers(&grid, &far, &sky, &base, &site.layers_region, &p.file(&format!("{}/layers", p.out)))
}

fn point(p: &Paths, x: f64, y: f64) -> Result<(), String> {
    let site = load_site(p)?;
    let grid = load_grid(p, &site)?;
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
    "usage: engine [--root <dir>] [--site <name>] <command>   (or SITE=<name>; no site = Gale in data/)\n       engine [--root <dir>] check\n       engine [--root <dir>] point <x> <y>   (local metres)\n       engine [--root <dir>] layers\n       engine [--root <dir>] base-candidates\n       engine [--root <dir>] plan [--stops \"x,y;x,y;...\" --out <dir>]\n       engine [--root <dir>] decide <mainIndex> [--lead L] [--limit X]\n       engine [--root <dir>] decide --sweep".to_string()
}

fn run() -> Result<bool, String> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    if let Some(i) = args.iter().position(|a| a == "--root") {
        let dir = args.get(i + 1).ok_or_else(usage)?.clone();
        root = PathBuf::from(dir);
        args.drain(i..=i + 1);
    }
    let mut site = std::env::var("SITE").ok().filter(|s| !s.is_empty());
    if let Some(i) = args.iter().position(|a| a == "--site") {
        site = Some(args.get(i + 1).ok_or_else(usage)?.clone());
        args.drain(i..=i + 1);
    }
    let paths = Paths::new(root, site)?;
    let root = &paths;

    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["check"] => check(root),
        ["layers"] => layers_command(root).map(|_| true),
        ["base-candidates"] => base_candidates(root).map(|_| true),
        ["decide", rest @ ..] => {
            let mut a = DecideArgs { index: None, lead: None, limit: None, sweep: false };
            let mut it = rest.iter();
            let num = |v: Option<&&str>| -> Result<f64, String> {
                let v = v.ok_or_else(usage)?;
                v.parse::<f64>().map_err(|_| format!("not a number: {v}"))
            };
            while let Some(&arg) = it.next() {
                match arg {
                    "--lead" => a.lead = Some(num(it.next())?),
                    "--limit" => a.limit = Some(num(it.next())?),
                    "--sweep" => a.sweep = true,
                    other => a.index = Some(other.parse().map_err(|_| format!("main index must be a whole number: {other}"))?),
                }
            }
            if a.sweep && (a.index.is_some() || a.lead.is_some() || a.limit.is_some()) {
                return Err("--sweep takes no index, --lead or --limit".into());
            }
            decide_command(root, a).map(|_| true)
        }
        ["plan", rest @ ..] => {
            let mut stops = None;
            let mut out = None;
            let mut it = rest.iter();
            while let Some(&flag) = it.next() {
                match flag {
                    "--stops" => stops = Some(*it.next().ok_or_else(usage)?),
                    "--out" => out = Some(*it.next().ok_or_else(usage)?),
                    _ => return Err(usage()),
                }
            }
            if stops.is_some() != out.is_some() {
                return Err("--stops and --out go together, so a custom plan never overwrites the site's out folder".into());
            }
            plan_command(root, stops, out).map(|_| true)
        }
        ["point", x, y] => {
            let parse = |s: &str| s.parse::<f64>().map_err(|_| format!("not a number: {s}"));
            point(root, parse(x)?, parse(y)?).map(|_| true)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_stops_mark_the_middle_points_as_named_science_stops() {
        let s = parse_stops("1598,1250; 1500,1500,Quela drill site ;1508,1561;1500,1628;").unwrap();
        let got: Vec<(&str, bool)> = s.iter().map(|x| (x.label.as_str(), x.science)).collect();
        assert_eq!(got, [("", false), ("Quela drill site", true), ("Stop 2", true), ("", false)]);
        assert_eq!((s[1].x, s[1].y, s[3].id.as_str()), (1500.0, 1500.0, "p03"));
        assert!(parse_stops("1,2;3").is_err() && parse_stops("1,2;3,nan").is_err() && parse_stops("1,2,a,b;3,4").is_err());
    }

    #[test]
    fn default_site_keeps_the_gale_layout() {
        let p = Paths::new(PathBuf::from("/repo"), None).unwrap();
        assert_eq!((p.site_json.as_str(), p.raw.as_str(), p.out.as_str()), ("data/site.json", "data/raw", "data/out"));
        assert_eq!((p.rems_cache(), p.rad_cache()), ("data/cache/rems.json".to_string(), "data/cache/rad_storm.json".to_string()));
        assert_eq!(p.near_bin(), "data/raw/near.bin");
    }

    #[test]
    fn named_site_uses_its_own_folders_and_shares_site_independent_caches() {
        let dir = std::env::temp_dir().join(format!("beacon-site-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("data/sites/mawrth")).unwrap();
        std::fs::write(dir.join("data/sites/mawrth/site.json"), "{}").unwrap();
        let p = Paths::new(dir.clone(), Some("mawrth".into())).unwrap();
        assert_eq!((p.site_json.as_str(), p.raw.as_str(), p.out.as_str()), ("data/sites/mawrth/site.json", "data/raw/mawrth", "data/out/mawrth"));
        assert_eq!((p.rems_cache(), p.images_cache()), ("data/cache/mawrth/rems.json".to_string(), "data/cache/mawrth/stop_images.json".to_string()));
        assert_eq!((p.rad_cache(), p.donki_cache()), ("data/cache/rad_storm.json".to_string(), "data/cache/donki_mars.json".to_string()));
        assert!(Paths::new(dir.clone(), Some("nope".into())).is_err());
        assert!(Paths::new(dir.clone(), Some("../x".into())).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn gale_site_file_parses_with_its_validation_section() {
        let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/site.json")).unwrap();
        let site: Site = serde_json::from_str(&text).unwrap();
        let v = site.validation.expect("Gale has ground truth");
        assert_eq!((v.check_point.name.as_str(), v.open_ground_stop.as_str()), ("parking spot", "sol1468"));
        assert_eq!(site.layers_region, layers::Region { origin_x: 748.0, origin_y: 748.0, cells: 375, metres_per_pixel: 4.0 });
        assert_eq!(site.base_candidates.unwrap().candidates.len(), 4);
    }
}

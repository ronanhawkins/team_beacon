//! Beacon terrain engine.
//!
//!   engine check                  skyline at the parking spot vs data/site.json referenceCheck
//!   engine point <col> <row>      blocked fraction and 72-value skyline as one line of JSON
//!
//! Paths are relative to the repo root (the folder above engine/). Override with --root <dir>.

mod skyline;
mod terrain;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;

const NEAR_BIN: &str = "data/raw/near.bin";
const SITE_JSON: &str = "data/site.json";

// Settings matching referenceCheck.method in data/site.json.
const EYE_HEIGHT_M: f64 = 1.0;
const N_DIRS: usize = 360;
const STEP_M: f64 = 0.5;
const MAX_DIST_M: f64 = 280.0;

const CONTRACT_SAMPLES: usize = 72;
const BLOCKED_TOLERANCE: f32 = 0.01;
const ANGLE_TOLERANCE_DEG: f32 = 1.5;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Site {
    near_crop: NearCrop,
    reference_check: ReferenceCheck,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NearCrop {
    parking_spot_in_crop: ColRow,
}

#[derive(Deserialize)]
struct ColRow {
    col: f64,
    row: f64,
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

fn check(root: &Path) -> Result<bool, String> {
    let site = load_site(root)?;
    let grid = load_grid(root)?;
    let spot = &site.near_crop.parking_spot_in_crop;
    let reference = &site.reference_check;

    let sky = skyline::skyline(&grid, spot.col, spot.row, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?;
    let blocked = skyline::blocked_fraction(&sky);
    let blocked_diff = blocked - reference.blocked_at_parking_spot;

    println!("Parking spot: col {}, row {} in {} ({} x {})", spot.col, spot.row, NEAR_BIN, grid.width, grid.height);
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

fn point(root: &Path, col: f64, row: f64) -> Result<(), String> {
    let grid = load_grid(root)?;
    let sky = skyline::skyline(&grid, col, row, EYE_HEIGHT_M, N_DIRS, STEP_M, MAX_DIST_M)?;
    let blocked = skyline::blocked_fraction(&sky);
    let sky72: Vec<f64> = skyline::resample(&sky, CONTRACT_SAMPLES)
        .iter()
        .map(|&a| (a as f64 * 10.0).round() / 10.0)
        .collect();
    let out = serde_json::json!({
        "col": col,
        "row": row,
        "blocked": (blocked as f64 * 1000.0).round() / 1000.0,
        "skyline": sky72,
    });
    println!("{out}");
    Ok(())
}

fn usage() -> String {
    "usage: engine [--root <dir>] check\n       engine [--root <dir>] point <col> <row>".to_string()
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
        ["point", col, row] => {
            let parse = |s: &str| s.parse::<f64>().map_err(|_| format!("not a number: {s}"));
            point(&root, parse(col)?, parse(row)?).map(|_| true)
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

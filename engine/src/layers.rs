//! Map layers for the hub (shared/layers.md): one 8-bit greyscale PNG per
//! layer plus meta.json, over a square region of the near crop.

use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;

use crate::sight::line_of_sight;
use crate::skyline::{self, FAST_DIRS};
use crate::terrain::Grid;

/// The square the layers cover, from the site file's `layersRegion`: south-west corner at local
/// (origin_x, origin_y) metres, `cells` x `cells` cells of `metres_per_pixel`. At Gale and Jezero: the whole 3 km crop, 0 to 3000 m in 4 m cells.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub origin_x: f64,
    pub origin_y: f64,
    pub cells: usize,
    pub metres_per_pixel: f64,
}

impl Region {
    /// Local metres of the centre of image cell (col, row); row 0 is the north edge.
    pub fn cell_centre(&self, col: usize, row: usize) -> (f64, f64) {
        let x = self.origin_x + (col as f64 + 0.5) * self.metres_per_pixel;
        let y = self.origin_y + ((self.cells - row) as f64 - 0.5) * self.metres_per_pixel;
        (x, y)
    }
}

const EYE_HEIGHT_M: f64 = 1.0;
const SIGHT_STEP_M: f64 = 1.0;
const SLOPE_MAX_DEG: f64 = 45.0;
// Exposure is written over 0.6..1.0 so the image has contrast; lower values clamp to 0.6.
const EXPOSURE_MIN: f64 = 0.6;

pub struct Sky {
    pub sun: (f64, f64),   // az, el in degrees
    pub earth: (f64, f64), // az, el in degrees
}

pub struct Base {
    pub x: f64,
    pub y: f64,
    pub mast_height_m: f64,
}

/// One output layer: name, file, value range written to meta.json, and values row by row (row 0 north).
struct Layer {
    name: &'static str,
    min: f64,
    max: f64,
    values: Vec<f32>,
}

/// Line of sight from a 1 m eye at a cell centre to the base mast.
pub fn base_link(near: &Grid, x: f64, y: f64, base: &Base) -> bool {
    line_of_sight(near, (x, y), EYE_HEIGHT_M, (base.x, base.y), base.mast_height_m, SIGHT_STEP_M)
}

/// Fraction of the region's cells with a base link, as the baseLink layer computes it.
pub fn base_link_fraction(near: &Grid, base: &Base, region: &Region) -> f64 {
    let cells = region.cells;
    let linked = (0..cells * cells)
        .into_par_iter()
        .filter(|&i| {
            let (x, y) = region.cell_centre(i % cells, i / cells);
            base_link(near, x, y, base)
        })
        .count();
    linked as f64 / (cells * cells) as f64
}

/// Mean height of every 4 m cell in the region plus a one-cell ring around it,
/// indexed [(row + 1) * (cells + 2) + (col + 1)] with row 0 at the north edge.
fn block_heights(near: &Grid, region: &Region) -> Vec<Option<f32>> {
    let (n, cell) = (region.cells + 2, region.metres_per_pixel);
    (0..n * n)
        .into_par_iter()
        .map(|i| {
            let (col, row) = ((i % n) as f64 - 1.0, (i / n) as f64 - 1.0);
            let x_min = region.origin_x + col * cell;
            let y_min = region.origin_y + (region.cells as f64 - 1.0 - row) * cell;
            near.block_mean_local(x_min, y_min, cell)
        })
        .collect()
}

/// Slope in degrees at image cell (col, row), from central differences of the 4 m mean heights.
fn slope_at(blocks: &[Option<f32>], region: &Region, col: usize, row: usize) -> Option<f32> {
    let (n, cell) = (region.cells + 2, region.metres_per_pixel);
    let at = |c: usize, r: usize| blocks[r * n + c].map(|h| h as f64);
    let (c, r) = (col + 1, row + 1);
    let dzdx = (at(c + 1, r)? - at(c - 1, r)?) / (2.0 * cell);
    let dzdy = (at(c, r - 1)? - at(c, r + 1)?) / (2.0 * cell);
    Some(dzdx.hypot(dzdy).atan().to_degrees() as f32)
}

/// Adds or replaces layer entries in `out_dir/meta.json`, keeping entries written by other
/// commands (the planner writes minutesToShelter) as long as the image geometry matches.
pub fn update_meta(out_dir: &Path, region: &Region, entries: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let meta_path = out_dir.join("meta.json");
    let geometry = serde_json::json!({
        "version": 1,
        "width": region.cells,
        "height": region.cells,
        "metresPerPixel": region.metres_per_pixel,
        "originX": region.origin_x,
        "originY": region.origin_y,
    });
    let mut layers = serde_json::Map::new();
    if let Some(old) = std::fs::read_to_string(&meta_path).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
        let same = ["width", "height", "metresPerPixel", "originX", "originY"].iter().all(|k| old.get(k) == geometry.get(k));
        if let (true, Some(old_layers)) = (same, old.get("layers").and_then(|l| l.as_object())) {
            layers = old_layers.clone();
        }
    }
    layers.extend(entries);
    let mut meta = geometry;
    meta["layers"] = serde_json::Value::Object(layers);
    let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&meta_path, text).map_err(|e| format!("cannot write {}: {}", meta_path.display(), e))
}

/// Computes every layer, writes the PNGs and meta.json into `out_dir`, and
/// prints a summary. `far` is the 72-direction far-field skyline, reused for every cell.
/// `beyond` (far.bin) continues the near-field march for cells whose 700 m reach crosses the edge of `near`.
pub fn write_layers(near: &Grid, beyond: Option<&Grid>, far: &[f32], sky: &Sky, base: &Base, region: &Region, out_dir: &Path) -> Result<(), String> {
    assert_eq!(far.len(), FAST_DIRS);
    let started = Instant::now();
    let distances = skyline::fast_distances();
    let blocks = block_heights(near, region);
    let cells_n = region.cells;

    // Each cell: [exposure, sunlight, earthLink, baseLink, slope]. NaN marks a cell that could not be computed.
    let cells: Vec<[f32; 5]> = (0..cells_n * cells_n)
        .into_par_iter()
        .map(|i| {
            let (col, row) = (i % cells_n, i / cells_n);
            let (x, y) = region.cell_centre(col, row);
            let slope = slope_at(&blocks, region, col, row).unwrap_or(f32::NAN);
            let Ok(near_sky) = skyline::fast_skyline_beyond(near, beyond, x, y, EYE_HEIGHT_M, &distances) else {
                return [f32::NAN, f32::NAN, f32::NAN, f32::NAN, slope];
            };
            let merged = skyline::merge(&near_sky, far);
            let flag = |b: bool| if b { 1.0 } else { 0.0 };
            [
                1.0 - skyline::blocked_fraction(&merged),
                flag(skyline::visible(&merged, sky.sun.0, sky.sun.1)),
                flag(skyline::visible(&merged, sky.earth.0, sky.earth.1)),
                flag(base_link(near, x, y, base)),
                slope,
            ]
        })
        .collect();
    let computed = started.elapsed();

    let column = |k: usize| cells.iter().map(|c| c[k]).collect::<Vec<f32>>();
    let layers = [
        Layer { name: "exposure", min: EXPOSURE_MIN, max: 1.0, values: column(0) },
        Layer { name: "sunlight", min: 0.0, max: 1.0, values: column(1) },
        Layer { name: "earthLink", min: 0.0, max: 1.0, values: column(2) },
        Layer { name: "baseLink", min: 0.0, max: 1.0, values: column(3) },
        Layer { name: "slope", min: 0.0, max: SLOPE_MAX_DEG, values: column(4) },
    ];

    std::fs::create_dir_all(out_dir).map_err(|e| format!("cannot create {}: {}", out_dir.display(), e))?;
    let mut meta_layers = serde_json::Map::new();
    println!("{:<12} {:>8} {:>8} {:>8} {:>8}", "layer", "min", "mean", "max", "missing");
    for layer in &layers {
        let file = format!("{}.png", layer.name);
        let bytes: Vec<u8> = layer
            .values
            .iter()
            .map(|&v| if v.is_nan() { 0 } else { (((v as f64 - layer.min) / (layer.max - layer.min)) * 255.0).round().clamp(0.0, 255.0) as u8 })
            .collect();
        let img = image::GrayImage::from_raw(cells_n as u32, cells_n as u32, bytes).ok_or("image buffer has the wrong size")?;
        let path = out_dir.join(&file);
        img.save(&path).map_err(|e| format!("cannot write {}: {}", path.display(), e))?;
        meta_layers.insert(layer.name.to_string(), serde_json::json!({ "file": file, "min": layer.min, "max": layer.max }));

        let ok: Vec<f32> = layer.values.iter().copied().filter(|v| !v.is_nan()).collect();
        let (lo, hi) = ok.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
        let mean = ok.iter().map(|&v| v as f64).sum::<f64>() / ok.len().max(1) as f64;
        println!("{:<12} {:>8.3} {:>8.3} {:>8.3} {:>8}", layer.name, lo, mean, hi, layer.values.len() - ok.len());
    }

    update_meta(out_dir, region, meta_layers)?;

    println!(
        "\n{} x {} cells, {} m, region x/y {}..{} m, {} threads",
        cells_n,
        cells_n,
        region.metres_per_pixel,
        region.origin_x,
        region.origin_x + cells_n as f64 * region.metres_per_pixel,
        rayon::current_num_threads()
    );
    println!("computed in {:.2} s, written in {:.2} s total", computed.as_secs_f64(), started.elapsed().as_secs_f64());
    println!("wrote {} PNGs and meta.json to {}", layers.len(), out_dir.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_centres_follow_layers_md() {
        let r = Region { origin_x: 748.0, origin_y: 748.0, cells: 375, metres_per_pixel: 4.0 };
        // Row 0 is north: the north-west cell's centre is half a cell in from the region's NW corner.
        assert_eq!(r.cell_centre(0, 0), (750.0, 748.0 + 1500.0 - 2.0));
        // The south-east cell.
        assert_eq!(r.cell_centre(374, 374), (748.0 + 1500.0 - 2.0, 750.0));
    }
}

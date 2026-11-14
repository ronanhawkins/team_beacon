//! Terrain grid: loading an ENVI float32 raster and sampling it.
//!
//! Positions outside this file are local metres (shared/conventions.md):
//! x east, y north, origin at the south-west outer corner of the grid.
//! Inside, array indices are used: row 0 is the north edge, column 0 the
//! west edge, and whole-number (col, row) is the centre of that cell.
//! `local_to_index` is the only place that converts between the two.
//!
//! Each grid also knows where it sits in the mosaic's projection (easting and
//! northing of its top-left corner), so a position in one grid can be found
//! in another: `local_to_en` on one, then `en_to_local` on the other.

use std::fs;
use std::path::{Path, PathBuf};

pub const NO_DATA: f32 = -32767.0;

pub struct Grid {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
    pub metres_per_pixel: f64,
    /// Easting of the grid's top-left (north-west) outer corner, metres.
    pub origin_easting: f64,
    /// Northing of the grid's top-left (north-west) outer corner, metres.
    pub origin_northing: f64,
}

impl Grid {
    /// A grid built in code, for tests. Top-left corner at easting 0, northing = its height in metres,
    /// so local metres and easting/northing coincide.
    #[cfg(test)]
    pub fn synthetic(width: usize, height: usize, data: Vec<f32>, metres_per_pixel: f64) -> Grid {
        assert_eq!(data.len(), width * height);
        let origin_northing = height as f64 * metres_per_pixel;
        Grid { width, height, data, metres_per_pixel, origin_easting: 0.0, origin_northing }
    }

    /// Value of one cell, or None if outside the grid or no-data.
    pub fn cell(&self, col: usize, row: usize) -> Option<f32> {
        if col >= self.width || row >= self.height {
            return None;
        }
        let v = self.data[row * self.width + col];
        if v == NO_DATA || !v.is_finite() { None } else { Some(v) }
    }

    /// Array indices for a local position in metres. The one conversion point.
    pub fn local_to_index(&self, x: f64, y: f64) -> (f64, f64) {
        let mpp = self.metres_per_pixel;
        let col = x / mpp - 0.5;
        let row = (self.height as f64 * mpp - y) / mpp - 0.5;
        (col, row)
    }

    /// Easting and northing of a local position.
    pub fn local_to_en(&self, x: f64, y: f64) -> (f64, f64) {
        let south = self.origin_northing - self.height as f64 * self.metres_per_pixel;
        (self.origin_easting + x, south + y)
    }

    /// Local position of an easting and northing.
    pub fn en_to_local(&self, easting: f64, northing: f64) -> (f64, f64) {
        let south = self.origin_northing - self.height as f64 * self.metres_per_pixel;
        (easting - self.origin_easting, northing - south)
    }

    /// True if the local position (x, y) lies inside the grid's cell centres.
    pub fn contains_local(&self, x: f64, y: f64) -> bool {
        let (col, row) = self.local_to_index(x, y);
        self.contains(col, row)
    }

    /// Bilinear sample at a local position in metres. See `sample`.
    pub fn sample_local(&self, x: f64, y: f64) -> Option<f32> {
        let (col, row) = self.local_to_index(x, y);
        self.sample(col, row)
    }

    /// Mean of the cells whose centres fall inside the square from (x_min, y_min)
    /// to (x_min + size_m, y_min + size_m), local metres. No-data cells are left
    /// out; None if every cell is no-data or the square is outside the grid.
    pub fn block_mean_local(&self, x_min: f64, y_min: f64, size_m: f64) -> Option<f32> {
        // Cell centres inside the square, as array indices.
        let (c_lo, r_hi) = self.local_to_index(x_min, y_min);
        let (c_hi, r_lo) = self.local_to_index(x_min + size_m, y_min + size_m);
        let (c0, c1) = (c_lo.ceil().max(0.0) as usize, c_hi.floor());
        let (r0, r1) = (r_lo.ceil().max(0.0) as usize, r_hi.floor());
        if c1 < 0.0 || r1 < 0.0 {
            return None;
        }
        let (c1, r1) = ((c1 as usize).min(self.width - 1), (r1 as usize).min(self.height - 1));
        let (mut sum, mut n) = (0.0f64, 0usize);
        for row in r0..=r1 {
            for col in c0..=c1 {
                if let Some(v) = self.cell(col, row) {
                    sum += v as f64;
                    n += 1;
                }
            }
        }
        (n > 0).then(|| (sum / n as f64) as f32)
    }

    /// True if array indices (col, row) lie inside the grid's cell centres.
    pub fn contains(&self, col: f64, row: f64) -> bool {
        col >= 0.0 && row >= 0.0 && col <= (self.width - 1) as f64 && row <= (self.height - 1) as f64
    }

    /// Bilinear blend of the four nearest cells, at array indices (whole
    /// numbers are cell centres). None if outside the grid
    /// or if any of the four cells is no-data.
    pub fn sample(&self, col: f64, row: f64) -> Option<f32> {
        if !self.contains(col, row) {
            return None;
        }
        let c0 = col.floor() as usize;
        let r0 = row.floor() as usize;
        // On the last column or row the "next" cell does not exist; its weight is 0 there.
        let c1 = (c0 + 1).min(self.width - 1);
        let r1 = (r0 + 1).min(self.height - 1);
        let fx = col - c0 as f64;
        let fy = row - r0 as f64;

        let v00 = self.cell(c0, r0)? as f64;
        let v10 = self.cell(c1, r0)? as f64;
        let v01 = self.cell(c0, r1)? as f64;
        let v11 = self.cell(c1, r1)? as f64;

        let top = v00 * (1.0 - fx) + v10 * fx;
        let bottom = v01 * (1.0 - fx) + v11 * fx;
        Some((top * (1.0 - fy) + bottom * fy) as f32)
    }
}

/// Header path for a .bin file: tries `near.hdr`, then `near.bin.hdr`.
fn header_path(bin_path: &Path) -> Result<PathBuf, String> {
    let candidates = [bin_path.with_extension("hdr"), PathBuf::from(format!("{}.hdr", bin_path.display()))];
    candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| format!("no ENVI header found next to {} (tried {})", bin_path.display(), candidates[0].display()))
}

/// Reads `key = value` pairs from an ENVI header. Keys are lower-cased.
/// A `{ ... }` value is kept whole when it is on one line (like "map info")
/// and skipped when it spans several lines; none of the keys we need do.
fn parse_header(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    for line in text.lines() {
        if depth > 0 {
            depth += line.matches('{').count() as i32 - line.matches('}').count() as i32;
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim();
            depth = v.matches('{').count() as i32 - v.matches('}').count() as i32;
            out.push((k.trim().to_lowercase(), v.to_string()));
        }
    }
    out
}

fn header_value<'a>(fields: &'a [(String, String)], key: &str, hdr: &Path) -> Result<&'a str, String> {
    fields
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .ok_or_else(|| format!("{}: missing \"{}\"", hdr.display(), key))
}

fn header_usize(fields: &[(String, String)], key: &str, hdr: &Path) -> Result<usize, String> {
    let v = header_value(fields, key, hdr)?;
    v.parse().map_err(|_| format!("{}: \"{}\" is not a whole number: {}", hdr.display(), key, v))
}

/// Parsed ENVI "map info": metres per pixel and the top-left corner's easting and northing.
struct MapInfo {
    metres_per_pixel: f64,
    origin_easting: f64,
    origin_northing: f64,
}

/// `{Equirectangular, 1, 1, 8140057.49, -276807.07, 1, 1}`: projection name, reference
/// pixel (1-based, 1,1 = the top-left corner), its easting and northing, then the
/// x and y pixel size.
fn parse_map_info(value: &str, hdr: &Path) -> Result<MapInfo, String> {
    let bad = |why: &str| format!("{}: cannot read \"map info\" ({why}): {value}", hdr.display());
    let inner = value.trim().trim_start_matches('{').trim_end_matches('}');
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() < 7 {
        return Err(bad("expected at least 7 fields"));
    }
    let num = |i: usize| parts[i].parse::<f64>().map_err(|_| bad(&format!("field {} is not a number", i + 1)));
    let (ref_px, ref_py, ref_e, ref_n, xres, yres) = (num(1)?, num(2)?, num(3)?, num(4)?, num(5)?, num(6)?);
    if (xres - yres).abs() > 1e-9 || xres <= 0.0 {
        return Err(bad("pixels must be square and positive"));
    }
    Ok(MapInfo {
        metres_per_pixel: xres,
        origin_easting: ref_e - (ref_px - 1.0) * xres,
        origin_northing: ref_n + (ref_py - 1.0) * yres,
    })
}

/// The header's "data ignore value", if any.
fn data_ignore_value(fields: &[(String, String)], hdr: &Path) -> Result<Option<f32>, String> {
    match fields.iter().find(|(k, _)| k == "data ignore value") {
        None => Ok(None),
        Some((_, v)) => v.parse::<f32>().map(Some).map_err(|_| format!("{}: \"data ignore value\" is not a number: {}", hdr.display(), v)),
    }
}

/// Loads a float32 ENVI raster and its header.
pub fn load(bin_path: &Path) -> Result<Grid, String> {
    let hdr = header_path(bin_path)?;
    let text = fs::read_to_string(&hdr).map_err(|e| format!("cannot read {}: {}", hdr.display(), e))?;
    let fields = parse_header(&text);

    let width = header_usize(&fields, "samples", &hdr)?;
    let height = header_usize(&fields, "lines", &hdr)?;
    let byte_order = header_usize(&fields, "byte order", &hdr)?;
    if byte_order != 0 {
        return Err(format!(
            "{}: byte order is {}, only 0 (little-endian) is supported",
            hdr.display(),
            byte_order
        ));
    }
    let map = parse_map_info(header_value(&fields, "map info", &hdr)?, &hdr)?;

    let bytes = fs::read(bin_path).map_err(|e| format!("cannot read {}: {}", bin_path.display(), e))?;
    let expected = width * height * 4;
    if bytes.len() != expected {
        return Err(format!(
            "{}: size is {} bytes, header says {} x {} x 4 = {} bytes",
            bin_path.display(),
            bytes.len(),
            width,
            height,
            expected
        ));
    }

    // A file's own no-data value (MOLA uses -32768) is mapped to NO_DATA, so `cell` needs only one.
    let ignore = data_ignore_value(&fields, &hdr)?;
    let data = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .map(|v| if ignore == Some(v) { NO_DATA } else { v })
        .collect();

    Ok(Grid {
        width,
        height,
        data,
        metres_per_pixel: map.metres_per_pixel,
        origin_easting: map.origin_easting,
        origin_northing: map.origin_northing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_own_no_data_value_becomes_no_data() {
        let dir = std::env::temp_dir().join(format!("beacon-terrain-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("m.bin");
        let values = [1.0f32, -32768.0, 3.0, 4.0];
        fs::write(&bin, values.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap();
        let hdr = "ENVI\nsamples = 2\nlines = 2\nbands = 1\ndata type = 4\nbyte order = 0\nmap info = {Equirectangular, 1, 1, 100, 200, 10, 10}\ndata ignore value = -32768\n";
        fs::write(dir.join("m.hdr"), hdr).unwrap();
        let g = load(&bin).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(g.cell(0, 0), Some(1.0));
        assert_eq!(g.cell(1, 0), None);
        assert_eq!((g.origin_easting, g.origin_northing, g.metres_per_pixel), (100.0, 200.0, 10.0));
    }

    #[test]
    fn bilinear_and_edges() {
        let g = Grid::synthetic(2, 2, vec![0.0, 10.0, 20.0, 30.0], 1.0);
        assert_eq!(g.sample(0.0, 0.0), Some(0.0));
        assert_eq!(g.sample(1.0, 1.0), Some(30.0));
        assert_eq!(g.sample(0.5, 0.5), Some(15.0));
        assert_eq!(g.sample(1.5, 0.0), None);
        assert_eq!(g.sample(-0.1, 0.0), None);
    }

    #[test]
    fn no_data_in_any_corner_gives_none() {
        let g = Grid::synthetic(2, 2, vec![0.0, NO_DATA, 0.0, 0.0], 1.0);
        assert_eq!(g.sample(0.5, 0.5), None);
        assert_eq!(g.sample(0.0, 1.0), Some(0.0));
    }

    #[test]
    fn sample_local_uses_cell_centres() {
        // 0.5 m cells whose value is the x of the cell centre, in metres.
        let (width, height, mpp) = (20, 6, 0.5);
        let mut data = Vec::new();
        for _row in 0..height {
            for col in 0..width {
                data.push(((col as f64 + 0.5) * mpp) as f32);
            }
        }
        let g = Grid::synthetic(width, height, data, mpp);
        for (x, y) in [(0.25, 0.25), (0.6, 1.1), (1.37, 2.0), (3.14159, 0.9), (5.0, 2.7), (9.75, 2.75)] {
            let v = g.sample_local(x, y).unwrap() as f64;
            assert!((v - x).abs() < 1e-5, "x {x}, y {y}: got {v}");
        }
        // Outside the outermost cell centres there are not four cells to blend.
        assert_eq!(g.sample_local(0.2, 1.0), None);
        assert_eq!(g.sample_local(1.0, 2.9), None);
    }

    #[test]
    fn local_to_index_corners_and_centres() {
        let g = Grid::synthetic(4, 3, vec![0.0; 12], 2.0);
        // Centre of the north-west cell (0, 0) is x 1, y 5.
        assert_eq!(g.local_to_index(1.0, 5.0), (0.0, 0.0));
        // Centre of the south-east cell (3, 2) is x 7, y 1.
        assert_eq!(g.local_to_index(7.0, 1.0), (3.0, 2.0));
        // The south-west outer corner is half a cell outside cell (0, 2).
        assert_eq!(g.local_to_index(0.0, 0.0), (-0.5, 2.5));
    }

    #[test]
    fn easting_northing_round_trip_between_grids() {
        // A 1 m grid and a 20 m grid in the same projection, as near.bin and far.bin.
        let near = Grid {
            width: 3000, height: 3000, data: vec![], metres_per_pixel: 1.0,
            origin_easting: 8140057.492786, origin_northing: -276807.075189,
        };
        let far = Grid {
            width: 1649, height: 2872, data: vec![], metres_per_pixel: 20.0,
            origin_easting: 8127993.492786, origin_northing: -244781.075189,
        };
        let (e, n) = near.local_to_en(1500.415, 1500.383);
        assert!((e - 8141557.908).abs() < 0.001 && (n - (-278306.692)).abs() < 0.001, "{e} {n}");
        let (fx, fy) = far.en_to_local(e, n);
        let (e2, n2) = far.local_to_en(fx, fy);
        assert!((e2 - e).abs() < 1e-6 && (n2 - n).abs() < 1e-6);
        let (x, y) = near.en_to_local(e2, n2);
        assert!((x - 1500.415).abs() < 1e-6 && (y - 1500.383).abs() < 1e-6);
    }

    #[test]
    fn block_mean_averages_cells_inside_the_square() {
        // 1 m cells valued by column: 0, 1, 2, ...
        let g = Grid::synthetic(8, 8, (0..64).map(|i| (i % 8) as f32).collect(), 1.0);
        // Square x 0..4 covers columns 0..3, mean 1.5.
        assert_eq!(g.block_mean_local(0.0, 0.0, 4.0), Some(1.5));
        assert_eq!(g.block_mean_local(4.0, 4.0, 4.0), Some(5.5));
    }

    #[test]
    fn header_parsing_and_map_info() {
        let f = parse_header(
            "ENVI\ndescription = {\nnear.bin}\nsamples = 3000\nlines   = 2000\nbyte order = 0\n\
             map info = {Equirectangular, 1, 1, 8127993.49278602, -244781.075189438, 20, 20}\n",
        );
        let get = |k: &str| f.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        assert_eq!(get("samples").as_deref(), Some("3000"));
        assert_eq!(get("lines").as_deref(), Some("2000"));
        assert_eq!(get("byte order").as_deref(), Some("0"));
        let m = parse_map_info(&get("map info").unwrap(), Path::new("x.hdr")).unwrap();
        assert_eq!(m.metres_per_pixel, 20.0);
        assert!((m.origin_easting - 8127993.49278602).abs() < 1e-6);
        assert!((m.origin_northing - -244781.075189438).abs() < 1e-6);
        // A reference pixel other than the corner moves the origin.
        let m = parse_map_info("{X, 2, 3, 100, 50, 10, 10}", Path::new("x.hdr")).unwrap();
        assert_eq!((m.origin_easting, m.origin_northing), (90.0, 70.0));
    }
}

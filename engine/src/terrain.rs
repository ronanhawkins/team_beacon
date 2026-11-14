//! Terrain grid: loading an ENVI float32 raster and sampling it.
//!
//! Positions outside this file are local metres (shared/conventions.md):
//! x east, y north, origin at the south-west outer corner of the crop.
//! Inside, array indices are used: row 0 is the north edge, column 0 the
//! west edge, and whole-number (col, row) is the centre of that cell.
//! `local_to_index` is the only place that converts between the two.

use std::fs;
use std::path::{Path, PathBuf};

pub const NO_DATA: f32 = -32767.0;

pub struct Grid {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
    pub metres_per_pixel: f64,
}

impl Grid {
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
/// Multi-line `{ ... }` values are skipped; none of the keys we need use them.
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

fn header_usize(fields: &[(String, String)], key: &str, hdr: &Path) -> Result<usize, String> {
    let (_, v) = fields
        .iter()
        .find(|(k, _)| k == key)
        .ok_or_else(|| format!("{}: missing \"{}\"", hdr.display(), key))?;
    v.parse().map_err(|_| format!("{}: \"{}\" is not a whole number: {}", hdr.display(), key, v))
}

/// Loads a 1 m/px float32 ENVI raster and its header.
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

    let data = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    Ok(Grid { width, height, data, metres_per_pixel: 1.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(width: usize, height: usize, data: Vec<f32>) -> Grid {
        Grid { width, height, data, metres_per_pixel: 1.0 }
    }

    #[test]
    fn bilinear_and_edges() {
        let g = grid(2, 2, vec![0.0, 10.0, 20.0, 30.0]);
        assert_eq!(g.sample(0.0, 0.0), Some(0.0));
        assert_eq!(g.sample(1.0, 1.0), Some(30.0));
        assert_eq!(g.sample(0.5, 0.5), Some(15.0));
        assert_eq!(g.sample(1.5, 0.0), None);
        assert_eq!(g.sample(-0.1, 0.0), None);
    }

    #[test]
    fn no_data_in_any_corner_gives_none() {
        let g = grid(2, 2, vec![0.0, NO_DATA, 0.0, 0.0]);
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
        let g = Grid { width, height, data, metres_per_pixel: mpp };
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
        let g = Grid { width: 4, height: 3, data: vec![0.0; 12], metres_per_pixel: 2.0 };
        // Centre of the north-west cell (0, 0) is x 1, y 5.
        assert_eq!(g.local_to_index(1.0, 5.0), (0.0, 0.0));
        // Centre of the south-east cell (3, 2) is x 7, y 1.
        assert_eq!(g.local_to_index(7.0, 1.0), (3.0, 2.0));
        // The south-west outer corner is half a cell outside cell (0, 2).
        assert_eq!(g.local_to_index(0.0, 0.0), (-0.5, 2.5));
    }

    #[test]
    fn header_parsing_skips_braces() {
        let f = parse_header("ENVI\ndescription = {\nnear.bin}\nsamples = 3000\nlines   = 2000\nbyte order = 0\n");
        let get = |k: &str| f.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        assert_eq!(get("samples").as_deref(), Some("3000"));
        assert_eq!(get("lines").as_deref(), Some("2000"));
        assert_eq!(get("byte order").as_deref(), Some("0"));
    }
}

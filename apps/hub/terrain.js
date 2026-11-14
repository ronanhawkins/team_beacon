// Height grid loading and sampling.
// Frame and grid cells follow shared/conventions.md: origin at the south-west corner of the crop,
// x east, y north, z up, metres. A cell's value belongs to its CENTRE: sample (col, row), row 0 at the
// north edge, sits at x = (col + 0.5) * cell, y = (rows - row - 0.5) * cell. The crop is cols * cell wide.
export function makeTerrain({ cols, rows, cellSize }, heights) {
  const cell = cellSize;
  if (heights.length < cols * rows) throw new Error(`terrain: expected ${cols * rows} heights, got ${heights.length}`);
  const W = cols * cell, H = rows * cell;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < cols * rows; i++) { const v = heights[i]; if (Number.isFinite(v)) { if (v < minZ) minZ = v; if (v > maxZ) maxZ = v; } }
  if (minZ === Infinity) { minZ = 0; maxZ = 0; }
  for (let i = 0; i < cols * rows; i++) if (!Number.isFinite(heights[i])) heights[i] = minZ; // fill no-data
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function heightAt(x, y) {
    const c = clamp(x / cell - 0.5, 0, cols - 1), r = clamp((H - y) / cell - 0.5, 0, rows - 1);
    const c0 = Math.min(cols - 2, Math.floor(c)), r0 = Math.min(rows - 2, Math.floor(r));
    const fc = c - c0, fr = r - r0, i = r0 * cols + c0;
    return heights[i] * (1 - fc) * (1 - fr) + heights[i + 1] * fc * (1 - fr)
         + heights[i + cols] * (1 - fc) * fr + heights[i + cols + 1] * fc * fr;
  }
  function slopeAt(x, y) { // degrees
    const dzdx = (heightAt(x + cell, y) - heightAt(x - cell, y)) / (2 * cell);
    const dzdy = (heightAt(x, y + cell) - heightAt(x, y - cell)) / (2 * cell);
    return Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
  return { cols, rows, cell, W, H, minZ, maxZ, heights, heightAt, slopeAt, inside };
}

// Flat stand-in used when there is no terrain file: the map is then a flat sheet of the right size.
export function flatTerrain(widthM, heightM, cellSize = 4) {
  const cols = Math.max(2, Math.round(widthM / cellSize)), rows = Math.max(2, Math.round(heightM / cellSize));
  const T = makeTerrain({ cols, rows, cellSize }, new Float32Array(cols * rows));
  T.flat = true; return T;
}

// Loads <dir>/terrain.json and the files it names, in the form CJ's data/out/terrain/ uses:
//   heightGrid: { file, width, height, metresPerPixel }   raw little-endian Float32, row 0 north, cell centres
//   textures.hub: image covering the whole crop, row 0 north
//   parking: { x, y, z }                                  optional point of interest
export async function loadTerrain(dir) {
  const res = await fetch(dir + 'terrain.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`no terrain.json in ${dir}`);
  const meta = await res.json(), g = meta.heightGrid;
  if (!g || !g.file || !g.width || !g.height || !g.metresPerPixel) throw new Error(`${dir}terrain.json has no heightGrid`);
  const bin = await fetch(dir + g.file);
  if (!bin.ok) throw new Error(`terrain: ${g.file} -> HTTP ${bin.status}`);
  const buf = await bin.arrayBuffer();
  if (buf.byteLength !== g.width * g.height * 4) throw new Error(`terrain: ${g.file} is ${buf.byteLength} bytes, expected ${g.width * g.height * 4}`);
  const T = makeTerrain({ cols: g.width, rows: g.height, cellSize: g.metresPerPixel }, new Float32Array(buf));
  T.imageUrl = meta.textures && meta.textures.hub ? dir + meta.textures.hub : null;
  T.parking = meta.parking && Number.isFinite(meta.parking.x) ? { x: meta.parking.x, y: meta.parking.y } : null;
  T.credit = (meta.source && meta.source.credit) || '';
  return T;
}

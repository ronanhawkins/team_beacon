// Walking time from one place (the base) to every cell of the terrain, for the "Minutes to base" layer
// and the astronaut panel. The base is where medical help is; the engine's minutesToShelter layer is the
// time to the NEAREST refuge (radiation cover), which is a different question.
//
// Same rules as the engine planner and pathfind.js (engine/src/planner.rs, data/site.json planner):
//   walking minutes per metre = (1 / walkSpeed) * (1 + (slope / 15)^2) / 60, steeper than maxSlopeDeg is impassable,
//   8-connected moves, a move costs the mean of its two cells.
// The engine works on 2 m cells from the 1 m elevation model; this uses the hub's 4 m grid (pathfind.js slopes),
// so it is a close estimate, not the engine's exact figure. Pure functions, no DOM.
const SLOPE_SCALE_DEG = 15;
const D8 = [[-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2], [-1, 0, 1], [1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]];

// G: makeWalkGrid() result. from: {x, y} local metres. Returns { minutes: Float32Array (Infinity = unreachable), cols, rows, cell, H, at(x, y) }.
export function walkField(G, from, { walkSpeed = 0.8, maxSlopeDeg = 25 } = {}) {
  const { cols, rows, cell, slope } = G, H = rows * cell, n = cols * rows;
  const mpm = new Float32Array(n); // minutes per metre, Infinity where impassable
  for (let i = 0; i < n; i++) { const s = slope[i] / SLOPE_SCALE_DEG; mpm[i] = slope[i] > maxSlopeDeg ? Infinity : (1 + s * s) / walkSpeed / 60; }
  const minutes = new Float32Array(n).fill(Infinity), done = new Uint8Array(n);
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(from.x / cell))), r0 = Math.max(0, Math.min(rows - 1, Math.floor((H - from.y) / cell)));
  // binary min-heap of (minutes, cell)
  let hk = new Float64Array(4096), hv = new Int32Array(4096), hn = 0;
  const push = (key, val) => {
    if (hn === hk.length) { const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
    let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= key) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = key; hv[i] = val;
  };
  const pop = () => {
    const top = hv[0], key = hk[--hn], val = hv[hn]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= key) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = key; hv[i] = val; return top;
  };
  const start = r0 * cols + c0; minutes[start] = 0; push(0, start);
  while (hn) {
    const i = pop(); if (done[i]) continue; done[i] = 1;
    const c = i % cols, r = (i / cols) | 0, mi = mpm[i] === Infinity ? 1 / walkSpeed / 60 : mpm[i]; // the base cell itself always counts as walkable
    for (const [dc, dr, k] of D8) {
      const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc; if (done[j] || mpm[j] === Infinity) continue;
      const t = minutes[i] + k * cell * 0.5 * (mi + mpm[j]);
      if (t < minutes[j]) { minutes[j] = t; push(t, j); }
    }
  }
  const at = (x, y) => {
    const c = Math.floor(x / cell), r = Math.floor((H - y) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    const v = minutes[r * cols + c];
    if (v !== Infinity) return v;
    let best = Infinity; // on a steep cell: the best neighbour, so a point placed on a cliff edge still gets a time
    for (const [dc, dr] of D8) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) best = Math.min(best, minutes[rr * cols + cc]); }
    return best === Infinity ? null : best;
  };
  return { minutes, cols, rows, cell, H, at };
}

// Grey image (0 = 0 min, 254 = maxMinutes or more, 255 = unreachable, which the map leaves clear) for map.setLayer. Needs a DOM canvas.
export function fieldImage(F, maxMinutes) {
  const cv = document.createElement('canvas'); cv.width = F.cols; cv.height = F.rows;
  const g = cv.getContext('2d'), img = g.createImageData(F.cols, F.rows), d = img.data;
  for (let i = 0; i < F.minutes.length; i++) {
    const m = F.minutes[i], v = m === Infinity ? 255 : Math.min(254, Math.round(m / maxMinutes * 254));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); return cv;
}

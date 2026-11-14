// Terrain-aware path search for the draft plan: the hub's preview of how a suited astronaut would walk
// between the points placed in Plan mode, instead of a straight line through buttes and steep ground.
// It follows the engine planner's rules (engine/src/planner.rs, data/site.json planner):
//   walking minutes per metre = (1 / walkSpeed) * (1 + (slope / 15)^2) / 60, ground steeper than maxSlopeDeg is impassable,
//   8-connected A* over the height grid. The engine works on finer cells and adds dose and shelter costs, so its
//   route can differ; this is a preview, and the `plan` event still carries only the points (shared/events.md).
// Pure functions, no DOM, so tests/pathfind.test.js runs them in node.
const SLOPE_SCALE_DEG = 15;
const D8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Slope in degrees for every cell of a height grid (row 0 north, cell centres; shared/conventions.md).
export function makeWalkGrid({ cols, rows, cell, heights }) {
  const slope = new Float32Array(cols * rows), at = (c, r) => heights[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const dx = (at(c + 1, r) - at(c - 1, r)) / (2 * cell), dy = (at(c, r - 1) - at(c, r + 1)) / (2 * cell);
    slope[r * cols + c] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  }
  return { cols, rows, cell, W: cols * cell, H: rows * cell, slope };
}

// Min-heap of (key, value) pairs in growable typed arrays.
function heap() {
  let k = new Float64Array(1024), v = new Int32Array(1024), n = 0;
  return {
    get size() { return n; },
    push(key, val) {
      if (n === k.length) { const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2); k2.set(k); v2.set(v); k = k2; v = v2; }
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    },
    pop() {
      const top = v[0], key = k[--n], val = v[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= key) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = key; v[i] = val; return top;
    },
  };
}

// Finds a walkable path from a to b ({x, y} local metres).
//   maxSlopeDeg, walkSpeed (m/s): planner rules. marginM: how far outside the box around a and b the search may go.
//   maxExpand: cells the search may expand before giving up, so an unreachable point cannot freeze the page.
// Returns { ok, pts, distanceM, minutes, maxSlopeDeg, reason }. When ok is false, pts is the straight line.
export function findPath(G, a, b, { maxSlopeDeg = 25, walkSpeed = 0.8, marginM = 300, maxExpand = 250000 } = {}) {
  const { cols, rows, cell, H, slope } = G;
  const passable = (i) => slope[i] <= maxSlopeDeg;
  const toCell = (p) => { const c = Math.max(0, Math.min(cols - 1, Math.floor(p.x / cell))), r = Math.max(0, Math.min(rows - 1, Math.floor((H - p.y) / cell))); return r * cols + c; };
  const centre = (i) => ({ x: (i % cols + 0.5) * cell, y: H - (Math.floor(i / cols) + 0.5) * cell });
  const straight = (reason) => ({ ok: false, reason, pts: [a, b], ...measure(G, [a, b], walkSpeed) });
  // The nearest walkable cell within a few cells, for points placed right next to a cliff.
  const snap = (i) => {
    if (passable(i)) return i;
    const c0 = i % cols, r0 = Math.floor(i / cols); let best = -1, bd = Infinity;
    for (let rad = 1; rad <= 8 && best < 0; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
      const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const j = r * cols + c, d = dc * dc + dr * dr; if (passable(j) && d < bd) { bd = d; best = j; }
    }
    return best;
  };
  const s = snap(toCell(a)), g = snap(toCell(b));
  if (s < 0) return straight('start is on ground too steep to walk');
  if (g < 0) return straight('end is on ground too steep to walk');

  const m = Math.ceil(marginM / cell), sc = s % cols, sr = Math.floor(s / cols), gc = g % cols, gr = Math.floor(g / cols);
  const c0 = Math.max(0, Math.min(sc, gc) - m), c1 = Math.min(cols - 1, Math.max(sc, gc) + m), r0 = Math.max(0, Math.min(sr, gr) - m), r1 = Math.min(rows - 1, Math.max(sr, gr) + m);
  const bw = c1 - c0 + 1, bh = r1 - r0 + 1, local = (i) => (Math.floor(i / cols) - r0) * bw + (i % cols - c0);
  const cost = new Float64Array(bw * bh).fill(Infinity), prev = new Int32Array(bw * bh).fill(-1), done = new Uint8Array(bw * bh);
  const mpm = (i) => { const k = slope[i] / SLOPE_SCALE_DEG; return (1 / walkSpeed) * (1 + k * k) / 60; };
  const flat = 1 / walkSpeed / 60, gx = (gc + 0.5) * cell, gy = (gr + 0.5) * cell;
  const h = (c, r) => Math.hypot((c + 0.5) * cell - gx, (r + 0.5) * cell - gy) * flat;
  const q = heap(); cost[local(s)] = 0; q.push(h(sc, sr), s);
  let expanded = 0, found = false;
  while (q.size) {
    const i = q.pop(), li = local(i); if (done[li]) continue; done[li] = 1;
    if (i === g) { found = true; break; }
    if (++expanded > maxExpand) return straight('the search gave up (too far or blocked)');
    const c = i % cols, r = Math.floor(i / cols);
    for (const [dc, dr] of D8) {
      const nc = c + dc, nr = r + dr; if (nc < c0 || nr < r0 || nc > c1 || nr > r1) continue;
      const j = nr * cols + nc; if (!passable(j)) continue;
      const lj = local(j); if (done[lj]) continue;
      const step = (dc && dr ? Math.SQRT2 : 1) * cell, nc2 = cost[li] + step * 0.5 * (mpm(i) + mpm(j));
      if (nc2 < cost[lj]) { cost[lj] = nc2; prev[lj] = i; q.push(nc2 + h(nc, nr), j); }
    }
  }
  if (!found) return straight('no walkable path between these points');
  const cells = [g]; while (cells[cells.length - 1] !== s) cells.push(prev[local(cells[cells.length - 1])]);
  cells.reverse();
  // Line-of-sight smoothing: skip ahead while the straight line stays on walkable ground, so the path is not a staircase.
  const clear = (p, q2) => {
    const n = Math.ceil(Math.hypot(q2.x - p.x, q2.y - p.y) / (cell * 0.5));
    for (let k = 1; k < n; k++) if (!passable(toCell({ x: p.x + (q2.x - p.x) * k / n, y: p.y + (q2.y - p.y) * k / n }))) return false;
    return true;
  };
  const raw = [a, ...cells.slice(1, -1).map(centre), b], pts = [a];
  for (let i = 0; i < raw.length - 1;) {
    let j = raw.length - 1; while (j > i + 1 && !clear(raw[i], raw[j])) j--;
    pts.push(raw[j]); i = j;
  }
  return { ok: true, pts, expanded, ...measure(G, pts, walkSpeed) };
}

// Distance, walking minutes and steepest ground along a polyline, sampled every half cell.
export function measure({ cols, rows, cell, H, slope }, pts, walkSpeed = 0.8) {
  let distanceM = 0, minutes = 0, maxSlopeDeg = 0;
  const sl = (x, y) => slope[Math.max(0, Math.min(rows - 1, Math.floor((H - y) / cell))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x / cell)))];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], d = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(d / (cell * 0.5)));
    for (let k = 0; k < n; k++) {
      const s = sl(p.x + (q.x - p.x) * (k + 0.5) / n, p.y + (q.y - p.y) * (k + 0.5) / n), f = s / SLOPE_SCALE_DEG;
      minutes += d / n * (1 / walkSpeed) * (1 + f * f) / 60; if (s > maxSlopeDeg) maxSlopeDeg = s;
    }
    distanceM += d;
  }
  return { distanceM, minutes, maxSlopeDeg };
}

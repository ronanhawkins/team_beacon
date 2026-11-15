// Route profile: ground height along the walk, with minutes to shelter, science stops, steep stretches and
// where the astronaut is. Drawn on a 2D canvas that fills its panel. No libraries.
const MUTED = '#98a2ae', SOFT = '#c9d1db', BLUE = '#5aa9ff', GREEN = '#6fd3a3', AMBER = '#ffd68a', INK = '#0b0e13';

// Builds the profile from waypoints ({ x, y, z, shelterMin, stop, shelter }); distance is along the ground.
export function profileFromPoints(pts) {
  let d = 0;
  return pts.map((p, i) => { if (i) d += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); return { ...p, d }; });
}

// Samples a polyline every `step` metres on the terrain, for a draft that has no waypoints yet.
export function sampleLine(line, heightAt, step = 6) {
  const out = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = i > 1 ? 1 : 0; k <= n; k++) { const t = k / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; out.push({ x, y, z: heightAt(x, y) }); }
  }
  return out;
}

// prof: points with d, z, optional shelterMin, stop (number), shelter (bool). opt: { at (metres along), maxSlopeDeg, hover (metres) }
export function drawProfile(canvas, prof, opt = {}) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, r.width), H = Math.max(40, r.height);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!prof || prof.length < 2) return null;
  const u = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const L = 3.7 * u, R = 2.4 * u, T = 1.3 * u, B = 1.2 * u, pw = W - L - R, ph = H - T - B;
  const total = prof[prof.length - 1].d || 1;
  let z0 = Infinity, z1 = -Infinity; for (const p of prof) { z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const pad = Math.max(2, (z1 - z0) * 0.12); z0 -= pad; z1 += pad;
  const hasShelter = prof.some((p) => p.shelterMin != null), sMax = Math.max(5, Math.ceil(Math.max(0, ...prof.map((p) => p.shelterMin || 0)) / 5) * 5);
  const X = (d) => L + d / total * pw, Y = (z) => T + (1 - (z - z0) / (z1 - z0)) * ph, YS = (m) => T + (1 - m / sMax) * ph;
  g.font = `${0.68 * u}px system-ui, sans-serif`; g.textBaseline = 'middle';

  // grid and axes
  g.strokeStyle = '#262d37'; g.lineWidth = 1;
  for (let k = 0; k <= 2; k++) { const y = T + ph * k / 2; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); }
  g.fillStyle = MUTED; g.textAlign = 'right';
  g.fillText(`${Math.round(z1 - pad)} m`, L - 0.3 * u, Y(z1 - pad)); g.fillText(`${Math.round(z0 + pad)} m`, L - 0.3 * u, Y(z0 + pad));
  if (hasShelter) { g.textAlign = 'left'; g.fillStyle = GREEN; g.fillText(`${sMax} min`, L + pw + 0.3 * u, T); g.fillText('0', L + pw + 0.3 * u, T + ph); }
  g.textAlign = 'left'; g.fillStyle = MUTED; g.fillText('0', L, T + ph + 0.65 * u);
  g.textAlign = 'right'; g.fillText(total >= 1000 ? `${(total / 1000).toFixed(2)} km` : `${Math.round(total)} m`, L + pw, T + ph + 0.65 * u);

  // ground
  const grad = g.createLinearGradient(0, T, 0, T + ph); grad.addColorStop(0, 'rgba(165,107,69,0.55)'); grad.addColorStop(1, 'rgba(165,107,69,0.08)');
  g.beginPath(); g.moveTo(X(0), T + ph); for (const p of prof) g.lineTo(X(p.d), Y(p.z)); g.lineTo(X(total), T + ph); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); prof.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.z)) : g.moveTo(X(p.d), Y(p.z)))); g.strokeStyle = SOFT; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
  // stretches steeper than the limit, measured over at least 4 m
  if (opt.maxSlopeDeg) {
    g.strokeStyle = AMBER; g.lineWidth = 3;
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1], b = prof[i], dd = b.d - a.d; if (dd < 0.5) continue;
      if (Math.atan(Math.abs(b.z - a.z) / Math.max(dd, 4)) * 180 / Math.PI > opt.maxSlopeDeg) { g.beginPath(); g.moveTo(X(a.d), Y(a.z)); g.lineTo(X(b.d), Y(b.z)); g.stroke(); }
    }
  }
  // minutes to shelter
  if (hasShelter) {
    g.beginPath(); let pen = false;
    for (const p of prof) { if (p.shelterMin == null) { pen = false; continue; } const x = X(p.d), y = YS(p.shelterMin); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
    g.setLineDash([4, 3]); g.strokeStyle = GREEN; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
  }
  // shelters on the route and science stops
  for (const p of prof) if (p.shelter) { const x = X(p.d), y = T + ph; g.beginPath(); g.moveTo(x, y - 0.55 * u); g.lineTo(x + 0.4 * u, y); g.lineTo(x - 0.4 * u, y); g.closePath(); g.fillStyle = '#fff'; g.fill(); }
  for (const p of prof) if (p.stop != null) {
    const x = X(p.d); g.strokeStyle = 'rgba(90,169,255,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, Y(p.z)); g.stroke();
    g.beginPath(); g.arc(x, T, 0.5 * u, 0, 7); g.fillStyle = INK; g.fill(); g.strokeStyle = BLUE; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#e8eaed'; g.textAlign = 'center'; g.font = `700 ${0.6 * u}px system-ui, sans-serif`; g.fillText(String(p.stop), x, T + 0.03 * u); g.font = `${0.68 * u}px system-ui, sans-serif`;
  }
  // astronaut, then the hover crosshair
  const zAt = (d) => { let i = 1; while (i < prof.length - 1 && prof[i].d < d) i++; const a = prof[i - 1], b = prof[i], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0; return { z: a.z + (b.z - a.z) * t, s: a.shelterMin != null && b.shelterMin != null ? a.shelterMin + (b.shelterMin - a.shelterMin) * t : null, i }; };
  if (opt.at != null) {
    const d = Math.max(0, Math.min(total, opt.at)), x = X(d), y = Y(zAt(d).z);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
    g.beginPath(); g.arc(x, y, 0.38 * u, 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  }
  let hover = null;
  if (opt.hoverX != null && opt.hoverX >= L && opt.hoverX <= L + pw) {
    const d = (opt.hoverX - L) / pw * total, v = zAt(d), x = X(d);
    g.strokeStyle = 'rgba(232,234,237,0.4)'; g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(x, Y(v.z), 0.25 * u, 0, 7); g.fillStyle = SOFT; g.fill();
    const a = prof[v.i - 1], b = prof[v.i], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    hover = { d, z: v.z, shelterMin: v.s, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return hover;
}

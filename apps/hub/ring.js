// The helmet mirror (not the headset's ring.js, which is CJ's): the same skyline ring the astronaut sees, drawn flat.
// North is up. The ring is the horizon; the shaded band outside it is sky blocked by terrain.
// The long tick marks north. Markers sit at their compass direction; Sun and Earth also move outward with their height in the sky,
// so a marker inside the shaded band is hidden behind terrain.
export function drawRing(canvas, d, { emergency = false } = {}) {
  const css = canvas.clientWidth || 180, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, css, css);
  const u = css / 180, cx = css / 2, cy = css / 2, r0 = 52 * u, rMax = 80 * u, EL_MAX = 40;
  const rad = (el) => r0 + Math.max(0, Math.min(EL_MAX, el)) / EL_MAX * (rMax - r0);
  const pt = (az, r) => [cx + Math.sin(az * Math.PI / 180) * r, cy - Math.cos(az * Math.PI / 180) * r];
  const sky = d && d.skyline && d.skyline.length ? d.skyline : null;

  g.lineWidth = 1 * u; g.strokeStyle = '#2f3846';
  g.beginPath(); g.arc(cx, cy, rMax, 0, 7); g.stroke();
  if (sky) {
    const n = sky.length;
    g.beginPath();
    for (let i = 0; i <= n * 4; i++) { const f = i / 4, a = Math.floor(f) % n, t = f - Math.floor(f), el = sky[a] * (1 - t) + sky[(a + 1) % n] * t; const [x, y] = pt(f * 360 / n, rad(el)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.moveTo(cx + r0, cy); g.arc(cx, cy, r0, 0, Math.PI * 2, true); g.closePath();
    g.fillStyle = emergency ? 'rgba(255,120,110,0.55)' : 'rgba(148,163,184,0.62)'; g.fill('evenodd');
  }
  g.lineWidth = 2.5 * u; g.strokeStyle = emergency ? '#ff8a80' : '#e8eaed';
  g.beginPath(); g.arc(cx, cy, r0, 0, 7); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 90) { const [x0, y0] = pt(az, rMax), [x1, y1] = pt(az, rMax + (az ? 4 : 8) * u); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = az ? '#4a5362' : '#e8eaed'; g.lineWidth = 1.5 * u; g.stroke(); }

  if (d && d.shelter && d.shelter.az != null) { const [x, y] = pt(d.shelter.az, r0); g.beginPath(); g.moveTo(x, y - 7 * u); g.lineTo(x + 6.5 * u, y + 5 * u); g.lineTo(x - 6.5 * u, y + 5 * u); g.closePath(); g.fillStyle = '#0e1116'; g.fill(); g.lineWidth = 2 * u; g.strokeStyle = '#ffffff'; g.stroke(); }
  if (d && d.base && d.base.az != null) { const [x, y] = pt(d.base.az, r0); g.fillStyle = d.base.visible === false ? '#6b7686' : '#ffffff'; g.fillRect(x - 5 * u, y - 5 * u, 10 * u, 10 * u); }
  if (d && d.earth) { const [x, y] = pt(d.earth.az, rad(d.earth.el)); g.beginPath(); g.arc(x, y, 5.5 * u, 0, 7); g.fillStyle = '#5aa9ff'; g.fill(); if (d.earth.visible === false) { g.strokeStyle = '#0e1116'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(x - 4 * u, y - 4 * u); g.lineTo(x + 4 * u, y + 4 * u); g.stroke(); } }
  if (d && d.sun) { const [x, y] = pt(d.sun.az, rad(d.sun.el)); g.beginPath(); g.arc(x, y, 6 * u, 0, 7); g.fillStyle = '#ffd68a'; g.fill(); }

  g.fillStyle = '#e8eaed'; g.font = `600 ${24 * u}px ui-monospace, Menlo, Consolas, monospace`;
  g.fillText(d && d.openSky != null ? Math.round(d.openSky * 100) + '%' : '--', cx, cy - 4 * u);
  g.fillStyle = '#9aa3af'; g.font = `${10 * u}px system-ui, sans-serif`; g.fillText('open sky', cx, cy + 14 * u);
}

// Everything drawn on top of the terrain: routes, shelters, stops, base, the astronaut.
// Drawn in 2D so lines stay thick and labels stay readable on a projector.
const BLUE = '#5aa9ff', AMBER = '#f5a623', RED = '#ff5a52', INK = '#0b0e13';

export function drawOverlay(g, map, v, now) {
  const u = v.u, P = (p, lift) => map.project(p.x, p.y, lift);
  const path = (pts) => { g.beginPath(); let pen = false, n = 0; for (const p of pts) { const s = P(p); if (!s.ok) { pen = false; continue; } pen ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); pen = true; n++; } return n > 1; };
  const stroke = (pts, color, w, dash = [], alpha = 1) => {
    if (!path(pts)) return;
    g.lineJoin = g.lineCap = 'round'; g.globalAlpha = alpha;
    g.setLineDash([]); g.strokeStyle = INK; g.lineWidth = (w + 3) * u / 16; g.globalAlpha = alpha * 0.55; g.stroke();
    g.setLineDash(dash.map((d) => d * u / 16)); g.strokeStyle = color; g.lineWidth = w * u / 16; g.globalAlpha = alpha; g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  };
  const pill = (s, text, { dy = -1.35, color = '#e8eaed', bg = 'rgba(11,14,19,0.82)', bold = true } = {}) => {
    g.font = `${bold ? 600 : 400} ${0.8 * u}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 0.8 * u, h = 1.25 * u, x = s.x - w / 2, y = s.y + dy * u - h / 2;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, w, h, 0.3 * u); g.fill();
    g.fillStyle = color; g.fillText(text, s.x, y + h / 2 + 0.03 * u);
  };
  const tri = (s, r) => { g.beginPath(); g.moveTo(s.x, s.y - r); g.lineTo(s.x + r * 0.9, s.y + r * 0.75); g.lineTo(s.x - r * 0.9, s.y + r * 0.75); g.closePath(); };

  const { route, state, astro, live, emergency } = v, wps = route.waypoints, rr = state.reroute;
  const wp = Math.min(state.wp, wps.length - 1);

  // shelters
  const target = rr && rr.target === 'shelter' ? rr : null, near = live.shelter;
  for (const sh of v.shelters) {
    const s = P(sh); if (!s.ok) continue;
    const isNear = near && Math.hypot(near.x - sh.x, near.y - sh.y) < 2, isTarget = target && target.x != null && Math.hypot(target.x - sh.x, target.y - sh.y) < 2;
    if (isTarget && emergency) { const k = (now % 1200) / 1200; g.beginPath(); g.arc(s.x, s.y, (0.9 + 1.6 * k) * u, 0, 7); g.strokeStyle = `rgba(255,255,255,${1 - k})`; g.lineWidth = 0.18 * u; g.stroke(); }
    tri(s, 0.62 * u); g.fillStyle = isTarget ? '#ffffff' : INK; g.fill(); g.lineWidth = 0.16 * u; g.strokeStyle = '#ffffff'; g.stroke();
    const a = P({ x: astro.x, y: astro.y }), clear = Math.hypot(a.x - s.x, a.y - s.y) > 4.5 * u;
    if (isTarget || (isNear && clear)) pill(s, isTarget ? 'Shelter' : `Shelter ${fmt(live.shelterMin)} min`, { dy: 1.5, bold: isTarget });
  }

  // main route: walked part solid, rest dashed
  const here = { x: astro.x, y: astro.y };
  if (rr) {
    stroke(wps.slice(0, wp + 1), BLUE, 4.5);
    stroke(wps.slice(wp), BLUE, 3, [9, 8], 0.38);
    const done = rr.waypoints.slice(0, (rr.wp || 0) + 1), left = rr.waypoints.slice((rr.wp || 0) + 1);
    if (done.length) stroke([...done.slice(0, -1), here], BLUE, 4.5);
    const dest = rr.x != null ? [{ x: rr.x, y: rr.y }] : [];
    stroke([here, ...left, ...(left.length ? [] : dest)], emergency ? RED : AMBER, 5, emergency ? [] : [3, 9]);
    if (emergency && path([here, ...left, ...(left.length ? [] : dest)])) { g.setLineDash([0.5 * u, 0.7 * u]); g.lineDashOffset = -(now / 40) % (1.2 * u); g.strokeStyle = '#ffffff'; g.lineWidth = 0.12 * u; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; }
  } else {
    stroke([...wps.slice(0, astro.seg + 1), here], BLUE, 4.5);
    stroke([here, ...wps.slice(astro.seg + 1)], BLUE, 3, [9, 8], 0.9);
  }

  // draft plan
  if (v.mode === 'plan' && v.draftDirty) {
    stroke(v.draft, '#ffffff', 2, [4, 7]);
    v.draft.forEach((p, i) => { const s = P(p); if (!s.ok) return; g.beginPath(); g.arc(s.x, s.y, 0.5 * u, 0, 7); g.fillStyle = INK; g.fill(); g.strokeStyle = '#ffffff'; g.lineWidth = 0.14 * u; g.stroke(); pill(s, p.kind === 'stop' ? p.name : p.kind === 'start' ? 'Start' : 'End', { bold: false }); });
  }

  // stops
  route.stops.forEach((st, i) => {
    const s = P(st); if (!s.ok) return;
    const done = wp > st.wp || (!!rr && wp === st.wp), at = !rr && wp === st.wp, focus = v.focusStop === i;
    g.beginPath(); g.arc(s.x, s.y, (focus ? 0.95 : 0.78) * u, 0, 7); g.fillStyle = done || at ? BLUE : INK; g.fill(); g.lineWidth = 0.18 * u; g.strokeStyle = focus ? '#ffffff' : BLUE; g.stroke();
    g.fillStyle = done || at ? INK : '#e8eaed'; g.font = `700 ${0.85 * u}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), s.x, s.y + 0.04 * u);
    pill(s, st.name, { dy: -1.75, bold: false });
  });

  // base
  if (v.base) { const s = P(v.base); if (s.ok) { const r = 0.62 * u; g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(s.x - r, s.y - r, 2 * r, 2 * r, 0.18 * u); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.12 * u; g.stroke(); pill(s, 'Base', { dy: 1.6 }); } }

  // the terrain's parking spot (data/out/terrain/terrain.json)
  if (v.parking) { const s = P(v.parking); if (s.ok) { g.beginPath(); g.moveTo(s.x - 0.5 * u, s.y); g.lineTo(s.x + 0.5 * u, s.y); g.moveTo(s.x, s.y - 0.5 * u); g.lineTo(s.x, s.y + 0.5 * u); g.strokeStyle = INK; g.lineWidth = 0.34 * u; g.stroke(); g.strokeStyle = '#ffffff'; g.lineWidth = 0.14 * u; g.stroke(); pill(s, 'Parking spot', { dy: 1.3, bold: false }); } }

  // start and end of the main route
  if (wps.length > 1) for (const [w, word] of [[wps[0], 'Start'], [wps[wps.length - 1], 'End']]) {
    const s = P(w), a = P({ x: astro.x, y: astro.y }); if (!s.ok || w.isScienceStop || Math.hypot(a.x - s.x, a.y - s.y) < 3 * u) continue;
    if (!w.isShelter) { g.beginPath(); g.arc(s.x, s.y, 0.42 * u, 0, 7); g.fillStyle = BLUE; g.fill(); g.lineWidth = 0.14 * u; g.strokeStyle = INK; g.stroke(); }
    pill(s, w.label ? `${word} · ${w.label}` : word, { dy: w.isShelter ? -1.6 : 1.45, bold: false });
  }

  // astronaut
  { const s = P(here, 2); if (s.ok) {
    const k = (now % 1800) / 1800; g.beginPath(); g.arc(s.x, s.y, (0.7 + 0.9 * k) * u, 0, 7); g.strokeStyle = emergency ? `rgba(255,90,82,${1 - k})` : `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 0.14 * u; g.stroke();
    if (v.headingDeg != null) { // heading wedge: where the astronaut is facing, as it appears on screen
      const a = v.headingDeg * Math.PI / 180, f = P({ x: here.x + Math.sin(a) * 12, y: here.y + Math.cos(a) * 12 }, 2), ang = Math.atan2(f.y - s.y, f.x - s.x);
      g.beginPath(); g.moveTo(s.x, s.y); g.arc(s.x, s.y, 1.9 * u, ang - 0.45, ang + 0.45); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fill();
    }
    g.beginPath(); g.arc(s.x, s.y, 0.55 * u, 0, 7); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 0.2 * u; g.strokeStyle = emergency ? RED : INK; g.stroke();
    pill(s, v.name, { dy: -1.55, bg: emergency ? 'rgba(120,20,16,0.92)' : 'rgba(11,14,19,0.9)' });
  } }
}
const fmt = (n) => (n == null ? '--' : n < 10 ? (+n).toFixed(1) : String(Math.round(n)));

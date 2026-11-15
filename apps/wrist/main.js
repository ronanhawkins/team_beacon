// Beacon wrist: the astronaut's wristband, worn landscape on the forearm.
// Left: a north-up map that follows your position on the route. Right: status, the next target, and two actions:
//   Go to shelter -> { type: "requestReroute" }     SOS -> { type: "panic" }      (shared/events.md)
// The ESP panic button sends the same "panic" event, so the two work side by side.
// Route and state are read with the hub's reader (apps/hub/route.js), so both screens agree on field names.
import { connect } from '/shared/client.js';
import { readWaypoints, readState } from '/hub/route.js';
import { loadTerrain } from '/hub/terrain.js';

const $ = (id) => document.getElementById(id);
const BLUE = '#5aa9ff', AMBER = '#ffc66b', RED = '#ff5a52', INK = '#04060a';
let adding = null; // { x, y } of the waypoint being placed, or null
let raw = null, state = null, route = null, online = false, session = null, routeId = null, loadingRoute = false;
let terrain = null, contours = null; // height grid, and the contour map drawn from it; none for a synthetic route

// ---------- data ----------
const getJSON = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
async function loadRoute() {
  loadingRoute = true;
  try {
    session = await getJSON('/session.json'); routeId = session.planId ?? null;
    route = readWaypoints(await getJSON(session.waypoints), {});
    if (!terrain && !session.synthetic) terrain = await loadTerrain('/data/terrain/').catch(() => null);
    contours = terrain ? drawContours(terrain, routeBox()) : null; dirty = true;
  } catch (e) { note('No route: ' + e.message); }
  loadingRoute = false;
  if (raw) applyState(raw);
}
let lastPlan = null;
function applyState(next) {
  const pl = next.plan;
  if (pl && (!lastPlan || lastPlan.id !== pl.id || lastPlan.status !== pl.status) && lastPlan !== undefined) {
    if (pl.status === 'done' && lastPlan) note('Route updated');
    else if (pl.status === 'error' && lastPlan) note(pl.message || 'Base could not plan that');
  }
  lastPlan = pl || null;
  raw = next;
  const rid = next.plan ? next.plan.routeId ?? null : routeId;
  if (rid !== routeId && !loadingRoute) { routeId = rid; note('New route from base'); loadRoute(); return; }
  if (!route) return;
  state = readState(next, route, state);
  render(); dirty = true;
}

// ---------- status panel ----------
function here() {
  if (!state || !route) return null;
  const rr = state.reroute;
  return rr ? rr.waypoints[rr.wp] : route.waypoints[state.wp];
}
function model() {
  if (!online) return { level: 'offline', kicker: 'Link', title: 'No link', detail: 'Reconnecting to base…' };
  if (!state) return { level: 'offline', kicker: 'Link', title: 'Connecting', detail: 'Waiting for the mission state' };
  const rerouting = !!state.reroute, sheltered = rerouting && state.shelterMin === 0;
  if (state.panic) return { level: 'emergency', kicker: 'SOS', title: sheltered ? 'In shelter' : 'SOS sent', detail: sheltered ? 'Base has your alert. Stay here.' : 'Base has your alert. Follow the red route to shelter.' };
  if (state.storm) return { level: 'emergency', kicker: 'Solar storm', title: sheltered ? 'In shelter' : 'Take shelter', detail: sheltered ? 'Stay here until base ends the storm.' : 'Follow the red route to shelter.' };
  if (rerouting) return { level: 'caution', kicker: 'Reroute', title: sheltered ? 'In shelter' : 'To shelter', detail: sheltered ? 'Base can send you back to the walk.' : 'Follow the amber route to shelter.' };
  if (state.mode === 'warning') return { level: 'caution', kicker: 'Caution', title: 'Stay alert', detail: state.baseLink === false ? 'No line of sight to base.' : 'Shelter is getting far.' };
  return { level: 'ok', kicker: 'Status', title: 'On route', detail: 'All clear. Follow the blue line.' };
}
function nextTarget() {
  if (!state || !route) return null;
  if (state.reroute) return { kicker: state.shelterMin === 0 ? 'Arrived' : 'Heading to', name: 'Shelter', pt: { x: state.reroute.x, y: state.reroute.y } };
  const st = route.stops.find((s) => s.wp > state.wp), atStop = route.stops.find((s) => s.wp === state.wp), w = route.waypoints, end = w[w.length - 1];
  if (atStop) return { kicker: 'You are at', name: atStop.name, pt: atStop };
  if (st) return { kicker: `Next stop · ${st.num} of ${route.stops.length}`, name: st.name, pt: st };
  if (state.wp >= w.length - 1) return { kicker: 'Walk', name: 'Complete', pt: null };
  return { kicker: 'Next', name: end.label || 'End of the walk', pt: end };
}
function render() {
  const m = model(), b = document.body;
  b.classList.toggle('offline', m.level === 'offline'); b.classList.toggle('caution', m.level === 'caution'); b.classList.toggle('emergency', m.level === 'emergency');
  $('kicker').textContent = m.kicker; $('title').textContent = m.title; $('detail').textContent = m.detail;
  $('link').lastElementChild.textContent = online ? 'Linked' : 'No link';
  const n = nextTarget(); $('nextKicker').textContent = n ? n.kicker : 'Next'; $('nextName').textContent = n ? n.name : '--';
  renderProgress();
  const rerouting = !!state && !!state.reroute, panic = !!state && state.panic;
  setButton($('reroute'), { disabled: !online || !state || rerouting, done: rerouting, doneText: 'Rerouting' });
  setButton($('sos'), { disabled: !online || !state || panic, done: panic, doneText: 'SOS active' });
  const why = whyNoWaypoint(); $('addWp').disabled = !!why; $('addWp').title = why || 'Add a waypoint to the route';
  if (adding && why) stopAdding();
  if (adding) { const d = here() ? Math.hypot(adding.x - here().x, adding.y - here().y) : 0, ok = inBounds(adding);
    $('nextKicker').textContent = 'New waypoint'; $('nextName').textContent = ok ? `${Math.round(d)} m from you` : 'Outside the planned area';
    $('addConfirm').disabled = !ok; }
}
// Start, science stops and end along a line by walking time, filled up to where you are on the main route.
function renderProgress() {
  const el = $('prog'); if (!route || !state) { el.innerHTML = '<i class="done"></i>'; return; }
  const w = route.waypoints, total = Math.max(0.1, w[w.length - 1].t || 0.1), f = (t) => Math.max(0, Math.min(100, (t || 0) / total * 100));
  const at = f(w[Math.min(state.wp, w.length - 1)].t);
  el.innerHTML = `<i class="done" style="width:${at}%"></i><b class="passed" style="left:0%"></b>`
    + route.stops.map((s) => `<b class="${state.wp >= s.wp ? 'passed' : ''}" style="left:${f(s.etaMin)}%"></b>`).join('')
    + `<b class="end" style="left:100%"></b><em style="left:${at}%"></em>`;
}
function setButton(btn, { disabled, done, doneText }) {
  btn.disabled = disabled; btn.classList.toggle('done', done);
  const small = btn.querySelector('small');
  small.dataset.idle = small.dataset.idle || small.textContent;
  small.textContent = done ? doneText : small.dataset.idle;
}
let noteTimer = 0;
function note(text) { $('note').textContent = text; clearTimeout(noteTimer); noteTimer = setTimeout(() => { $('note').textContent = ''; }, 4000); }

// ---------- map ----------
// North up, centred on you. The view is wide enough to show the next target; + and − scale it.
const canvas = $('map'), g = canvas.getContext('2d');
let dirty = true, lastDraw = 0, zoom = 1, cam = null, W = 0, H = 0, dpr = 1;
function resize() {
  const r = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); dirty = true;
}
new ResizeObserver(resize).observe(canvas);
$('zoomIn').onclick = () => { zoom = Math.max(0.25, zoom / 1.5); dirty = true; };
$('zoomOut').onclick = () => { zoom = Math.min(8, zoom * 1.5); dirty = true; };

function frame(now) {
  requestAnimationFrame(frame);

  const p = here(), emergency = !!state && (state.storm || state.panic);
  if (!p || !W) { if (dirty) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#070a0f'; g.fillRect(0, 0, W, H); dirty = false; } return; }
  const t = nextTarget(), want = Math.max(120, Math.min(900, (t && t.pt ? Math.hypot(t.pt.x - p.x, t.pt.y - p.y) : 100) * 2.6)) * zoom;
  if (!cam) cam = { x: p.x, y: p.y, span: want };
  const k = 0.12, moving = Math.abs(cam.x - p.x) + Math.abs(cam.y - p.y) > 0.05 || Math.abs(cam.span - want) > 0.5;
  if (!moving && !dirty && now - lastDraw < 50) return; // the position pulse and reroute flow need ~20 frames a second, no more
  lastDraw = now;
  cam.x += (p.x - cam.x) * k; cam.y += (p.y - cam.y) * k; cam.span += (want - cam.span) * k; dirty = false;
  const s = Math.min(W, H) / cam.span; // pixels per metre
  const X = (x) => (x - cam.x) * s + W / 2, Y = (y) => (cam.y - y) * s + H / 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#070a0f'; g.fillRect(0, 0, W, H);
  { // faint grid, then the contours
 g.strokeStyle = '#0e141c'; g.lineWidth = 1; const step = niceStep(cam.span / 5); for (let x = Math.floor((cam.x - cam.span) / step) * step; x < cam.x + cam.span; x += step) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); } for (let y = Math.floor((cam.y - cam.span) / step) * step; y < cam.y + cam.span; y += step) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); } 
    if (contours) { g.imageSmoothingQuality = 'high'; g.drawImage(contours.canvas, X(contours.x0), Y(contours.yTop), contours.wM * s, contours.hM * s); } }
  // darken the edges so the lines and you stand out
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(4,6,10,0.05)'); v.addColorStop(1, 'rgba(4,6,10,0.65)'); g.fillStyle = v; g.fillRect(0, 0, W, H);

  const line = (pts, color, w, dash = [], alpha = 1, offset = 0) => {
    if (pts.length < 2) return;
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))));
    g.lineJoin = g.lineCap = 'round'; g.globalAlpha = alpha;
    g.setLineDash([]); g.strokeStyle = 'rgba(4,6,10,0.7)'; g.lineWidth = w + 3; g.stroke();
    g.setLineDash(dash); g.lineDashOffset = offset; g.strokeStyle = color; g.lineWidth = w; g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  };
  const wps = route.waypoints, rr = state.reroute, wp = Math.min(state.wp, wps.length - 1);
  line(wps.slice(0, wp + 1), BLUE, 4);
  line(wps.slice(wp), BLUE, 3, [8, 7], rr ? 0.35 : 0.95);
  if (rr) {
    const left = rr.waypoints.slice(rr.wp), done = rr.waypoints.slice(0, rr.wp + 1);
    line(done, BLUE, 4);
    line(left, emergency ? RED : AMBER, 5);
    line(left, '#ffffff', 1.6, [3, 9], 0.9, -(now / 30) % 12);
  }
  // shelters, base, stops
  for (const sh of route.shelters) { const x = X(sh.x), y = Y(sh.y), r = 7, target = rr && Math.hypot(sh.x - rr.x, sh.y - rr.y) < 2; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.9, y + r * 0.75); g.lineTo(x - r * 0.9, y + r * 0.75); g.closePath(); g.fillStyle = target ? '#fff' : INK; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.stroke(); }
  if (route.base) { const x = X(route.base.x), y = Y(route.base.y); g.fillStyle = '#fff'; g.fillRect(x - 6, y - 6, 12, 12); g.strokeStyle = INK; g.lineWidth = 1.5; g.strokeRect(x - 6, y - 6, 12, 12); }
  route.stops.forEach((st) => { const x = X(st.x), y = Y(st.y), done = state.wp >= st.wp; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fillStyle = done ? BLUE : INK; g.fill(); g.strokeStyle = BLUE; g.lineWidth = 2; g.stroke(); g.fillStyle = done ? INK : '#fff'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(st.num), x, y + 0.5); });
  // you
  const ax = X(p.x), ay = Y(p.y), pulse = (now % 1800) / 1800;
  if (state.headingDeg != null) { const a = (state.headingDeg - 90) * Math.PI / 180; g.beginPath(); g.moveTo(ax, ay); g.arc(ax, ay, 30, a - 0.5, a + 0.5); g.closePath(); const wg = g.createRadialGradient(ax, ay, 0, ax, ay, 30); wg.addColorStop(0, 'rgba(255,255,255,0.45)'); wg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = wg; g.fill(); }
  g.beginPath(); g.arc(ax, ay, 9 + 16 * pulse, 0, 7); g.strokeStyle = emergency ? `rgba(255,90,82,${1 - pulse})` : `rgba(90,169,255,${1 - pulse})`; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(ax, ay, 7.5, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = emergency ? RED : BLUE; g.stroke();
  // the waypoint being placed, and how the route would bend to reach it
  if (adding) {
    const b = bounds();
    if (b) { g.setLineDash([3, 6]); g.strokeStyle = 'rgba(233,238,245,0.55)'; g.lineWidth = 1.2; g.strokeRect(X(b.xMin), Y(b.yMax), (b.xMax - b.xMin) * s, (b.yMax - b.yMin) * s); g.setLineDash([]); }
    const ins = insertion(adding);
    if (ins) line([ins.before, adding, ins.after], '#ffffff', 2, [5, 6], 0.85);
    const x = X(adding.x), y = Y(adding.y), ok = inBounds(adding);
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 11, y - 14, x - 9, y - 28, x, y - 28); g.bezierCurveTo(x + 9, y - 28, x + 11, y - 14, x, y);
    g.fillStyle = ok ? '#ffffff' : AMBER; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(x, y - 19, 3.5, 0, 7); g.fillStyle = INK; g.fill();
  }
  viewS = s;
  scaleBar(s);
}
let viewS = 1;
// screen point on the map -> local metres
function toWorld(px, py) { return { x: cam.x + (px - W / 2) / viewS, y: cam.y - (py - H / 2) / viewS }; }
// ---------- contour map ----------
// The map is drawn, not photographed: contour lines from the height grid, every 2 m, with a brighter line every
// 10 m, over the area around the route. Drawn once into an image per route and then just scaled.
function routeBox() {
  const pts = [...route.waypoints, ...Object.values(route.reroutes).flat(), ...route.shelters];
  const pad = 350, b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); }
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}
function drawContours(T, box) {
  const step = 2, major = 10, cell = T.cell;
  const c0 = Math.max(0, Math.floor(box.x0 / cell - 0.5)), c1 = Math.min(T.cols - 2, Math.ceil(box.x1 / cell - 0.5));
  const r0 = Math.max(0, Math.floor((T.H - box.y1) / cell - 0.5)), r1 = Math.min(T.rows - 2, Math.ceil((T.H - box.y0) / cell - 0.5));
  const x0 = (c0 + 0.5) * cell, yTop = T.H - (r0 + 0.5) * cell, wM = (c1 - c0) * cell, hM = (r1 - r0) * cell;
  const ppm = Math.min(3, 2400 / Math.max(wM, hM)); // pixels per metre in the drawn image
  const cv = document.createElement('canvas'); cv.width = Math.ceil(wM * ppm); cv.height = Math.ceil(hM * ppm);
  const c = cv.getContext('2d'), z = (col, row) => T.heights[row * T.cols + col];
  const minor = new Path2D(), majorP = new Path2D();
  for (let r = r0; r < r1; r++) for (let q = c0; q < c1; q++) {
    // corners: a top-left, b top-right, d bottom-right, e bottom-left (row r is north of row r + 1)
    const a = z(q, r), b = z(q + 1, r), d = z(q + 1, r + 1), e = z(q, r + 1);
    const lo = Math.min(a, b, d, e), hi = Math.max(a, b, d, e);
    for (let L = Math.ceil(lo / step) * step; L < hi; L += step) {
      const px = (q - c0) * cell * ppm, py = (r - r0) * cell * ppm, sz = cell * ppm, hits = [];
      const edge = (va, vb, ax, ay, bx, by) => { if ((va < L) !== (vb < L)) { const t = (L - va) / (vb - va); hits.push([ax + (bx - ax) * t, ay + (by - ay) * t]); } };
      edge(a, b, px, py, px + sz, py); edge(b, d, px + sz, py, px + sz, py + sz); edge(d, e, px + sz, py + sz, px, py + sz); edge(e, a, px, py + sz, px, py);
      const path = Math.round(L) % major === 0 ? majorP : minor;
      for (let i = 0; i + 1 < hits.length; i += 2) { path.moveTo(hits[i][0], hits[i][1]); path.lineTo(hits[i + 1][0], hits[i + 1][1]); }
    }
  }
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(90,169,255,0.28)'; c.lineWidth = 1.2; c.stroke(minor);
  c.strokeStyle = 'rgba(150,200,255,0.6)'; c.lineWidth = 1.8; c.stroke(majorP);
  return { canvas: cv, x0, yTop, wM, hM };
}

const niceStep = (m) => [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((d) => d >= m) || 1000;
let lastScale = '';
function scaleBar(s) {
  const d = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((m) => m * s >= 50) || 1000, key = d + ':' + Math.round(d * s);
  if (key === lastScale) return; lastScale = key;
  $('scale').firstElementChild.style.width = Math.round(d * s) + 'px'; $('scale').lastElementChild.textContent = d >= 1000 ? `${d / 1000} km` : `${d} m`;
}
requestAnimationFrame(frame);

// ---------- add a waypoint ----------
// The new point joins the rest of the walk where it adds the least distance, and the whole list goes to the
// relay as a plan (shared/events.md), the same event the hub's planner sends. The relay replans from where you
// are, and every screen gets the new route.
function whyNoWaypoint() {
  if (!online || !state || !route) return 'No link to base';
  if (state.storm || state.panic) return 'Not during a storm or SOS';
  if (state.reroute) return 'Not while heading to shelter';
  if (raw && raw.plan && raw.plan.status === 'running') return 'Base is planning a route';
  return null;
}
const bounds = () => (session && session.plannerBounds) || null;
const inBounds = (p) => { const b = bounds(); return !b || (p.x >= b.xMin && p.x <= b.xMax && p.y >= b.yMin && p.y <= b.yMax); };
// What is left of the walk: where you are, the stops still ahead, and the end.
function remaining() {
  const w = route.waypoints, p = here(), end = w[w.length - 1];
  const stops = route.stops.filter((s) => s.wp > state.wp && s.wp < w.length - 1).map((s) => ({ x: s.x, y: s.y, kind: 'stop', name: s.name }));
  return [{ x: p.x, y: p.y, kind: 'start' }, ...stops, { x: end.x, y: end.y, kind: 'end' }];
}
function insertion(pt) {
  if (!route || !state) return null;
  const pts = remaining(); let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], cost = Math.hypot(pt.x - a.x, pt.y - a.y) + Math.hypot(b.x - pt.x, b.y - pt.y) - Math.hypot(b.x - a.x, b.y - a.y);
    if (!best || cost < best.cost) best = { cost, i, before: a, after: b };
  }
  return best;
}
function startAdding() {
  if (whyNoWaypoint()) return;
  const p = here(), w = route.waypoints, n = w[Math.min(state.wp + 1, w.length - 1)];
  adding = { x: p.x + (n.x - p.x) * 0.5 + 25, y: p.y + (n.y - p.y) * 0.5 }; // a start a little off the route; tap to move it
  document.body.classList.add('adding'); $('placeHint').hidden = false; $('addActions').hidden = false; $('mainActions').hidden = true;
  zoom = Math.max(zoom, 1.4); dirty = true; render();
}
function stopAdding() {
  adding = null; document.body.classList.remove('adding'); $('placeHint').hidden = true; $('addActions').hidden = true; $('mainActions').hidden = false;
  dirty = true; render();
}
function addWaypoint() {
  if (!adding || !inBounds(adding)) return;
  const ins = insertion(adding), pts = remaining(), n = route.stops.length + 1;
  pts.splice(ins.i, 0, { x: +adding.x.toFixed(1), y: +adding.y.toFixed(1), kind: 'stop', name: `Waypoint ${n}` });
  stopAdding();
  if (relay.send({ type: 'plan', points: pts })) { vibrate([40, 40, 40]); note('Waypoint sent. Base is replanning'); } else note('Not sent: no link to base');
}
$('addWp').onclick = startAdding;
$('addCancel').onclick = stopAdding;
canvas.addEventListener('pointerup', (e) => {
  if (!adding || !cam) return;
  const r = canvas.getBoundingClientRect(); adding = toWorld(e.clientX - r.left, e.clientY - r.top); dirty = true; render();
});

// ---------- press and hold ----------
// A gloved tap must not reroute or raise an alarm by accident, so each action needs a hold (data-hold, ms).
function holdToConfirm(btn, onConfirm) {
  let start = 0, raf = 0;
  const reset = () => { cancelAnimationFrame(raf); start = 0; btn.style.setProperty('--p', 0); };
  const tick = (now) => {
    const p = Math.min(1, (now - start) / +btn.dataset.hold);
    btn.style.setProperty('--p', p);
    if (p >= 1) { reset(); onConfirm(); return; }
    raf = requestAnimationFrame(tick);
  };
  const begin = () => { if (btn.disabled || start) return; start = performance.now(); vibrate(15); raf = requestAnimationFrame(tick); };
  btn.addEventListener('pointerdown', (e) => { try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } begin(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, reset);
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); begin(); } });
  btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') reset(); });
  btn.addEventListener('click', (e) => e.preventDefault());
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* optional */ } };

// ---------- relay ----------
const relay = connect({
  role: 'wrist',
  onState: applyState,
  onStatus: (up) => { online = up; if (!up) { state = null; raw = null; } render(); dirty = true; },
});
function send(ev, sent) {
  if (relay.send(ev)) { vibrate([60, 60, 60]); note(sent); } else note('Not sent: no link to base');
}
holdToConfirm($('reroute'), () => send({ type: 'requestReroute' }, 'Reroute requested'));
holdToConfirm($('sos'), () => send({ type: 'panic' }, 'SOS sent to base'));
holdToConfirm($('addConfirm'), addWaypoint);
loadRoute();

// ---------- clock, landscape and screen ----------
const clock = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
clock(); setInterval(clock, 10000);
// On a phone, offer full screen locked to landscape (browsers only allow the lock in full screen, after a tap).
const touch = matchMedia('(pointer: coarse)').matches, canLock = !!(screen.orientation && screen.orientation.lock && document.documentElement.requestFullscreen);
$('landscape').hidden = !(touch && canLock);
$('landscape').onclick = async () => {
  try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch { /* not allowed here: turn the phone by hand */ }
  $('landscape').hidden = true; keepAwake();
};
// Keep the phone's screen on while it is worn (where the browser allows it).
async function keepAwake() { try { if (navigator.wakeLock && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch { /* optional */ } }
keepAwake(); document.addEventListener('visibilitychange', keepAwake);
render();

// Beacon Hub: relay connection and app setup for the control-centre screen.
// Contract field names live in route.js (waypoints, state) and relay.js (events); paths and layer styling in config.js.
import { CONFIG } from './config.js';
import { loadTerrain, flatTerrain } from './terrain.js';
import { readWaypoints, readState, emptyState } from './route.js';
import { connectRelay, events } from './relay.js';
import { localRelay } from './local.js';
import { createMap } from './map.js';
import { drawRing } from './ring.js';
import { drawOverlay } from './overlay.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nn = (a, b) => (a != null ? a : b);
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '--' : (+n).toFixed(d));
const fmt1 = (n) => (n == null ? '--' : n < 10 ? (+n).toFixed(1) : String(Math.round(n)));
const pct = (f) => (f == null ? '--' : String(Math.round(f * 100)));   // contracts carry fractions 0..1; the screen shows percent
const hm = (min) => { const m = Math.max(0, Math.round(min || 0)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const ICON = {
  ok: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic ok"><path d="M5 12l5 5L20 7"/></svg>',
  no: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic no"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5M12 18v.5"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
};

const app = {
  doc: null, route: null, terrain: null, map: null, state: emptyState(), gotState: false,
  link: null, relayStatus: 'connecting', relayUrl: '', clients: null, fake: { waypoints: false, layers: false, terrain: false },
  mode: 'plan', layers: [], layersOn: new Set(CONFIG.LAYERS_ON), slope: null,
  draft: [], draftDirty: false, placing: null, planPending: 0, planNote: '',
  focusStop: null, follow: false, log: [], sound: true, emergencyAt: 0, resetArmed: 0, warned: {},
  astro: { x: 0, y: 0, seg: 0, anim: null, wA: null, wB: null, f: 0 }, listKey: '', listIdx: 0,
  u: 16,
};
window.hub = app; // handy in the browser console while integrating

// ---------- derived values ----------
const name = () => CONFIG.ASTRONAUT.name;
const emergency = () => app.state.mode === 'storm' || app.state.storm || app.state.panic;
function activeList() {
  const s = app.state, rr = s.reroute && s.reroute.waypoints.length ? s.reroute : null;
  if (rr) return { list: rr.waypoints, idx: Math.min(rr.wp, rr.waypoints.length - 1), key: `rr:${app.route.key}:${rr.from}`, rr: true };
  return { list: app.route.waypoints, idx: Math.min(s.wp, app.route.waypoints.length - 1), key: 'main:' + app.route.key, rr: false };
}
// Live values: what the relay put in the state, else the value on the current waypoint.
function live() {
  const s = app.state, a = activeList(), w = a.list[a.idx] || {};
  let shelter = null; // the known shelter point nearest the astronaut, for the map label
  for (const sh of app.route.shelters) { const d = Math.hypot(sh.x - w.x, sh.y - w.y); if (!shelter || d < shelter.d) shelter = { ...sh, d }; }
  return {
    w, x: w.x, y: w.y, elapsedMin: nn(w.t, 0),
    oxygen: nn(s.oxygen, w.oxygen), dose: nn(s.dose, w.dose), openSky: nn(s.openSky, w.openSky),
    sunlit: nn(s.sunlit, w.sun ? w.sun.visible : null), baseLink: nn(s.baseLink, w.base ? w.base.visible : null), earthLink: nn(s.earthLink, w.earth ? w.earth.visible : null),
    headingDeg: nn(s.headingDeg, w.headingDeg), shelterBearingDeg: nn(s.shelterBearingDeg, w.shelter ? w.shelter.az : null),
    shelterMin: nn(s.shelterMin, w.shelter ? w.shelter.min : null), shelter, atShelter: !!w.isShelter,
  };
}
function stopInfo() {
  const s = app.state, stops = app.route.stops, rr = !!s.reroute;
  const at = rr ? -1 : stops.findIndex((st) => st.wp === s.wp), next = stops.findIndex((st) => st.wp > s.wp);
  return { at, next, rr, last: s.wp >= app.route.waypoints.length - 1 };
}
function doing() {
  const s = app.state, i = stopInfo(), L = live(), w = app.route.waypoints;
  if (s.reroute) return L.atShelter ? 'In shelter' : 'Heading to shelter';
  if (i.at >= 0) return `At ${app.route.stops[i.at].name}`;
  if (L.atShelter) return 'In shelter';
  if (i.last && s.wp > 0) return `At ${w[w.length - 1].label || 'the end'}`;
  if (s.wp === 0) return 'At the start, ready';
  return i.next >= 0 ? `Walking to ${app.route.stops[i.next].name}` : `Walking to ${w[w.length - 1].label || 'the end'}`;
}
const marsTime = (elapsed) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(CONFIG.START_LOCAL_TIME || ''); if (!m) return '';
  const t = (+m[1] * 60 + +m[2] + Math.round(elapsed || 0)) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const clockAt = (min) => marsTime(min) || `${fmt(min)} min`;

// ---------- log, toast, sound ----------
function log(text, level = '') { app.log.unshift({ at: hm(live().elapsedMin), text, level }); app.log.length = Math.min(app.log.length, 60); renderLog(); }
let toastTimer;
function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3400); }
let audio;
function beep() {
  if (!app.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.28, 0.56].forEach((d) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = 0.12; o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.16); });
  } catch { /* sound is optional */ }
}
function warnOnce(key, text) { if (!app.warned[key]) { app.warned[key] = 1; log(text, 'caution'); } }

// ---------- incoming ----------
let routeSerial = 0;
function setRoute(doc, announce) {
  const route = readWaypoints(doc, CONFIG);
  if (!route.waypoints.length) throw new Error('The waypoint file has no "main" waypoints.');
  if (doc.version !== 1) warnOnce('wpv', `Waypoint file is version ${doc.version}; the hub was written for version 1.`);
  route.key = String(++routeSerial); app.doc = doc; app.route = route;
  resetDraft();
  if (app.planPending) { clearTimeout(app.planPending); app.planPending = 0; app.planNote = 'Route received.'; }
  if (announce) log(`Route loaded: ${fmt(route.totals.timeMin)} min, ${route.stops.length} science stop${route.stops.length === 1 ? '' : 's'}.`);
  app.focusStop = null; syncAstro(true);
}
function onState(raw) {
  const p = app.state, first = !app.gotState; app.gotState = true;
  const ns = readState(raw, app.route, first ? null : p); app.state = ns;
  if (ns.version != null && ns.version !== 1) warnOnce('stv', `Relay state is version ${ns.version}; the hub was written for version 1.`);
  const si = stopInfo(), L = live();
  if (!first) {
    if (ns.storm && !p.storm) log('Solar storm started. Rerouting to shelter.', 'emergency');
    if (!ns.storm && p.storm) log('Solar storm ended.');
    if (ns.panic && !p.panic) log(`Panic button pressed by ${name()}.`, 'emergency');
    if (ns.rerouteRequested && !p.rerouteRequested) log(`${name()} requested a reroute. Heading to shelter.`, 'caution');
    if (!ns.reroute && p.reroute) log('Back on the main route.');
    if (!ns.reroute && ns.wp !== p.wp) {
      if (si.at >= 0) log(`Arrived at ${app.route.stops[si.at].name}.`);
      else if (ns.wp === 0 && p.wp > 0) log('Back at the start of the walk.');
      else if (si.last) log(`Reached ${L.w.label || 'the end of the route'}.`);
    }
    if (ns.reroute && L.atShelter && !(p.reroute && p.reroute.wp === ns.reroute.wp)) log('Reached shelter.');
    if (ns.mode === 'warning' && p.mode === 'nominal') log(ns.baseLink === false ? 'Warning: no line of sight to base.' : `Warning: ${fmt1(ns.shelterMin)} min from shelter.`, 'caution');
  }
  const em = emergency();
  if (em && !app.emergencyAt) { app.emergencyAt = Date.now(); beep(); app.mode = 'live'; frameEmergency(); }
  if (!em) app.emergencyAt = 0;
  if ((ns.wp > 0 || ns.reroute) && app.mode === 'plan' && !app.draftDirty) app.mode = 'live';
  if (!first && p.wp === 0 && !p.reroute && (ns.wp > 0 || ns.reroute) && app.fake.waypoints && !app.fake.terrain && !app.terrain.flat && !em) routeView(); // the walk has started: show it
  syncAstro(first); renderAll();
}
// Opening view. Normally framed on the walk. While the route is still the fake one but the terrain is real,
// the fake coordinates mean nothing on Mars, so the view opens on the terrain's parking spot instead.
function routeView() {
  const r = app.route, T = app.terrain, R = CONFIG.HOME_RADIUS_M;
  app.map.flyTo({ az: 24, pitch: 54 }, 0);
  if (app.fake.waypoints && !app.fake.terrain && !T.flat && app.state.wp === 0 && !app.state.reroute) { const c = T.parking || { x: T.W / 2, y: T.H / 2 }; app.map.frame([{ x: c.x - R, y: c.y - R }, { x: c.x + R, y: c.y + R }], 1.5, 460); }
  else app.map.frame([...r.waypoints, ...r.shelters], 3, 460);
}
function frameEmergency() {
  const rr = app.state.reroute, L = live(), dest = rr && rr.x != null ? { x: rr.x, y: rr.y } : L.shelter;
  if (dest && app.map) app.map.frame([{ x: L.x, y: L.y }, dest], 2.6, 520);
}

// ---------- astronaut marker animation ----------
function syncAstro(jump) {
  const a = activeList(), A = app.astro, end = a.list[a.idx]; if (!end) return;
  if (jump || !A.wA) Object.assign(A, { x: end.x, y: end.y, seg: a.rr ? app.state.wp : a.idx, anim: null, wA: end, wB: end, f: 0 });
  else {
    let pts;
    if (a.key === app.listKey && a.idx !== app.listIdx) { pts = []; const d = a.idx > app.listIdx ? 1 : -1; for (let i = app.listIdx; i !== a.idx + d; i += d) pts.push({ w: a.list[i], i }); }
    else if (a.key !== app.listKey || Math.hypot(end.x - A.x, end.y - A.y) > 0.5) pts = [{ w: { ...end, x: A.x, y: A.y, skyline: (A.wB && A.wB.skyline) || end.skyline }, i: a.idx }, { w: end, i: a.idx }];
    if (pts && pts.length > 1) A.anim = { pts, t0: performance.now(), ms: Math.max(700, Math.min(2800, 400 + 260 * (pts.length - 1))), rr: a.rr };
    else { A.wA = A.wB = end; A.f = 0; }
  }
  app.listKey = a.key; app.listIdx = a.idx;
  if (app.follow && app.map && !emergency()) app.map.flyTo({ x: end.x, y: end.y });
}
function tickAstro(now) {
  const A = app.astro, an = A.anim; if (!an) return false;
  const k = Math.min(1, (now - an.t0) / an.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const f = e * (an.pts.length - 1), i = Math.min(an.pts.length - 2, Math.floor(f)), t = f - i, a = an.pts[i], b = an.pts[i + 1];
  A.x = a.w.x + (b.w.x - a.w.x) * t; A.y = a.w.y + (b.w.y - a.w.y) * t; A.wA = a.w; A.wB = b.w; A.f = t;
  A.seg = an.rr ? app.state.wp : Math.min(a.i, b.i);
  if (k >= 1) { A.anim = null; A.wA = A.wB = b.w; A.f = 0; if (!an.rr) A.seg = b.i; }
  return true;
}
// The helmet ring blends each of the skyline values between neighbouring waypoints, as waypoints.md describes.
function ringData() {
  const A = app.astro, L = live(), a = A.wA || L.w, b = A.wB || L.w, w = L.w;
  const turn = (x, y) => x + ((((y - x) % 360) + 540) % 360 - 180) * A.f;
  let skyline = w.skyline || [];
  if (a !== b && a.skyline && b.skyline && a.skyline.length === b.skyline.length && a.skyline.length) skyline = a.skyline.map((v, i) => v + (b.skyline[i] - v) * A.f);
  const az = (k) => (a[k] && b[k] && a[k].az != null && b[k].az != null ? turn(a[k].az, b[k].az) : w[k] ? w[k].az : null);
  return {
    skyline, openSky: a.openSky != null && b.openSky != null ? a.openSky + (b.openSky - a.openSky) * A.f : L.openSky,
    sun: w.sun, earth: w.earth ? { ...w.earth, visible: L.earthLink } : null,
    base: w.base ? { az: az('base'), visible: L.baseLink } : null, shelter: w.shelter && !L.atShelter ? { az: az('shelter') } : null,
  };
}

// ---------- outgoing ----------
function send(ev, label) {
  if (!app.link || !app.link.send(ev)) { toast('Not connected to the relay. Nothing was sent.'); return false; }
  if (label) log(label, 'sent'); return true;
}
function command(cmd) {
  const s = app.state, si = stopInfo();
  switch (cmd) {
    case 'next': send(events.next()); break;
    case 'back': send(events.back()); break;
    case 'nextstop': {
      if (s.reroute) return toast('On the reroute: use Next to walk it.');
      const index = si.next >= 0 ? app.route.stops[si.next].wp : app.route.waypoints.length - 1;
      if (index !== s.wp) send(events.goto(index));
      break;
    }
    case 'storm': send(events.storm(!s.storm), s.storm ? 'Presenter: end storm sent.' : 'Presenter: storm sent.'); break;
    case 'panic': if (!s.panic) send(events.panic(), 'Presenter: panic sent.'); break;
    case 'reset':
      if (Date.now() - app.resetArmed < 2500) { app.resetArmed = 0; send(events.reset(), 'Presenter: reset sent.'); }
      else { app.resetArmed = Date.now(); toast('Press Reset again to restart the walk.'); }
      break;
  }
}

// ---------- planning ----------
function resetDraft() {
  const w = app.route.waypoints, a = w[0], b = w[w.length - 1];
  app.draft = [{ x: a.x, y: a.y, kind: 'start' }, ...app.route.stops.map((s) => ({ x: s.x, y: s.y, kind: 'stop', name: s.name })), { x: b.x, y: b.y, kind: 'end' }];
  app.draftDirty = false; app.placing = null;
}
function renumber() { let n = 0; for (const p of app.draft) if (p.kind === 'stop') p.name = `Stop ${++n}`; }
function slopeAt(x, y) { // degrees: from the terrain when there is one, else from the slope layer
  if (app.terrain && !app.terrain.flat) return app.terrain.slopeAt(x, y);
  const s = app.slope; if (!s) return null;
  const c = Math.floor(x / s.mpp), r = Math.floor((s.h * s.mpp - y) / s.mpp); // cell containing the point (shared/conventions.md)
  if (c < 0 || r < 0 || c >= s.w || r >= s.h) return null;
  return s.min + s.data[(r * s.w + c) * 4] / 255 * (s.max - s.min);
}
function placeAt(w) {
  const sl = slopeAt(w.x, w.y);
  if (sl != null && sl > CONFIG.MAX_SLOPE_DEG) return toast(`Too steep for a suited astronaut: ${sl.toFixed(0)}° here, limit ${CONFIG.MAX_SLOPE_DEG}°.`);
  const p = { x: +w.x.toFixed(1), y: +w.y.toFixed(1) };
  if (app.placing === 'start') { app.draft[0] = { ...p, kind: 'start' }; app.placing = null; }
  else if (app.placing === 'end') { app.draft[app.draft.length - 1] = { ...p, kind: 'end' }; app.placing = null; }
  else { app.draft.splice(app.draft.length - 1, 0, { ...p, kind: 'stop' }); renumber(); }
  app.draftDirty = true; app.planNote = ''; renderAll();
}
const planPoints = () => app.draft.map(({ x, y, kind }) => ({ x, y, kind }));
function sendPlan() {
  if (!send(events.plan(planPoints()), `Plan sent (${app.draft.filter((p) => p.kind === 'stop').length} science stops).`)) return;
  app.placing = null; app.planNote = 'Waiting for a new route…';
  clearTimeout(app.planPending);
  app.planPending = setTimeout(() => { app.planPending = 0; app.planNote = 'No new route arrived. Reload the route file once the engine has exported it.'; renderLeft(); }, CONFIG.PLAN_TIMEOUT_MS);
  renderLeft();
}
async function copyPlan() {
  const text = JSON.stringify({ version: 1, points: planPoints() }, null, 2);
  try { await navigator.clipboard.writeText(text); app.planNote = 'Start, stops and end copied as JSON.'; } catch { console.log(text); app.planNote = 'Copy was blocked. The JSON is in the browser console.'; }
  renderLeft();
}
async function reloadRoute() {
  try { setRoute(await getJSON(app.waypointsUrl), true); app.planNote = 'Route file reloaded.'; renderAll(); }
  catch (e) { toast('Could not reload the route file: ' + e.message); }
}

// ---------- rendering ----------
function renderAll() { renderHeader(); renderBanner(); renderLeft(); renderRight(); renderTimeline(); renderMirror(); }
function renderHeader() {
  const L = live(), local = app.link && app.link.kind === 'local', up = app.relayStatus === 'open';
  document.body.classList.toggle('emergency', emergency());
  document.body.classList.toggle('placing', !!app.placing);
  document.body.classList.toggle('stale', !!app.link && !local && !up);
  $('clock').textContent = hm(L.elapsedMin);
  const mt = marsTime(L.elapsedMin); $('marsClock').hidden = !mt; $('marsTime').textContent = mt;
  $('modePlan').setAttribute('aria-pressed', app.mode === 'plan'); $('modeLive').setAttribute('aria-pressed', app.mode === 'live');
  const chip = (on, label) => `<span class="dev ${on ? 'on' : 'off'}">${on ? ICON.ok : ICON.no}${label}</span>`;
  const n = (role) => (app.clients || []).filter((c) => c.role === role).length;
  $('devices').innerHTML = local ? `<span class="dev local">${ICON.info}Local mode, no relay</span>`
    : `<span title="${esc(app.relayUrl)}">${chip(up, up ? 'Relay' : 'Relay offline')}</span>` + (up && app.clients ? chip(n('headset') > 0, 'Headset') + chip(n('wrist') > 0, 'Wrist') + chip(n('esp') > 0, 'Panic button') : '');
  $('soundBtn').textContent = app.sound ? 'Sound on' : 'Sound off';
  $('viewFollow').setAttribute('aria-pressed', app.follow);
  $('stormBtn').firstChild.textContent = app.state.storm ? 'End storm ' : 'Storm ';
  const hint = $('mapHint'); hint.hidden = !app.placing;
  if (app.placing) hint.textContent = app.placing === 'stop' ? 'Click the map to add science stops. Esc when done.' : `Click the map to set the ${app.placing}.`;
}
function bannerModel() {
  const s = app.state, L = live(), local = app.link && app.link.kind === 'local';
  if (emergency()) {
    return { level: 'emergency', icon: ICON.warn,
      html: `<b>${s.storm ? 'SOLAR STORM' : 'PANIC BUTTON'}</b><span class="act">${L.atShelter ? 'In shelter' : `Go to shelter · ${fmt1(L.shelterMin)} min away`}</span><span class="sub">${s.storm && s.panic ? 'Panic button also pressed. ' : s.panic ? `Pressed by ${esc(name())}. Reset clears it. ` : ''}<span id="emTimer"></span></span>`,
      actions: s.storm ? [['endstorm', 'End storm']] : [] };
  }
  if (app.link && !local && app.relayStatus !== 'open') return { level: 'caution', icon: ICON.warn, html: `<b>Relay offline</b><span class="sub">Reconnecting to ${esc(app.relayUrl)}. Values on screen may be out of date.</span>`, actions: [['local', 'Run locally without the relay']] };
  if (s.rerouteRequested) return { level: 'caution', icon: ICON.warn, html: `<b>${esc(name())} requested a reroute</b><span class="sub">${L.atShelter ? 'Now in shelter.' : `Heading to shelter · ${fmt1(L.shelterMin)} min away.`} Reset returns to the main route.</span>`, actions: [] };
  if (s.reroute) return { level: 'caution', icon: ICON.info, html: `<b>On the reroute</b><span class="sub">${L.atShelter ? 'In shelter.' : `${fmt1(L.shelterMin)} min to shelter.`} Reset returns to the main route.</span>`, actions: [] };
  if (s.mode === 'warning') return { level: 'caution', icon: ICON.warn, html: `<b>Warning</b><span class="sub">${L.baseLink === false ? 'No line of sight to base. ' : ''}${fmt1(L.shelterMin)} min from shelter.</span>`, actions: [] };
  if (app.mode === 'plan') return { level: 'ok', icon: ICON.info, html: `<b>Planning</b><span class="sub">Set the start, science stops and end on the map, then send them to the planner.</span>`, actions: [] };
  const si = stopInfo(), nx = si.next >= 0 ? app.route.stops[si.next] : null;
  return { level: 'ok', icon: ICON.ok, html: `<b>Nominal</b><span class="sub">${esc(doing())}${nx && si.at < 0 && nx.etaMin != null ? ` · arriving in ${fmt(Math.max(0, nx.etaMin - L.elapsedMin))} min` : ''}</span>`, actions: [] };
}
function renderBanner() {
  const m = bannerModel();
  $('banner').className = 'banner ' + m.level; $('bannerIcon').innerHTML = m.icon; $('bannerText').innerHTML = m.html;
  $('bannerActions').innerHTML = m.actions.map(([act, label, cls]) => `<button type="button" data-act="${act}" class="${cls || ''}">${esc(label)}</button>`).join('');
  tick();
}
function tick() {
  const el = $('emTimer'); if (el && app.emergencyAt) { const s = Math.floor((Date.now() - app.emergencyAt) / 1000); el.textContent = `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
}
function renderLayers() {
  $('layersPanel').innerHTML = '<h2>Map layers</h2>' + (app.layers.length ? '' : '<p class="note">No layers yet. They appear when the engine exports data/out/layers/.</p>') + app.layers.map((l, i) => {
    const grad = l.stops.map((c, k) => `rgba(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')},${c[3]}) ${k * 50}%`).join(', ');
    return `<div class="layer" data-id="${l.id}"><label><input type="checkbox" data-layer="${i}"><span>${esc(l.label)}</span><kbd>${i + 1}</kbd></label>
      <div class="legend"><span>${esc(l.lo)}</span><i style="background: linear-gradient(to right, ${grad}), #a56b45"></i><span>${esc(l.hi)}</span></div>
      <div class="src">${esc(l.source)}</div></div>`;
  }).join('');
  syncLayers();
}
function syncLayers() {
  app.layers.forEach((l, i) => {
    const on = app.layersOn.has(l.id); app.map.setLayerOn(i, on);
    const row = document.querySelector(`.layer[data-id="${l.id}"]`);
    if (row) { row.classList.toggle('on', on); row.querySelector('input').checked = on; }
  });
}
function renderLeft() {
  const r = app.route, s = app.state, si = stopInfo(), t = r.totals, w = r.waypoints, first = w[0], last = w[w.length - 1];
  if (app.mode === 'plan') {
    const rows = app.draft.map((p, i) => `<li><span class="tag ${p.kind}">${p.kind === 'stop' ? esc(p.name) : p.kind === 'start' ? 'Start' : 'End'}</span><span class="xy mono">${fmt(p.x)}, ${fmt(p.y)}</span>${p.kind === 'stop' ? `<button type="button" class="x" data-act="del" data-i="${i}" aria-label="Remove ${esc(p.name)}">Remove</button>` : ''}</li>`).join('');
    $('routePanel').innerHTML = `<h2>Plan the walk</h2>
      <div class="tools"><button type="button" data-act="place-start" aria-pressed="${app.placing === 'start'}">Start</button><button type="button" data-act="place-stop" aria-pressed="${app.placing === 'stop'}">Add stops</button><button type="button" data-act="place-end" aria-pressed="${app.placing === 'end'}">End</button></div>
      <ol class="pts">${rows}</ol>
      <div class="tools"><button type="button" class="primary" data-act="send-plan">Send to planner</button><button type="button" data-act="undo-plan" ${app.draftDirty ? '' : 'disabled'}>Undo</button></div>
      <div class="tools small"><button type="button" data-act="copy-plan">Copy as JSON</button><button type="button" data-act="reload-route">Reload route</button></div>
      <p class="note">${esc(app.planNote || (app.draftDirty ? 'Not sent yet. Map shows the last route.' : 'Showing the route from the waypoint file.'))}</p>`;
  } else {
    const row = (cls, n, label, eta, status, i) => `<li class="${cls}" ${i != null ? `data-act="focus" data-i="${i}" tabindex="0"` : ''}><span class="n">${n}</span><span class="nm">${esc(label)}</span><span class="eta mono">${eta}</span><span class="st">${status}</span></li>`;
    const stops = r.stops.map((st, i) => {
      const done = s.wp > st.wp || (si.rr && s.wp === st.wp), at = si.at === i, next = si.next === i && si.at < 0 && !si.rr;
      return row(`${done ? 'done' : ''} ${at ? 'now' : ''} ${next ? 'next' : ''} ${app.focusStop === i ? 'focus' : ''}`, st.num, st.name, clockAt(st.etaMin), done ? 'Done' : at ? 'Here' : next ? 'Next' : si.rr ? 'On hold' : '', i);
    }).join('');
    const atEnd = si.last && s.wp > 0 && !si.rr;
    $('routePanel').innerHTML = `<h2>Route</h2><ol class="stops">${row(s.wp > 0 || si.rr ? 'done' : 'now', 'S', first.label || 'Start', clockAt(first.t), s.wp > 0 || si.rr ? 'Done' : 'Here')}${stops}${last.isScienceStop ? '' : row(atEnd ? 'now' : '', 'E', last.label || 'End', clockAt(last.t), atEnd ? 'Here' : si.rr ? 'On hold' : '')}</ol>`;
  }
  const over = t.maxSlopeDeg > CONFIG.MAX_SLOPE_DEG;
  $('briefPanel').innerHTML = `<h2>Briefing</h2><dl>
    <div><dt>Walk time</dt><dd>${fmt(t.timeMin)} min</dd></div>
    <div><dt>Distance</dt><dd>${t.distanceM >= 1000 ? (t.distanceM / 1000).toFixed(2) + ' km' : fmt(t.distanceM) + ' m'}</dd></div>
    <div><dt>Oxygen used</dt><dd>${pct(t.oxygenUsed)}% of supply</dd></div>
    <div><dt>Radiation dose</dt><dd>${pct(t.dose)}% of budget</dd></div>
    <div><dt>Worst case to shelter</dt><dd>${fmt1(t.worstShelterMin)} min</dd></div>
    <div><dt>Steepest leg</dt><dd class="${over ? 'over' : ''}">${over ? ICON.warn + ' ' : ''}${fmt(t.maxSlopeDeg)}° / ${CONFIG.MAX_SLOPE_DEG}° max</dd></div></dl>`;
}
function renderRight() {
  const L = live(), s = app.state, si = stopInfo(), em = emergency();
  const tk = (v, yes, no) => (v == null ? '' : `<span class="tk ${v ? 'yes' : 'nope'}">${v ? ICON.ok : ICON.no}${v ? yes : no}</span>`);
  const num = (label, val, unit, cls = '') => `<div class="num ${cls}"><span class="lbl">${label}</span><span class="val mono">${val}<small>${unit}</small></span></div>`;
  $('astroPanel').innerHTML = `<div class="who"><span class="name">${esc(name())}</span><span class="suit">${esc(CONFIG.ASTRONAUT.suit)}</span><span class="doing">${esc(doing())}</span></div>
    <div class="nums">${num('Oxygen left', pct(L.oxygen), '%')}${num('To shelter', fmt1(L.shelterMin), 'min', em ? 'hot' : '')}${num('Dose so far', pct(L.dose), '% of budget')}${num('Open sky', pct(L.openSky), '%')}</div>
    <div class="ticks">${tk(L.baseLink, 'Base link', 'No base link')}${tk(L.earthLink, 'Earth link', 'No Earth link')}${tk(L.sunlit, 'In sunlight', 'In shadow')}${s.earthDelayMin != null ? `<span class="tk">Earth delay ${fmt(s.earthDelayMin)} min</span>` : ''}</div>`;
  const i = app.focusStop != null ? app.focusStop : si.at >= 0 ? si.at : si.next, st = i >= 0 ? app.route.stops[i] : null;
  if (!st) $('stopPanel').innerHTML = `<h2>Science stop</h2><p class="note">${app.route.stops.length ? 'All science stops visited.' : 'No science stops on this route. Add them in Plan mode.'}</p>`;
  else {
    const done = s.wp > st.wp || (si.rr && s.wp === st.wp), at = si.at === i, eta = st.etaMin != null ? Math.max(0, st.etaMin - L.elapsedMin) : null, note = CONFIG.STOP_NOTES[st.id] || {};
    $('stopPanel').innerHTML = `<h2>${at ? 'Science stop · here now' : done ? 'Science stop · done' : si.rr ? 'Science stop · on hold' : `Science stop · in ${fmt(eta)} min`}</h2>
      <div class="stop">${note.photo ? `<img src="${esc(note.photo)}" alt="View on arrival at ${esc(st.name)}">` : '<div class="nophoto">No arrival photo yet</div>'}
      <div><div class="sname">${esc(st.name)}</div><p>${esc(note.task || 'No science task written for this stop yet.')}</p>${note.credit ? `<p class="credit">${esc(note.credit)}</p>` : ''}</div></div>`;
  }
  $('mirrorTitle').textContent = `What ${name()} sees`;
  $('hudLine').textContent = `Shelter ${fmt1(L.shelterMin)} min · ${L.baseLink === false ? 'no base link' : 'base link'} · O2 ${pct(L.oxygen)}% · dose ${pct(L.dose)}%`;
  // shared/state.md: the arrow is drawn at shelterBearingDeg - headingDeg, so 0 is straight ahead
  const arrow = L.shelterBearingDeg != null && L.headingDeg != null ? L.shelterBearingDeg - L.headingDeg : 0;
  $('wrist').className = 'wrist' + (em ? ' em' : '');
  $('wrist').innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" class="arrow" style="transform: rotate(${arrow}deg)"><path d="M12 20V5M6 11l6-6 6 6"/></svg>
    <div class="big mono">${fmt1(L.shelterMin)}</div><div class="cap">min to shelter</div>
    <div class="bar" title="Oxygen"><i style="width:${Math.max(0, Math.min(1, L.oxygen || 0)) * 100}%"></i></div><div class="bar dose" title="Dose"><i style="width:${Math.max(0, Math.min(1, L.dose || 0)) * 100}%"></i></div>`;
}
function renderMirror() { drawRing($('ring'), ringData(), { emergency: emergency() }); }
function renderTimeline() {
  const r = app.route, L = live(), tot = Math.max(0.1, r.totals.timeMin || 0.1), p = (m) => Math.max(0, Math.min(100, m / tot * 100));
  const ticks = r.stops.map((st) => (st.etaMin == null ? '' : `<span class="tick" style="left:${p(st.etaMin)}%"><b>${st.num}</b></span>`)).join('');
  const s0 = marsTime(0), s1 = marsTime(tot);
  $('timelinePanel').innerHTML = `<h2>Walk timeline</h2><div class="tl"><div class="tlbar"><i style="width:${p(L.elapsedMin)}%"></i>${ticks}<span class="nowm" style="left:${p(L.elapsedMin)}%"></span></div>
    <div class="tlmeta"><span>Start${s0 ? ` <b class="mono">${s0}</b>` : ''}</span><span><b class="mono">${fmt(L.elapsedMin, 1)}</b> of <b class="mono">${fmt(tot, 1)}</b> min${app.state.reroute ? ' · on reroute' : ''}</span><span>End${s1 ? ` <b class="mono">${s1}</b>` : ''}</span></div></div>`;
}
function renderLog() {
  $('log').innerHTML = app.log.slice(0, 30).map((e) => `<li class="${e.level}"><time class="mono">${e.at}</time><span>${esc(e.text)}</span></li>`).join('') || '<li><span class="mutedtxt">Nothing yet.</span></li>';
}

// ---------- input ----------
function setMode(m) { app.mode = m; if (m === 'live') app.placing = null; renderAll(); }
function toggleLayer(i) { const l = app.layers[i]; if (!l) return; app.layersOn.has(l.id) ? app.layersOn.delete(l.id) : app.layersOn.add(l.id); syncLayers(); }
function focusStop(i) { app.focusStop = app.focusStop === i ? null : i; const st = app.route.stops[i]; if (app.focusStop != null && st) app.map.flyTo({ x: st.x, y: st.y, dist: Math.min(app.map.cam.dist, 420) }); renderAll(); }
function act(a, el) {
  switch (a) {
    case 'place-start': case 'place-stop': case 'place-end': { const k = a.slice(6); app.placing = app.placing === k ? null : k; renderAll(); break; }
    case 'del': app.draft.splice(+el.dataset.i, 1); renumber(); app.draftDirty = true; app.planNote = ''; renderAll(); break;
    case 'send-plan': sendPlan(); break;
    case 'copy-plan': copyPlan(); break;
    case 'reload-route': reloadRoute(); break;
    case 'undo-plan': resetDraft(); app.planNote = ''; renderAll(); break;
    case 'focus': focusStop(+el.dataset.i); break;
    case 'endstorm': if (app.state.storm) command('storm'); break;
    case 'local': startLocal(); break;
  }
}
function wireInput() {
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cmd]'); if (c) return command(c.dataset.cmd);
    const a = e.target.closest('[data-act]'); if (a) return act(a.dataset.act, a);
  });
  document.addEventListener('change', (e) => { if (e.target.dataset.layer != null) toggleLayer(+e.target.dataset.layer); });
  $('modePlan').onclick = () => setMode('plan'); $('modeLive').onclick = () => setMode('live');
  $('viewFit').onclick = routeView; $('viewTop').onclick = () => app.map.view('top');
  $('viewFollow').onclick = () => { app.follow = !app.follow; if (app.follow) app.map.flyTo({ x: app.astro.x, y: app.astro.y }); renderHeader(); };
  $('soundBtn').onclick = () => { app.sound = !app.sound; renderHeader(); };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Enter' && e.target.closest && e.target.closest('li[data-act]')) return e.target.click();
    if (e.target.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return; // let a focused button work normally
    const keys = { ArrowRight: () => command(e.shiftKey ? 'nextstop' : 'next'), ' ': () => command('next'), ArrowLeft: () => command('back'), n: () => command('nextstop'),
      s: () => command('storm'), p: () => command('panic'), r: () => command('reset'),
      t: () => app.map.view('top'), f: routeView, g: () => $('viewFollow').click(), m: () => $('soundBtn').click(),
      h: () => document.body.classList.toggle('noPresenter'), Escape: () => { app.placing = null; app.focusStop = null; renderAll(); } };
    if (/^[1-9]$/.test(k)) { toggleLayer(+k - 1); return e.preventDefault(); }
    if (keys[k]) { keys[k](); e.preventDefault(); }
  });
  app.map.onClick = ({ sx, sy, world }) => {
    if (app.placing) return world ? placeAt(world) : toast('Click on the terrain.');
    let best = -1, bd = 1.6 * app.u;
    app.route.stops.forEach((st, i) => { const p = app.map.project(st.x, st.y); const d = Math.hypot(p.x - sx, p.y - sy); if (p.ok && d < bd) { bd = d; best = i; } });
    if (best >= 0) focusStop(best);
  };
}

// ---------- relay ----------
function startRelay() {
  const q = new URLSearchParams(location.search), url = q.get('relay') || CONFIG.RELAY_URL;
  app.relayUrl = url || `wss://${location.host}/ws`;
  // The relay is HTTPS only (relay/README.md), so a page opened over plain http has no relay to talk to.
  if (q.has('local') || (location.protocol !== 'https:' && !url)) return startLocal();
  app.link = connectRelay({ role: CONFIG.ROLE, url, onState,
    onStatus: (st) => { const was = app.relayStatus; app.relayStatus = st; if (st === 'open' && was !== 'open') log('Relay connected.'); if (st === 'closed' && was === 'open') log('Relay connection lost.', 'caution'); pollClients(); renderHeader(); renderBanner(); } });
  setInterval(pollClients, 2500);
}
// The relay lists who is connected at /clients (relay/README.md); the header shows the headset, wrist and ESP.
async function pollClients() {
  if (!app.link || app.link.kind !== 'relay' || app.relayStatus !== 'open') return;
  try {
    const list = await (await fetch('/clients', { cache: 'no-store' })).json(), prev = app.clients;
    app.clients = Array.isArray(list) ? list : null;
    if (prev && app.clients) for (const [role, label] of [['headset', 'Headset'], ['wrist', 'Wrist'], ['esp', 'Panic button']]) {
      const was = prev.some((c) => c.role === role), is = app.clients.some((c) => c.role === role);
      if (was !== is) log(`${label} ${is ? 'connected' : 'disconnected'}.`, is ? '' : 'caution');
    }
    renderHeader();
  } catch { app.clients = null; }
}
function startLocal() {
  if (app.link) app.link.close();
  app.gotState = false;
  app.link = localRelay({ doc: app.doc, onState });
  log('Running locally. Other devices will not follow.', 'caution'); renderAll();
}

// ---------- boot ----------
const loadImage = (url) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('missing ' + url)); im.src = url; });
const getJSON = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`); return r.json(); };
async function boot() {
  const forceFake = new URLSearchParams(location.search).has('fake'), R = CONFIG.REAL, F = CONFIG.FAKE;
  const firstOf = async (real, fake, load) => { if (!forceFake) { try { return { v: await load(real), url: real, fake: false }; } catch { /* fall through to the fake */ } } try { return { v: await load(fake), url: fake, fake: true }; } catch { return { v: null, url: fake, fake: true }; } };

  // Waypoints: real export if it exists, else the shared fake (the relay picks the same way).
  const wp = await firstOf(R.waypoints, F.waypoints, getJSON);
  if (!wp.v) throw new Error(`Could not load a waypoint file (tried ${R.waypoints} and ${F.waypoints}).`);
  const doc = wp.v; app.waypointsUrl = wp.url; app.fake.waypoints = wp.fake;

  // Terrain: real if it exists. The fake terrain is only used with the fake route; otherwise a flat sheet.
  let terrain = forceFake ? null : await loadTerrain(R.terrain).catch(() => null), note = '';
  if (!terrain && wp.fake) { terrain = await loadTerrain(F.terrain).catch(() => null); app.fake.terrain = !!terrain; }

  // Layers: real if they exist. Fake layers describe the fake scene, so they are not laid over real terrain.
  let meta = forceFake ? null : await getJSON(R.layers + 'meta.json').catch(() => null), layersUrl = R.layers;
  if (!meta && (app.fake.terrain || !terrain)) { meta = await getJSON(F.layers + 'meta.json').catch(() => null); layersUrl = F.layers; app.fake.layers = !!meta; }
  else if (!meta) note = 'The engine has not exported layers yet, so none are shown on the real terrain.';

  if (!terrain) {
    const pts = [...(doc.main || []), ...Object.values(doc.reroutes || {}).flat()].map((w) => w.pos);
    const W = meta ? meta.width * meta.metresPerPixel : Math.max(...pts.map((p) => p.x)) + 150, H = meta ? meta.height * meta.metresPerPixel : Math.max(...pts.map((p) => p.y)) + 150;
    terrain = flatTerrain(W, H, meta ? meta.metresPerPixel : 4); note = 'No terrain file found, so the map is flat.';
  }
  app.terrain = terrain;
  $('siteName').textContent = CONFIG.SITE_NAME;
  const fakes = [app.fake.waypoints && 'route', app.fake.layers && 'layers', app.fake.terrain && 'terrain'].filter(Boolean);
  $('synthChip').hidden = !fakes.length; $('synthChip').textContent = fakes.length === 3 ? 'Fake data' : `Fake ${fakes.join(' and ')}`;
  $('realChip').hidden = terrain.flat || app.fake.terrain; if (terrain.credit) $('realChip').title = 'Terrain and image: ' + terrain.credit;
  const sun = (doc.main && doc.main[0] && doc.main[0].sun) || null;
  app.map = createMap($('gl'), $('ov'), { terrain, sun, exaggeration: CONFIG.EXAGGERATION, imageGain: CONFIG.IMAGE_GAIN });
  if (terrain.imageUrl) loadImage(terrain.imageUrl).then((im) => app.map.setOrtho(im)).catch(() => {});
  if (meta) {
    if (meta.version !== 1) note += ` Layer metadata is version ${meta.version}; the hub was written for version 1.`;
    const wanted = CONFIG.LAYERS.filter((l) => meta.layers && meta.layers[l.id]).slice(0, 6);
    const loaded = await Promise.all(wanted.map((l) => loadImage(layersUrl + meta.layers[l.id].file).then((im) => ({ l, im })).catch(() => null)));
    loaded.filter(Boolean).forEach(({ l, im }, i) => {
      const { min, max } = meta.layers[l.id], span = (max - min) || 1; // pixel 0 = min, 255 = max (shared/layers.md)
      app.map.setLayer(i, im, { domain: [(l.domain[0] - min) / span, (l.domain[1] - min) / span], stops: l.stops, widthM: meta.width * meta.metresPerPixel, heightM: meta.height * meta.metresPerPixel });
      app.layers.push(l);
      if (l.id === 'slope') { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); app.slope = { data: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height, min, max, mpp: meta.metresPerPixel }; }
    });
  }
  setUnit(); window.addEventListener('resize', setUnit);
  setRoute(doc, false); renderLayers(); renderAll();
  app.map.onDraw = (g, now) => {
    const moving = tickAstro(now); if (moving) renderMirror();
    const L = live();
    drawOverlay(g, app.map, { u: app.u, parking: app.terrain.parking, route: app.route, state: app.state, base: app.route.base, shelters: app.route.shelters, astro: app.astro, live: L, headingDeg: L.headingDeg, emergency: emergency(), mode: app.mode, draft: app.draft, draftDirty: app.draftDirty, focusStop: app.focusStop, name: name() }, now);
  };
  wireInput(); renderLog();
  log(`Route loaded: ${fmt(app.route.totals.timeMin)} min, ${app.route.stops.length} science stop${app.route.stops.length === 1 ? '' : 's'}.`);
  if (note) log(note.trim(), 'caution');
  startRelay();
  setInterval(tick, 500);
  routeView();
}
function setUnit() { app.u = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }
boot().catch((err) => {
  console.error(err);
  const f = $('fatal'); f.hidden = false;
  f.innerHTML = `<h1>The hub could not start</h1><p>${esc(err.message)}</p><p>Open the hub through the relay (<code>npm start</code> in <code>relay/</code>, then <code>/hub/</code>), not as a file. File locations are in <code>config.js</code>.</p>`;
});

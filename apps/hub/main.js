// Beacon Hub: relay connection and app setup for the control-centre screen.
// Contract field names live in route.js (waypoints, state) and relay.js (events); paths and layer styling in config.js.
import { CONFIG } from './config.js';
import { loadTerrain, flatTerrain } from './terrain.js';
import { readWaypoints, readState, readSite, emptyState } from './route.js';
import { connectRelay, events } from './relay.js';
import { localRelay } from './local.js';
import { createMap } from './map.js';
import { drawRing } from './ring.js';
import { drawOverlay } from './overlay.js';
import { CREW } from './crew-data.js';
import { buildWalks, weekStats, readiness, doseUnits, loadRecorded, saveRecorded, loadChoice, saveChoice } from './crew.js';
import { createVitals, ITEMS, GROUPS, worse } from './vitals.js';
import { makeWalkGrid, findPath } from './pathfind.js';
import { drawProfile, profileFromPoints, sampleLine } from './profile.js';
import { walkField, fieldImage } from './walkfield.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nn = (a, b) => (a != null ? a : b);
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '--' : (+n).toFixed(d));
const RAD = Math.PI / 180;
const fmt1 = (n) => (n == null ? '--' : n < 10 ? (+n).toFixed(1) : String(Math.round(n)));
const pct = (f) => (f == null ? '--' : String(Math.round(f * 100)));   // contracts carry fractions 0..1; the screen shows percent
const ugy = (v) => (v == null ? '--' : v < 10 ? (+v).toFixed(2) : v < 100 ? (+v).toFixed(1) : String(Math.round(v))); // microgray
const hm = (min) => { const m = Math.max(0, Math.round(min || 0)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const ICON = {
  ok: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic ok"><path d="M5 12l5 5L20 7"/></svg>',
  no: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic no"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5M12 18v.5"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  sound: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mute: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 5M22 9l-5 5"/></svg>',
  heart: '<svg aria-hidden="true" viewBox="0 0 24 24" class="ic"><path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/></svg>',
};

const app = {
  doc: null, route: null, terrain: null, map: null, state: emptyState(), gotState: false,
  link: null, relayStatus: 'connecting', relayUrl: '', clients: null, fake: { waypoints: false, layers: false, terrain: false },
  mode: 'plan', layers: [], layersOn: new Set(CONFIG.LAYERS_ON), slope: null,
  draft: [], draftDirty: false, placing: null, planNote: '', plan: null, routeId: null, pendingState: null, bounds: null, siteDoc: null,
  focusStop: null, follow: false, log: [], sound: true, emergencyAt: 0, resetArmed: 0, warned: {},
  astro: { x: 0, y: 0, seg: 0, anim: null, wA: null, wB: null, f: 0 }, listKey: '', listIdx: 0,
  crewId: null, crewSel: null, walks: [], recorded: [], rover: null, histSel: null, histAll: false, walk: null,
  vitals: createVitals(CONFIG.VITALS), vit: { levels: {}, overall: 'ok', marginLevel: 'ok' }, battLow: false, alarm: null,
  u: 16,
  briefing: null, stopNotes: {}, // data/out/briefing.json and photos per waypoint id from data/out/stops.json (shared/outputs.md)
};
window.hub = app; // handy in the browser console while integrating

// ---------- derived values ----------
const member = (id = app.crewId) => CREW.find((m) => m.id === id) || null;
const name = () => (member() || CONFIG.ASTRONAUT).name;
const suit = () => (member() || CONFIG.ASTRONAUT).suit;
const onWalk = (st = app.state) => st.wp > 0 || !!st.reroute;
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
    doseUgy: nn(s.doseUgy, w.doseUgy), doseRate: nn(s.doseRate, w.doseRate),
    sunlit: nn(s.sunlit, w.sun ? w.sun.visible : null), baseLink: nn(s.baseLink, w.base ? w.base.visible : null), earthLink: nn(s.earthLink, w.earth ? w.earth.visible : null),
    headingDeg: nn(s.headingDeg, w.headingDeg), shelterBearingDeg: nn(s.shelterBearingDeg, w.shelter ? w.shelter.az : null),
    shelterMin: nn(s.shelterMin, w.shelter ? w.shelter.min : null), shelter, atShelter: !!w.isShelter,
    baseMin: baseMinAt(w.x, w.y),
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
  if (s.wp === 0) return 'At the start, ready';
  if (i.at >= 0) return `At ${app.route.stops[i.at].name}`;
  if (L.atShelter) return 'In shelter';
  if (i.last) return `At ${w[w.length - 1].label || 'the end'}`;
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
let audio, alarmTimer = 0, alarmEnd = 0;
// One burst of beeps. Panic is higher and faster than storm so the two can be told apart by ear.
function beep(kind) {
  if (!app.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const panic = kind === 'panic', at = panic ? [0, 0.17, 0.34, 0.51] : [0, 0.28, 0.56];
    at.forEach((d) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = panic ? 1175 : 880; g.gain.value = 0.12; o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + (panic ? 0.11 : 0.16)); });
  } catch { /* sound is optional */ }
}
// The alarm repeats the burst for CONFIG.ALARM.seconds, or until the emergency ends or someone silences it.
// A storm alarm also stops once the astronaut is in shelter: there is nothing left to act on.
const stormSheltered = () => app.state.storm && !app.state.panic && live().atShelter;
function startAlarm(kind) {
  if (kind === 'storm' && stormSheltered()) return;
  clearInterval(alarmTimer); app.alarm = kind; alarmEnd = Date.now() + CONFIG.ALARM.seconds * 1000; beep(kind);
  alarmTimer = setInterval(() => { if (!emergency() || Date.now() >= alarmEnd || (app.alarm === 'storm' && stormSheltered())) stopAlarm(); else beep(kind); }, CONFIG.ALARM.everyMs);
}
function stopAlarm() { clearInterval(alarmTimer); alarmTimer = 0; if (app.alarm) { app.alarm = null; renderBanner(); } }
function warnOnce(key, text) { if (!app.warned[key]) { app.warned[key] = 1; log(text, 'caution'); } }

// ---------- incoming ----------
let routeSerial = 0;
// Walking time to the base from everywhere on the terrain (walkfield.js): the "Minutes to base" layer and the
// astronaut panel's "To base". Recomputed only when the base moves.
function buildBaseField() {
  const b = app.route && app.route.base, l = CONFIG.LAYERS.find((x) => x.id === 'minutesToBase');
  if (!app.walkGrid || !b || !l || !app.map) return;
  const key = `${Math.round(b.x)},${Math.round(b.y)}`; if (app.baseField && app.baseField.key === key) return;
  const t0 = performance.now(), P = app.planner || {};
  const F = walkField(app.walkGrid, b, { walkSpeed: P.walkSpeed || 0.8, maxSlopeDeg: P.maxSlopeDeg || 25 }); F.key = key;
  app.baseField = F;
  let slot = app.layers.findIndex((x) => x.id === l.id); if (slot < 0) { if (app.layers.length >= 7) return; slot = app.layers.length; app.layers.push(l); }
  l.index = slot; app.map.setLayer(slot, fieldImage(F, l.domain[1]), { domain: [0, 1], stops: l.stops, noData: 255 });
  console.info(`Minutes to base: ${Math.round(performance.now() - t0)} ms`);
}
const baseMinAt = (x, y) => (app.baseField && x != null ? app.baseField.at(x, y) : null);
function setRoute(doc, announce) {
  const route = readWaypoints(doc, CONFIG);
  if (!route.waypoints.length) throw new Error('The waypoint file has no "main" waypoints.');
  if (doc.version !== 1) warnOnce('wpv', `Waypoint file is version ${doc.version}; the hub was written for version 1.`);
  route.key = String(++routeSerial); app.doc = doc; app.route = route;
  resetDraft(); legCache.clear();
  if (announce) log(`Route loaded: ${fmt(route.totals.timeMin)} min, ${route.stops.length} science stop${route.stops.length === 1 ? '' : 's'}.`);
  if (announce && app.map) { buildBaseField(); renderLayers(); }
  app.focusStop = null; rebuildWalks(); syncAstro(true);
}
// A plan made by the relay replaced the route (state.plan.routeId, shared/state.md): fetch the route and the files
// that go with it (briefing, stop photos, minutes-to-shelter layer), then apply the state that announced it.
async function loadMission(raw) {
  app.pendingState = raw;
  try {
    setRoute(await getJSON(app.waypointsUrl), true);
    await loadRouteExtras();
    routeView();
  } catch (e) { toast('Could not load the new route: ' + e.message); }
  const latest = app.pendingState; app.pendingState = null; app.gotState = false;
  if (latest) onState(latest);
}
function onState(raw) {
  const rid = raw.plan ? raw.plan.routeId ?? null : app.routeId;
  if (app.session && rid !== app.routeId) { app.routeId = rid; notePlan(raw.plan); loadMission(raw); return; }
  if (app.pendingState) { app.pendingState = raw; return; }
  const p = app.state, first = !app.gotState; app.gotState = true;
  notePlan(raw.plan);
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
  const em = emergency(), newPanic = ns.panic && (first || !p.panic), newStorm = ns.storm && (first || !p.storm);
  if (em && (newPanic || newStorm)) startAlarm(newPanic ? 'panic' : 'storm');
  if (app.alarm === 'storm' && stormSheltered()) stopAlarm(); // reached shelter: silence straight away, not at the next beep
  if (em && !app.emergencyAt) { app.emergencyAt = Date.now(); app.mode = 'live'; frameEmergency(); }
  if (!em) { app.emergencyAt = 0; stopAlarm(); }
  trackWalk(ns);
  if ((ns.wp > 0 || ns.reroute) && app.mode === 'plan' && !app.draftDirty) app.mode = 'live';
  if (!first && p.wp === 0 && !p.reroute && (ns.wp > 0 || ns.reroute) && app.fake.waypoints && !app.fake.terrain && !app.terrain.flat && !em) routeView(); // the walk has started: show it
  syncAstro(first); renderAll();
}
// Logs each change of the relay's plan status once (running, done, error).
function notePlan(pl) {
  const was = app.plan; app.plan = pl || null;
  if (!pl || (was && was.id === pl.id && was.status === pl.status)) return;
  if (!was && pl.status !== 'running') return; // a status from before this page opened
  if (pl.status === 'running') log(pl.message || 'Planning…', 'sent');
  else if (pl.status === 'done') { log(pl.message || 'New route ready.'); app.planNote = ''; }
  else { log(pl.message || 'The planner failed.', 'caution'); toast(pl.message || 'The planner failed.'); }
}
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
  app.draft = [{ x: a.x, y: a.y, kind: 'start' }, ...app.route.stops.map((s) => ({ x: s.x, y: s.y, kind: 'stop', name: s.name, auto: /^Stop \d+$/.test(s.name) })), { x: b.x, y: b.y, kind: 'end' }];
  app.draftDirty = false; app.placing = null;
}
function renumber() { let n = 0; for (const p of app.draft) if (p.kind === 'stop') { n++; if (p.auto || !p.name) { p.name = `Stop ${n}`; p.auto = true; } } }
const inBounds = (p, b = app.bounds) => !b || (p.x >= b.xMin && p.x <= b.xMax && p.y >= b.yMin && p.y <= b.yMax);
const canPlan = () => !!app.link && app.link.kind === 'relay' && app.relayStatus === 'open';
function slopeAt(x, y) { // degrees: from the terrain when there is one, else from the slope layer
  if (app.terrain && !app.terrain.flat) return app.terrain.slopeAt(x, y);
  const s = app.slope; if (!s) return null;
  const c = Math.floor(x / s.mpp), r = Math.floor((s.h * s.mpp - y) / s.mpp); // cell containing the point (shared/conventions.md)
  if (c < 0 || r < 0 || c >= s.w || r >= s.h) return null;
  return s.min + s.data[(r * s.w + c) * 4] / 255 * (s.max - s.min);
}
function placeAt(w) {
  if (!inBounds(w)) return toast('Outside the planned area (dashed outline). The planner only has shelters and terrain inside it.');
  const sl = slopeAt(w.x, w.y);
  if (sl != null && sl > CONFIG.MAX_SLOPE_DEG) return toast(`Too steep for a suited astronaut: ${sl.toFixed(0)}° here, limit ${CONFIG.MAX_SLOPE_DEG}°.`);
  const p = { x: +w.x.toFixed(1), y: +w.y.toFixed(1) };
  if (app.placing === 'start') { app.draft[0] = { ...p, kind: 'start' }; app.placing = null; }
  else if (app.placing === 'end') { app.draft[app.draft.length - 1] = { ...p, kind: 'end' }; app.placing = null; }
  else { app.draft.splice(app.draft.length - 1, 0, { ...p, kind: 'stop', auto: true }); renumber(); }
  app.draftDirty = true; app.planNote = ''; renderAll();
}
function moveStop(i, d) {
  const j = i + d; if (app.draft[i].kind !== 'stop' || !app.draft[j] || app.draft[j].kind !== 'stop') return;
  [app.draft[i], app.draft[j]] = [app.draft[j], app.draft[i]]; renumber(); app.draftDirty = true; renderAll();
}
function sendPlan() {
  if (!canPlan()) return toast('Planning needs the relay. Start it with npm run demo.');
  if (app.plan && app.plan.status === 'running') return toast('The planner is still working on the last plan.');
  if (onWalk() && !confirm('A walk is in progress. The new route will start where the astronaut is now. Send it?')) return;
  const pts = app.draft.map(({ x, y, kind, name: n }) => ({ x, y, kind, ...(kind === 'stop' && n ? { name: n } : {}) }));
  const before = app.plan ? app.plan.id : null;
  if (!send(events.plan(pts), `Plan sent: ${pts.length - 2} science stop${pts.length === 3 ? '' : 's'}.`)) return;
  app.placing = null; app.planNote = ''; renderAll();
  // A relay older than the plan event ignores it and never answers in state.plan.
  setTimeout(() => {
    if ((app.plan ? app.plan.id : null) !== before) return;
    app.planNote = 'The relay did not answer. It may be an older version without planning: restart it (npm run demo).';
    log(app.planNote, 'caution'); renderAll();
  }, CONFIG.PLAN_TIMEOUT_MS);
}

// ---------- rendering ----------
// Draft legs follow the terrain (pathfind.js) instead of straight lines. Cached per leg, so this is cheap to call often.
const legCache = new Map();
function routeDraft() {
  app.draftPath = null; app.draftStats = null;
  if (!app.draftDirty || !app.walkGrid || app.draft.length < 2) return;
  const pts = [], st = { distanceM: 0, minutes: 0, maxSlopeDeg: 0, failed: 0 };
  for (let i = 1; i < app.draft.length; i++) {
    const a = app.draft[i - 1], b = app.draft[i], key = `${a.x},${a.y}>${b.x},${b.y}`;
    let r = legCache.get(key);
    if (!r) { r = findPath(app.walkGrid, { x: a.x, y: a.y }, { x: b.x, y: b.y }, { maxSlopeDeg: CONFIG.MAX_SLOPE_DEG }); legCache.set(key, r); if (!r.ok) toast(`No walkable path to ${b.kind === 'stop' ? b.name : b.kind}: ${r.reason}. Drawn straight.`); }
    pts.push(...(i > 1 ? r.pts.slice(1) : r.pts));
    st.distanceM += r.distanceM; st.minutes += r.minutes; st.maxSlopeDeg = Math.max(st.maxSlopeDeg, r.maxSlopeDeg); if (!r.ok) st.failed++;
  }
  app.draftPath = pts; app.draftStats = st;
}
function renderAll() { routeDraft(); app.profile = null; renderHeader(); renderBanner(); renderLeft(); renderRight(); renderCrew(); renderTimeline(); renderMirror(); renderReady(); renderProfile(); }
function renderHeader() {
  const L = live(), local = app.link && app.link.kind === 'local', up = app.relayStatus === 'open';
  document.body.classList.toggle('emergency', emergency());
  document.body.classList.toggle('placing', !!app.placing);
  document.body.classList.toggle('stale', !!app.link && !local && !up);
  for (const m of ['plan', 'live', 'crew']) document.body.classList.toggle(m, app.mode === m);
  $('clock').textContent = hm(L.elapsedMin);
  const mt = marsTime(L.elapsedMin); $('marsClock').hidden = !mt; $('marsTime').textContent = mt;
  $('modePlan').setAttribute('aria-pressed', app.mode === 'plan'); $('modeLive').setAttribute('aria-pressed', app.mode === 'live'); $('modeCrew').setAttribute('aria-pressed', app.mode === 'crew');
  const st = statusModel(); $('status').className = 'status ' + st.level; $('status').innerHTML = `${st.icon}<b>${esc(st.title)}</b>${st.text ? `<span>${esc(st.text)}</span>` : ''}`;
  const chip = (on, label) => `<span class="dev ${on ? 'on' : 'off'}">${on ? ICON.ok : ICON.no}${label}</span>`;
  const n = (role) => (app.clients || []).filter((c) => c.role === role).length;
  $('devices').innerHTML = local ? `<span class="dev local" title="Other devices will not follow. Planning needs the relay.">${ICON.info}Local mode</span>`
    : `<span title="${esc(app.relayUrl)}">${chip(up, up ? 'Relay' : 'Relay offline')}</span>` + (up && app.clients ? chip(n('headset') > 0, 'Headset') + chip(n('wrist') > 0, 'Wrist') + chip(n('esp') > 0, 'Button') : '');
  $('soundBtn').innerHTML = app.sound ? ICON.sound : ICON.mute; $('soundBtn').setAttribute('aria-pressed', app.sound); $('soundBtn').setAttribute('aria-label', app.sound ? 'Sound on' : 'Sound off');
  $('viewFollow').setAttribute('aria-pressed', app.follow);
  $('stormBtn').textContent = app.state.storm ? 'End storm' : 'Storm';
  const hint = $('mapHint'); hint.hidden = !app.placing;
  if (app.placing) hint.textContent = app.placing === 'stop' ? 'Click the map to add science stops · Esc when done' : `Click the map to set the ${app.placing}`;
}
// One line in the top bar for the normal state of each mode. Cautions and emergencies use the banner as well.
function statusModel() {
  const s = app.state, L = live();
  if (emergency()) return { level: 'caution', icon: ICON.warn, title: s.storm ? 'Solar storm' : 'Panic button', text: L.atShelter ? 'In shelter' : 'Going to shelter' };
  if (app.mode === 'plan') {
    if (app.plan && app.plan.status === 'running') return { level: 'info', icon: ICON.info, title: 'Planning', text: 'The engine is working out the route…' };
    return { level: 'info', icon: ICON.info, title: 'Plan', text: app.draftDirty ? 'Draft not sent yet' : `${app.route.stops.length} science stop${app.route.stops.length === 1 ? '' : 's'} · ${fmt(app.route.totals.timeMin)} min` };
  }
  if (app.mode === 'crew') return { level: 'info', icon: ICON.info, title: 'Crew', text: 'Readiness for the planned walk' };
  if (s.reroute) return { level: 'caution', icon: ICON.warn, title: 'Reroute', text: L.atShelter ? 'In shelter' : `${fmt1(L.shelterMin)} min to shelter` };
  if (s.mode === 'warning') return { level: 'caution', icon: ICON.warn, title: 'Warning', text: L.baseLink === false ? 'No line of sight to base' : `${fmt1(L.shelterMin)} min from shelter` };
  const si = stopInfo(), nx = si.next >= 0 ? app.route.stops[si.next] : null;
  return { level: 'ok', icon: ICON.ok, title: 'Nominal', text: `${doing()}${nx && si.at < 0 && nx.etaMin != null && onWalk() ? ` · ${fmt(Math.max(0, nx.etaMin - L.elapsedMin))} min` : ''}` };
}
function bannerModel() {
  const s = app.state, L = live(), local = app.link && app.link.kind === 'local';
  if (emergency()) {
    return { level: 'emergency', icon: ICON.warn,
      html: `<b>${s.storm ? 'SOLAR STORM' : 'PANIC BUTTON'}</b><span class="act">${L.atShelter ? 'In shelter' : `Go to shelter · ${fmt1(L.shelterMin)} min away`}</span><span class="sub">${s.storm && s.panic ? 'Panic button also pressed. ' : s.panic ? `Pressed by ${esc(name())}. Reset clears it. ` : ''}<span id="emTimer"></span></span>`,
      actions: [...(app.alarm && app.sound ? [['silence', 'Silence alarm']] : []), ...(s.storm ? [['endstorm', 'End storm']] : [])] };
  }
  if (app.link && !local && app.relayStatus !== 'open') return { level: 'caution', icon: ICON.warn, html: `<b>Relay offline</b><span class="sub">Reconnecting to ${esc(app.relayUrl)}. Values on screen may be out of date.</span>`, actions: [['local', 'Run locally without the relay']] };
  if (app.vit.marginLevel && app.vit.marginLevel !== 'ok' && onWalk()) { const vp = vitalsProblem(); return { level: 'caution', icon: ICON.warn, html: `<b>${esc(vp.title.toUpperCase())}</b><span class="sub">${esc(name())}: ${esc(vp.text)}</span>`, actions: [['vitals', 'Astronaut status']] }; }
  if (s.rerouteRequested) return { level: 'caution', icon: ICON.warn, html: `<b>${esc(name())} requested a reroute</b><span class="sub">${L.atShelter ? 'Now in shelter.' : `Heading to shelter · ${fmt1(L.shelterMin)} min away.`} Reset returns to the main route.</span>`, actions: [] };
  const vp = vitalsProblem();
  if (vp && onWalk()) return { level: 'caution', icon: ICON.warn, html: `<b>${vp.level === 'alarm' ? esc(vp.title.toUpperCase()) : esc(vp.title)}</b><span class="sub">${esc(name())}: ${esc(vp.text)}</span>`, actions: [['vitals', 'Astronaut status']] };
  return null; // nothing to warn about: the status line in the top bar says how things are
}
function renderBanner() {
  const m = bannerModel(), b = $('banner');
  b.hidden = !m;
  if (m) {
    b.className = 'banner ' + m.level; $('bannerIcon').innerHTML = m.icon; $('bannerText').innerHTML = m.html;
    $('bannerActions').innerHTML = m.actions.map(([act, label, cls]) => `<button type="button" data-act="${act}" class="${cls || ''}">${esc(label)}</button>`).join('');
  }
  tick();
}
function tick() {
  const el = $('emTimer'); if (el && app.emergencyAt) { const s = Math.floor((Date.now() - app.emergencyAt) / 1000); el.textContent = `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
}
function renderLayers() {
  const card = $('layersPanel');
  card.innerHTML = `<h2>Map layers <span class="hint">keys 1 to ${app.layers.length || 6}</span></h2><div class="layerGrid">`
    + (app.layers.length ? '' : '<p class="note">No layers yet. They appear when the engine exports data/out/layers/.</p>') + app.layers.map((l, i) => {
    const grad = l.stops.map((c, k) => `rgba(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')},${c[3]}) ${k * 50}%`).join(', ');
    return `<div class="layer" data-id="${l.id}" title="${esc(l.source)}${l.blank ? `. ${esc(l.blank)}.` : ''}"><label><input type="checkbox" data-layer="${i}"><span>${esc(l.label)}</span><kbd>${i + 1}</kbd></label>
      <div class="legend"><span>${esc(l.lo)}</span><i style="background: linear-gradient(to right, ${grad}), #a56b45"></i><span>${esc(l.hi)}</span></div></div>`;
  }).join('') + '</div>';
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
  renderPlan(); renderRoute(); renderBrief();
}
function renderPlan() {
  const st = app.draftStats, running = app.plan && app.plan.status === 'running', relay = canPlan();
  const label = (p) => (p.kind === 'stop' ? esc(p.name) : p.kind === 'start' ? 'Start' : 'End');
  let n = 0;
  const rows = app.draft.map((p, i) => {
    const num = p.kind === 'stop' ? ++n : p.kind === 'start' ? 'S' : 'E', out = !inBounds(p);
    const ctl = p.kind === 'stop' ? `<span class="stopNav"><button type="button" class="x" data-act="up" data-i="${i}" aria-label="Move ${esc(p.name)} earlier" ${app.draft[i - 1].kind !== 'stop' ? 'disabled' : ''}>↑</button><button type="button" class="x" data-act="del" data-i="${i}" aria-label="Remove ${esc(p.name)}">✕</button></span>` : '<span></span>';
    return `<li class="${p.kind}"><span class="dot">${num}</span><span class="nm">${label(p)}<small class="mono">${fmt(p.x)}, ${fmt(p.y)}${out ? ' · outside the planned area' : ''}</small></span>${ctl}</li>`;
  }).join('');
  const state = running ? `<div class="planState running"><span class="spin" aria-hidden="true"></span><span>${esc(app.plan.message || 'Planning…')} The engine finds shelters and a path around the terrain.</span></div>`
    : app.plan && app.plan.status === 'error' && !app.draftDirty ? `<div class="planState error">${ICON.warn}<span>${esc(app.plan.message)}</span></div>`
    : app.plan && app.plan.status === 'done' && !app.draftDirty ? `<div class="planState done">${ICON.ok}<span>${esc(app.plan.message)}</span></div>` : '';
  const why = !relay ? (app.link && app.link.kind === 'local' ? 'Planning needs the relay (npm run demo). The dashed line is only the hub’s estimate.' : 'Waiting for the relay…') : !app.draftDirty ? 'Change the stops to plan a new route.' : '';
  $('planPanel').innerHTML = `<h2>Plan the walk <span class="hint">${app.draft.length - 2} stop${app.draft.length === 3 ? '' : 's'}</span></h2>
    <div class="tools"><button type="button" data-act="place-start" aria-pressed="${app.placing === 'start'}">Start</button><button type="button" data-act="place-stop" aria-pressed="${app.placing === 'stop'}">+ Stops</button><button type="button" data-act="place-end" aria-pressed="${app.placing === 'end'}">End</button></div>
    <ol class="pts">${rows}</ol>
    ${app.draftDirty && st ? `<div class="pstat"><div><span class="lbl">Distance</span><b>${km(st.distanceM)}</b></div><div><span class="lbl">Walking</span><b>${fmt(st.minutes)} min</b></div><div><span class="lbl">Steepest</span><b class="${st.maxSlopeDeg > CONFIG.MAX_SLOPE_DEG ? 'over' : ''}">${fmt(st.maxSlopeDeg)}°</b></div></div>
      ${st.failed ? `<p class="note">${ICON.warn} ${st.failed} leg${st.failed === 1 ? ' has' : 's have'} no walkable path and ${st.failed === 1 ? 'is' : 'are'} drawn straight.</p>` : ''}` : ''}
    <div class="tools"><button type="button" class="primary" data-act="send-plan" ${!relay || running || !app.draftDirty ? 'disabled' : ''}>${running ? 'Planning…' : 'Plan this route'}</button><button type="button" data-act="undo-plan" ${app.draftDirty ? '' : 'disabled'}>Discard</button></div>
    ${state}${why || app.planNote ? `<p class="note">${esc(app.planNote || why)}</p>` : ''}`;
}
function renderRoute() {
  const r = app.route, s = app.state, si = stopInfo(), t = r.totals, w = r.waypoints, first = w[0], last = w[w.length - 1];
  const row = (cls, n, label, eta, status, i) => `<li class="${cls}" ${i != null ? `data-act="focus" data-i="${i}" tabindex="0"` : ''}><span class="n">${n}</span><span class="nm">${esc(label)}</span><span class="eta mono">${eta}</span><span class="st">${status}</span></li>`;
  const stops = r.stops.map((st, i) => {
    const done = s.wp > st.wp || (si.rr && s.wp === st.wp), at = si.at === i, next = si.next === i && si.at < 0 && !si.rr;
    return row(`${done ? 'done' : ''} ${at ? 'now' : ''} ${next ? 'next' : ''} ${app.focusStop === i ? 'focus' : ''}`, st.num, st.name, clockAt(st.etaMin), done ? 'Done' : at ? 'Here' : next ? 'Next' : si.rr ? 'On hold' : '', i);
  }).join('');
  const atEnd = si.last && s.wp > 0 && !si.rr;
  $('routePanel').innerHTML = `<h2>Route</h2>
    <div class="totals"><div><span class="lbl">Walk</span><b>${fmt(t.timeMin)} min</b></div><div><span class="lbl">Distance</span><b>${km(t.distanceM)}</b></div><div><span class="lbl">Dose</span><b>${t.doseUgy != null ? ugy(t.doseUgy) + ' µGy' : pct(t.dose) + '%'}</b></div></div>
    <ol class="stops">${row(s.wp > 0 || si.rr ? 'done' : 'now', 'S', first.label || 'Start', clockAt(first.t), s.wp > 0 || si.rr ? 'Done' : 'Here')}${stops}${last.isScienceStop ? '' : row(atEnd ? 'now' : '', 'E', last.label || 'End', clockAt(last.t), atEnd ? 'Here' : si.rr ? 'On hold' : '')}</ol>`;
}
function renderBrief() {
  const t = app.route.totals, over = t.maxSlopeDeg > CONFIG.MAX_SLOPE_DEG;
  $('briefPanel').innerHTML = `<h2>Current route <span class="hint">${app.draftDirty ? 'draft not sent' : ''}</span></h2><dl>
    <div><dt>Walk time</dt><dd>${fmt(t.timeMin)} min</dd></div>
    <div><dt>Distance</dt><dd>${km(t.distanceM)}</dd></div>
    <div><dt>Oxygen used</dt><dd>${pct(t.oxygenUsed)}% of supply</dd></div>
    <div><dt>Radiation dose</dt><dd>${t.doseUgy != null ? `${ugy(t.doseUgy)} µGy` : `${pct(t.dose)}% of budget`}</dd></div>
    ${t.stormDoseUgy != null ? `<div><dt>If a solar storm hits</dt><dd>up to ${ugy(t.stormDoseUgy)} µGy</dd></div>` : ''}
    <div><dt>Worst case to shelter</dt><dd>${fmt1(t.worstShelterMin)} min</dd></div>
    <div><dt>Steepest leg</dt><dd class="${over ? 'over' : ''}">${over ? ICON.warn + ' ' : ''}${fmt(t.maxSlopeDeg)}° / ${CONFIG.MAX_SLOPE_DEG}°</dd></div>
    <div><dt>Shelters</dt><dd>${app.route.shelters.length}</dd></div>${briefExtra()}</dl>`;
}
function briefExtra() {
  const b = app.briefing; if (!b) return '';
  const sw = b.spaceWeather, wr = b.latestWeatherReport || b.conditions, out = [];
  if (sw) {
    const n = sw.nearest, when = n ? `${n.isGlancingBlow ? 'glancing, ' : ''}${Math.abs(n.hoursFromSkyTime).toFixed(0)} h ${n.hoursFromSkyTime < 0 ? 'before' : 'after'} the walk` : '';
    out.push(`<div><dt>Space weather</dt><dd title="Coronal mass ejections forecast to reach Mars${when ? ': ' + esc(when) : ''}. ${esc(sw.source || '')}">${sw.marsArrivals ? `${sw.marsArrivals} CME${sw.marsArrivals === 1 ? '' : 's'} near walk` : 'No CMEs forecast'}</dd></div>`);
  }
  if (wr) {
    const age = wr.ageDays ?? wr.daysBeforeSkyTime;
    out.push(`<div><dt>Weather</dt><dd title="Curiosity REMS, sol ${esc(wr.sol)}, ${fmt(wr.pressurePa)} Pa, ${esc(wr.opacity || '')}${age != null ? `, ${fmt(age)} days old` : ''}. ${esc(wr.disclaimer || '')}">${fmt(wr.minAirTempC)} to ${fmt(wr.maxAirTempC)} °C</dd></div>`);
  }
  return out.join('');
}
// Who is assigned to the walk and whether they are fit for it. Opens the Crew screen.
function briefCrew() {
  const m = member(); if (!m) return '';
  const v = verdictFor(m);
  return `<div class="assignRow" data-act="open-crew" tabindex="0" title="${esc(v.reasons[0])}. Open the crew screen (C)"><span class="cname">${esc(m.name)}</span><span class="suit">${esc(m.suit)}</span><span class="verdict ${v.level}">${VICON[v.level]}${WORD[v.level]}</span></div>`;
}
function renderRight() {
  const L = live(), s = app.state, si = stopInfo(), em = emergency();
  const tk = (v, yes, no) => (v == null ? '' : `<span class="tk ${v ? 'yes' : 'nope'}">${v ? ICON.ok : ICON.no}${v ? yes : no}</span>`);
  const num = (label, val, unit, cls = '') => `<div class="num ${cls}"><span class="lbl">${label}</span><span class="val mono">${val}<small>${unit}</small></span></div>`;
  $('astroPanel').innerHTML = `<div class="who"><span class="name">${esc(name())}</span><span class="suit">${esc(suit())}</span><span class="doing">${esc(doing())}</span></div>
    <div class="nums">${num('To shelter', fmt1(L.shelterMin), 'min', em ? 'hot' : '')}${num('To base', L.baseMin == null ? '--' : fmt1(L.baseMin), 'min')}${num('Oxygen left', pct(L.oxygen), '%')}${L.doseUgy != null ? num('Dose so far', ugy(L.doseUgy), 'µGy') : num('Dose so far', pct(L.dose), '% of budget')}${L.doseRate != null ? num('Dose rate', fmt1(L.doseRate), 'µGy/h', L.doseRate > CONFIG.VITALS.doseRateHigh ? 'hot' : '') : num('Open sky', pct(L.openSky), '%')}</div>
    <div class="ticks">${tk(L.baseLink, 'Base link', 'No base link')}${tk(L.earthLink, 'Earth link', 'No Earth link')}${tk(L.sunlit, 'Sunlit', 'In shadow')}${s.earthDelayMin != null ? `<span class="tk mutedtxt">Earth delay ${fmt(s.earthDelayMin)} min</span>` : ''}</div>
    <div id="vitals" class="vsum" data-act="vitals" role="button" tabindex="0" title="Astronaut status (V)"></div>`;
  renderVitals();
  const stops = app.route.stops, i = app.focusStop != null ? app.focusStop : app.mode === 'plan' ? 0 : si.at >= 0 ? si.at : si.next, st = i >= 0 ? stops[i] : null;
  if (!st) $('stopPanel').innerHTML = `<h2>Science stop</h2><p class="note">${stops.length ? 'All science stops visited.' : 'No science stops on this route. Add them in Plan.'}</p>`;
  else {
    const done = s.wp > st.wp || (si.rr && s.wp === st.wp), at = si.at === i, eta = st.etaMin != null ? Math.max(0, st.etaMin - L.elapsedMin) : null, note = CONFIG.STOP_NOTES[st.id] || app.stopNotes[st.id] || {};
    const head = app.mode === 'plan' ? `Science stop ${st.num} of ${stops.length} · ${fmt(st.etaMin)} min in` : at ? 'Science stop · here now' : done ? 'Science stop · done' : si.rr ? 'Science stop · on hold' : `Science stop · in ${fmt(eta)} min`;
    const nav = stops.length > 1 ? `<span class="stopNav"><button type="button" data-act="stop-prev" aria-label="Previous stop">‹</button><button type="button" data-act="stop-next" aria-label="Next stop">›</button></span>` : '';
    $('stopPanel').innerHTML = `<h2><span>${head}</span>${nav}</h2>
      <div class="stop">${note.photo ? `<img src="${esc(note.photo)}" alt="View on arrival at ${esc(st.name)}">` : '<div class="nophoto">No arrival photo</div>'}
      <div><div class="sname">${esc(st.name)}</div><p>${esc(note.task || 'No science task written for this stop yet.')}</p>${note.credit ? `<p class="credit">${esc(note.credit)}</p>` : ''}</div></div>`;
  }
  $('mirrorTitle').textContent = `What ${name()} sees`;
}
function stepStop(d) {
  const n = app.route.stops.length; if (!n) return;
  const si = stopInfo(), cur = app.focusStop != null ? app.focusStop : app.mode === 'plan' ? 0 : Math.max(0, si.at >= 0 ? si.at : si.next);
  focusStop((cur + d + n) % n, true);
}
// ---------- astronaut status: body, life support, exposure, wristband ----------
function effort() { // 0 to 1 from the slope of the leg being walked
  const a = activeList(), w = a.list[a.idx], n = a.list[a.idx + 1]; if (!w || !n || w.z == null || n.z == null) return 0;
  const d = Math.hypot(n.x - w.x, n.y - w.y); return d > 0.5 ? Math.min(1, Math.atan(Math.abs(n.z - w.z) / d) / RAD / 20) : 0;
}
const VC = CONFIG.VITALS, LVL_ICON = { ok: ICON.ok, caution: ICON.warn, alarm: ICON.warn };
const itemByKey = Object.fromEntries(ITEMS.map((it) => [it.key, it]));
function vval(it, x) {
  if (x == null) return '--';
  if (it.bool) return x ? it.bool[0] : it.bool[1];
  return it.pct ? fmt(x * 100, it.d) : fmt(x, it.d);
}
const dur = (min) => (min == null ? '--' : !isFinite(min) ? '∞' : min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.max(0, Math.round(min))} min`);
// The most important problem in words, or null when everything is normal.
function vitalsProblem(r = app.vit) {
  if (!r || !r.v) return null;
  if (r.marginLevel !== 'ok' && onWalk()) return { level: r.marginLevel, key: 'margin', title: r.margin < 0 ? 'Not enough supply to reach shelter' : 'Turn back now',
    text: `${r.scarce.label} lasts ${dur(r.scarce.min)} at this effort; shelter is ${dur(r.toSafety)} away.` };
  let best = null;
  for (const it of ITEMS) { const l = r.levels[it.key]; if (l !== 'ok' && (!best || (l === 'alarm' && best.level !== 'alarm'))) best = { level: l, key: it.key, it }; }
  if (!best) return null;
  const it = best.it, x = r.v[it.key];
  return { ...best, title: it.key === 'linkAge' ? 'Wristband not updating' : `${it.label} ${it.supply || it.key === 'battery' || it.key === 'spo2' ? 'low' : 'high'}`,
    text: `${vval(it, x)} ${it.unit}. ${it.limit(VC)}.${it.group === 'body' && live().baseMin != null ? ` Base (medical) is ${fmt1(live().baseMin)} min walk away.` : ''}` };
}
function tickVitals() {
  const L = live(), s = app.state, walking = onWalk() && !L.atShelter && !stopInfo().last;
  const prev = app.vit, r = app.vit = app.vitals.step(
    { heartRate: s.heartRate, battery: s.wristBattery, spo2: s.spo2, skinTemp: s.skinTemp },
    { walking, effort: effort(), emergency: emergency(), sunlit: L.sunlit, shelterMin: L.shelterMin, oxygen: L.oxygen, dose: L.dose, doseRate: L.doseRate, openSky: L.openSky });
  const W = app.walk, v = r.v;
  if (W && v.hr != null) { W.hrSum += v.hr; W.hrN++; W.hrPeak = Math.max(W.hrPeak, v.hr); }
  if (W && v.spo2 != null) W.spo2Min = Math.min(W.spo2Min ?? 1, v.spo2);
  if (W && r.margin != null && isFinite(r.margin)) W.marginMin = Math.min(W.marginMin ?? Infinity, r.margin);
  // log each value the first time it leaves normal, and again if it gets worse
  for (const it of ITEMS) { const was = (prev && prev.levels && prev.levels[it.key]) || 'ok', now = r.levels[it.key]; if (now !== 'ok' && now !== was && worse(was, now) === now) log(`${it.label} ${now === 'alarm' ? 'ALARM' : 'caution'}: ${vval(it, v[it.key])} ${it.unit}.`, now === 'alarm' ? 'emergency' : 'caution'); }
  const pm = (prev && prev.marginLevel) || 'ok';
  if (r.marginLevel !== 'ok' && r.marginLevel !== pm && onWalk()) log(`Turn back: ${r.scarce.label.toLowerCase()} lasts ${dur(r.scarce.min)}, shelter is ${dur(r.toSafety)} away.`, r.marginLevel === 'alarm' ? 'emergency' : 'caution');
  app.battLow = r.levels.battery !== 'ok';
  const problemKey = (p) => (p ? p.key + p.level : '');
  const changed = !prev || !prev.v || prev.overall !== r.overall || problemKey(vitalsProblem(prev)) !== problemKey(vitalsProblem(r));
  renderVitals(); renderVitalsDrawer(); if (changed) { renderBanner(); renderCrew(); }
}
function spark(key, it, cls = 'spark') {
  const h = app.vitals.hist[key] || [], [lo, hi] = it.range || [0, 1], n = Math.max(1, VC.historySeconds - 1), y = (b) => (30 - (Math.max(lo, Math.min(hi, b)) - lo) / (hi - lo) * 30).toFixed(1);
  const lim = it.line ? `<line x1="0" x2="100" y1="${y(it.line(VC))}" y2="${y(it.line(VC))}" class="limit"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">${lim}<polyline points="${h.map((b, i) => `${(i / n * 100).toFixed(1)},${y(b)}`).join(' ')}"/></svg>`;
}
// Summary card in the astronaut panel: the worst problem, four key numbers and the wrist link. Click for detail.
function renderVitals() {
  const el = $('vitals'); if (!el) return;
  const r = app.vit, v = r.v || {}, sim = r.sim || {}, p = vitalsProblem(r), lv = r.overall || 'ok', star = (k) => (sim[k] ? '<sup>*</sup>' : '');
  const cell = (k, label, val, unit) => `<div class="vc ${r.levels && r.levels[k] !== 'ok' ? r.levels[k] : ''}"><span class="lbl">${label}</span><span class="mono">${val}${star(k)}<small>${unit}</small></span></div>`;
  const anySim = Object.values(sim).some(Boolean), wrist = v.battery == null ? 'Wrist: no data' : `Wrist ${pct(v.battery)}%${v.linkAge != null ? ` · ${v.linkAge < 3 ? 'live' : fmt(v.linkAge) + ' s ago'}` : ''}`;
  el.className = 'vsum ' + lv;
  el.innerHTML = `<div class="vs-head">${LVL_ICON[lv]}<b>${p ? esc(p.title) : 'All readings normal'}</b><span class="vs-more">Details <kbd>V</kbd></span></div>
    <div class="vs-row">${cell('hr', 'Heart', fmt(v.hr), 'bpm')}${cell('spo2', 'SpO2', pct(v.spo2), '%')}${cell('skinTemp', 'Skin', fmt(v.skinTemp, 1), '°C')}
      <div class="vc ${r.marginLevel !== 'ok' ? r.marginLevel : ''}" title="Scarcest supply minus time to shelter"><span class="lbl">Margin</span><span class="mono">${r.margin == null ? '--' : !isFinite(r.margin) ? '∞' : r.margin >= 60 ? (r.margin / 60).toFixed(1) + '<small>h</small>' : Math.max(0, Math.round(r.margin)) + '<small>min</small>'}</span></div></div>
    <div class="vs-foot"><span>${esc(wrist)}</span>${anySim ? '<span class="simnote">* simulated</span>' : ''}</div>`;
}
// Detail drawer over the map: safety margin and every tracked value by group.
function renderVitalsDrawer() {
  const el = $('vitalsDrawer'); if (!el || el.hidden) return;
  const r = app.vit, v = r.v || {}, sim = r.sim || {}, p = vitalsProblem(r);
  const src = (it) => it.group === 'exposure' || it.key === 'oxygen' ? ['engine', 'Engine'] : it.group === 'life' || it.key === 'metW' ? ['model', 'Modelled'] : sim[it.key] ? ['sim', 'Simulated'] : ['wrist', 'Wrist'];
  const span = Math.max(30, ...((r.left || []).map((s) => (isFinite(s.min) ? s.min : 0))), r.toSafety * 1.5);
  const supplies = (r.left || []).map((s) => {
    const w = isFinite(s.min) ? Math.min(100, s.min / span * 100) : 100, short = s.min - r.toSafety < VC.turnBackMin;
    return `<li class="${short ? 'short' : ''}"><span>${esc(s.label)}</span><div class="sbar"><i style="width:${w}%"></i><b style="left:${Math.min(100, r.toSafety / span * 100)}%"></b></div><span class="mono">${dur(s.min)}</span></li>`;
  }).join('');
  const groups = GROUPS.map((g) => `<section class="vg"><h3>${g.label}</h3>${ITEMS.filter((it) => it.group === g.id).map((it) => {
    const x = v[it.key], l = r.levels ? r.levels[it.key] : 'ok', [sc, sl] = src(it);
    return `<div class="vi ${l}"><div class="vi-l"><span class="vi-name">${l !== 'ok' ? LVL_ICON[l] : ''}${esc(it.label)}</span><span class="vi-lim">${esc(it.note ? it.note + '. ' : '')}${esc(it.limit(VC))}</span></div>
      <span class="vi-v mono">${vval(it, x)}<small>${x == null || it.bool ? '' : esc(it.unit)}</small></span>${it.bool ? '<span></span>' : spark(it.key, it)}<span class="src ${sc}">${sl}</span></div>`;
  }).join('')}</section>`).join('');
  el.innerHTML = `<header><div><h2>Astronaut status</h2><div class="dname">${esc(name())} <span class="suit">${esc(suit())}</span></div></div><button type="button" data-act="vitals" aria-label="Close">Close <kbd>V</kbd></button></header>
    <div class="vbox ${r.marginLevel === 'ok' ? 'fit' : r.marginLevel === 'alarm' ? 'no' : 'marginal'}"><b>${r.marginLevel === 'ok' ? ICON.ok : ICON.warn}${r.margin == null ? 'Safety margin' : r.marginLevel === 'ok' ? `Safety margin ${dur(r.margin)}` : p && p.key === 'margin' ? esc(p.title) : 'Safety margin ' + dur(r.margin)}</b>
      <span class="planned">How long each supply lasts at the current effort. The white mark is the ${dur(r.toSafety)} walk to shelter. Turn back below ${VC.turnBackMin} min spare.</span>
      <ul class="supplies">${supplies}</ul></div>
    ${p && p.key !== 'margin' ? `<p class="dprob ${p.level}">${ICON.warn}<b>${esc(p.title)}.</b> ${esc(p.text)}</p>` : ''}
    <div class="vgrid">${groups}</div>
    <div class="tools small"><button type="button" data-act="leak" aria-pressed="${r.leak ? 'true' : 'false'}">${r.leak ? 'Fix cooling leak' : 'Simulate cooling leak'} <kbd>L</kbd></button></div>
    <p class="note">Wrist: heart rate, SpO2, skin temperature, battery. Engine: oxygen, dose, open sky, sunlight. Modelled: suit supplies and metabolic rate, driven by heart rate. Limits are demo assumptions (config.js).</p>`;
}
function toggleVitalsDrawer(force) { const el = $('vitalsDrawer'), open = force ?? el.hidden; el.hidden = !open; if (open) renderVitalsDrawer(); }
function toggleLeak() { app.vitals.setLeak(!app.vitals.leak); log(app.vitals.leak ? 'Simulated cooling leak started.' : 'Simulated cooling leak fixed.', app.vitals.leak ? 'caution' : ''); if (app.vitals.leak) toggleVitalsDrawer(true); tickVitals(); }

// ---------- crew readiness and route history ----------
const WORD = { fit: 'Fit', marginal: 'Marginal', no: 'Not fit' }, VICON = { fit: ICON.ok, marginal: ICON.warn, no: ICON.no };
const COND = { fit: 'Fit', fatigued: 'Fatigued', injured: 'Injured', ill: 'Ill' };
const km = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : fmt(m) + ' m');
const ago = (at) => { const h = (Date.now() - at) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} sol${Math.round(h / 24) === 1 ? '' : 's'} ago`; };
function rebuildWalks() { if (app.route) app.walks = buildWalks(CREW, app.route, app.recorded, app.rover, Date.now()); }
// Weekly dose limit in the route's units: microgray with the base's background dose, or walk budgets.
function doseLimits() {
  const c = CONFIG.CREW_LIMITS;
  return doseUnits(app.route) === 'uGy'
    ? { ...c, units: 'uGy', weeklyDose: c.weeklyDoseMicroGray, background: c.habitatMicroGrayPerDay * 7 }
    : { ...c, units: 'budget', background: 0 };
}
function verdictFor(m) {
  const t = app.route.totals, st = weekStats(app.walks, m.id, Date.now()), lim = doseLimits(), u = lim.units === 'uGy';
  const plan = { minutes: t.timeMin, dose: u ? t.doseUgy : t.dose, stormDose: u ? t.stormDoseUgy : null };
  return { st, lim, ...readiness(m, st, plan, lim, Date.now(), { batteryLow: m.id === app.crewId && app.battLow }) };
}
function historyList() { return app.walks.filter((k) => app.histAll || k.kind === 'rover' || k.who === app.crewSel); }
// What the map draws: every listed walk faintly while the Crew screen is open, and the picked walk in any mode.
function historyForMap() {
  const list = app.mode === 'crew' ? historyList() : app.walks.filter((k) => k.id === app.histSel);
  return list.map((k) => ({ pts: k.pts, kind: k.kind, marks: k.marks, sel: k.id === app.histSel, title: k.who ? (member(k.who) || {}).suit || '' : '' }));
}
function renderCrew() {
  if (!$('crewPanel')) return;
  if (!CREW.length) { $('crewPanel').innerHTML = '<h2>Crew readiness</h2><p class="note">No crew listed. Add people in crew-data.js.</p>'; $('profilePanel').innerHTML = ''; $('historyPanel').innerHTML = ''; return; }
  const L = CONFIG.CREW_LIMITS, bar = (now, after) => `<div class="meter ${after > 1 ? 'over' : after > L.marginalAt ? 'near' : ''}"><i style="width:${Math.min(100, now * 100)}%"></i><b style="left:${Math.min(100, now * 100)}%;width:${Math.max(0, Math.min(100, after * 100) - Math.min(100, now * 100))}%"></b></div>`;
  $('crewPanel').innerHTML = `<h2>Crew readiness <span class="hint">for the planned walk</span></h2><ul class="crew">${CREW.map((m) => {
    const v = verdictFor(m);
    return `<li class="${m.id === app.crewSel ? 'sel' : ''}" data-act="crew" data-id="${esc(m.id)}" tabindex="0">
      <div class="c1"><span class="cname">${esc(m.name)}</span><span class="suit">${esc(m.suit)}</span>${m.id === app.crewId ? '<span class="assigned">On this walk</span>' : ''}</div>
      <div class="c2"><span class="verdict ${v.level}">${VICON[v.level]}${WORD[v.level]}</span><span class="why">${esc(v.reasons[0])}</span></div></li>`;
  }).join('')}</ul><p class="note">Sample crew. Walk figures come from the engine's route.</p>`;

  const m = member(app.crewSel) || CREW[0], v = verdictFor(m), st = v.st, t = app.route.totals, assigned = m.id === app.crewId;
  $('profilePanel').innerHTML = `<div class="who"><span class="name">${esc(m.name)}</span><span class="suit">${esc(m.suit)}</span><span class="doing">${esc(m.role || '')}</span></div>
    <div class="vbox ${v.level}"><b>${VICON[v.level]}${WORD[v.level]} for this walk</b><span class="planned">${fmt(t.timeMin)} min · ${km(t.distanceM)} · dose ${pct(t.dose)}%</span><ul>${v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
    <p class="cond"><b>Condition: ${COND[m.condition] || esc(m.condition)}.</b> ${esc(m.note || '')}</p>
    <dl class="pstats">
      <div><dt>Walks this week</dt><dd>${st.walks}</dd></div>
      <div><dt>Last walk</dt><dd>${st.lastAt != null ? ago(st.lastAt) : 'None logged'}</dd></div>
      <div><dt>Walk time this week</dt><dd>${hm(st.minutes)} h</dd></div>
      <div><dt>Distance this week</dt><dd>${km(st.distanceM)}</dd></div></dl>
    <div class="lim"><span class="lbl">Weekly dose</span><span class="mono">${v.lim.units === 'uGy'
      ? `${ugy(v.doseNow * v.lim.weeklyDose)} of ${fmt(v.lim.weeklyDose)} µGy now · ${ugy(v.doseAfter * v.lim.weeklyDose)} after${v.doseStorm != null ? ` · ${ugy(v.doseStorm * v.lim.weeklyDose)} if a storm hits` : ''}`
      : `${pct(v.doseNow)}% now · ${pct(v.doseAfter)}% after this walk`}</span>${bar(v.doseNow, v.doseAfter)}</div>
    ${v.lim.units === 'uGy' ? `<p class="note">Includes ${fmt(v.lim.background)} µGy of background in the base this week (${v.lim.habitatMicroGrayPerDay} µGy a day).</p>` : ''}
    <div class="lim"><span class="lbl">Weekly walk time</span><span class="mono">${fmt(st.minutes)} of ${L.weeklyWalkMin} min · ${fmt(st.minutes + (t.timeMin || 0))} after</span>${bar(v.timeNow, v.timeAfter)}</div>
    <div class="tools"><button type="button" class="${assigned ? '' : 'primary'}" data-act="assign" ${assigned || onWalk() ? 'disabled' : ''}>${assigned ? 'Assigned to this walk' : onWalk() ? 'Walk in progress' : `Assign ${esc(m.name.split(' ')[0])} to this walk`}</button></div>`;

  const list = historyList(), first = esc(m.name.split(' ')[0]), sel = app.walks.find((k) => k.id === app.histSel);
  const tag = { sample: ['Sample log', 'Who walked and when is sample data. Path, distance, time and dose come from the engine route.'], recorded: ['Recorded', 'Recorded by this hub during a walk.'], rover: ['Real rover track', 'Curiosity positions from NASA MSL waypoints.'] };
  $('historyPanel').innerHTML = `<h2>Route history <span class="seg"><button type="button" data-act="hist-mine" aria-pressed="${!app.histAll}">${first}</button><button type="button" data-act="hist-all" aria-pressed="${app.histAll}">Everyone</button></span></h2>
    <ol class="hist">${list.map((k) => {
      const who = k.who ? (member(k.who) || { suit: k.who }).suit : 'MSL';
      return `<li class="${k.id === app.histSel ? 'sel' : ''}" data-act="walk" data-id="${esc(k.id)}" tabindex="0">
        <div class="h1"><span class="hl">${esc(k.label)}</span><span class="tag ${k.kind}" title="${esc(tag[k.kind][1])}">${tag[k.kind][0]}</span></div>
        <div class="h2 mono">${esc(who)} · ${k.at != null ? ago(k.at) + ' · ' : ''}${km(k.distanceM)}${k.minutes != null ? ` · ${fmt(k.minutes)} min · dose ${pct(k.dose)}%` : ''}</div>
        <div class="h3">${k.kind === 'rover' ? esc(k.source) : `${ICON.heart} ${k.hrAvg != null ? `avg ${fmt(k.hrAvg)} · peak ${fmt(k.hrPeak)} bpm${k.spo2Min != null ? ` · SpO2 min ${pct(k.spo2Min)}%` : ''}` : 'no heart rate'} · ${esc(k.outcome || '')}`}</div></li>`;
    }).join('') || '<li class="none">No walks logged.</li>'}</ol>
    ${sel ? `<div class="tools small"><button type="button" data-act="walk-plan">Use as plan</button><button type="button" data-act="walk-clear">Hide on map</button></div>` : '<p class="note">Pick a walk to show it on the map.</p>'}
    ${app.recorded.length ? '<div class="tools small"><button type="button" data-act="hist-wipe">Clear recorded walks</button></div>' : ''}`;
  const row = document.querySelector('.hist li.sel'); if (row && document.body.classList.contains('crew')) row.scrollIntoView({ block: 'nearest' });
}
function pickCrew(id) { app.crewSel = id; if (app.histSel && !historyList().some((k) => k.id === app.histSel)) app.histSel = null; renderAll(); }
function assignCrew() {
  if (onWalk()) return toast('A walk is in progress. Reset it before changing who walks.');
  app.crewId = app.crewSel; saveChoice('crew', app.crewId); log(`${name()} assigned to the walk.`); renderAll();
}
function pickWalk(id) {
  app.histSel = app.histSel === id ? null : id; const k = app.walks.find((x) => x.id === app.histSel);
  if (k) app.map.frame(k.pts, 2.4, 420); renderAll();
}
// Start a new plan from a past walk: its start, its science stops (or its far point) and its end.
function planFromWalk() {
  const k = app.walks.find((x) => x.id === app.histSel); if (!k) return;
  let far = k.pts[0], fd = -1; for (const p of k.pts) { const d = Math.hypot(p.x - k.pts[0].x, p.y - k.pts[0].y); if (d > fd) { fd = d; far = p; } }
  const a = k.pts[0], b = k.pts[k.pts.length - 1], round = Math.hypot(a.x - b.x, a.y - b.y) < 2, mids = (k.stops && k.stops.length ? k.stops : round ? [far] : []).filter((p) => !round || p !== b);
  app.draft = [{ x: a.x, y: a.y, kind: 'start' }, ...mids.map((p) => ({ x: p.x, y: p.y, kind: 'stop' })), { x: (round ? far : b).x, y: (round ? far : b).y, kind: 'end' }];
  renumber(); app.draftDirty = true; app.planNote = 'Loaded from a past walk. Not sent yet.'; app.mode = 'plan'; renderAll();
}
// Records the walk in progress so it shows in the route history afterwards.
function trackWalk(ns) {
  if (!app.walk && onWalk(ns)) app.walk = { at: Date.now(), who: app.crewId, hrSum: 0, hrN: 0, hrPeak: 0, outcome: '', sheltered: false, snap: null };
  const W = app.walk; if (!W) return;
  const save = (outcome) => {
    W.outcome = outcome;
    const rec = { id: 'r' + W.at, who: W.who, at: W.at, ...W.snap, hrAvg: W.hrN ? Math.round(W.hrSum / W.hrN) : null, hrPeak: W.hrN ? W.hrPeak : null, spo2Min: W.spo2Min ?? null, marginMin: isFinite(W.marginMin) ? W.marginMin : null, outcome };
    app.recorded = [rec, ...app.recorded.filter((r) => r.id !== rec.id)]; saveRecorded(app.recorded); rebuildWalks(); log(`Walk saved to route history: ${outcome.toLowerCase()}.`);
  };
  if (onWalk(ns)) {
    const L = live(), w = app.route.waypoints, rr = ns.reroute;
    const pts = [...w.slice(0, ns.wp + 1), ...(rr ? rr.waypoints.slice(0, rr.wp + 1) : [])].map(({ x, y }) => ({ x, y }));
    let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    W.snap = { label: `${w[0].label || 'Start'} to ${L.w.label || (rr ? 'shelter' : 'waypoint ' + ns.wp)}`, distanceM: d, minutes: L.elapsedMin, dose: L.dose ?? 0, pts };
    const done = !rr && stopInfo().last, inShelter = !!rr && L.atShelter; if (inShelter) W.sheltered = true;
    const outcome = done ? (W.sheltered ? 'Completed after sheltering' : 'Completed') : inShelter ? (ns.panic ? 'Sheltered after panic button' : ns.storm ? 'Sheltered from storm' : 'Sheltered on reroute') : '';
    if (outcome && outcome !== W.outcome) save(outcome);
  } else { if (!W.outcome && W.snap) save('Ended early'); app.walk = null; app.vitals.reset(); }
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
function setMode(m) { app.mode = m; if (m !== 'plan') app.placing = null; if (m === 'crew' && !app.crewSel) app.crewSel = app.crewId; toggleVitalsDrawer(false); renderAll(); }
function toggleLayer(i) { const l = app.layers[i]; if (!l) return; app.layersOn.has(l.id) ? app.layersOn.delete(l.id) : app.layersOn.add(l.id); syncLayers(); }
function focusStop(i, keep) { app.focusStop = app.focusStop === i && !keep ? null : i; const st = app.route.stops[i]; if (app.focusStop != null && st) app.map.flyTo({ x: st.x, y: st.y, dist: Math.min(app.map.cam.dist, 420) }); renderAll(); }
function act(a, el) {
  switch (a) {
    case 'place-start': case 'place-stop': case 'place-end': { const k = a.slice(6); app.placing = app.placing === k ? null : k; renderAll(); break; }
    case 'del': app.draft.splice(+el.dataset.i, 1); renumber(); app.draftDirty = true; app.planNote = ''; renderAll(); break;
    case 'send-plan': sendPlan(); break;
    case 'up': moveStop(+el.dataset.i, -1); break;
    case 'stop-prev': stepStop(-1); break;
    case 'stop-next': stepStop(1); break;
    case 'undo-plan': resetDraft(); app.planNote = ''; renderAll(); break;
    case 'focus': focusStop(+el.dataset.i); break;
    case 'endstorm': if (app.state.storm) command('storm'); break;
    case 'local': startLocal(); break;
    case 'silence': stopAlarm(); break;
    case 'vitals': toggleVitalsDrawer(); break;
    case 'leak': toggleLeak(); break;
    case 'open-crew': setMode('crew'); break;
    case 'crew': pickCrew(el.dataset.id); break;
    case 'crew-open': app.crewSel = el.dataset.id; setMode('crew'); break;
    case 'assign': assignCrew(); break;
    case 'walk': pickWalk(el.dataset.id); break;
    case 'walk-plan': planFromWalk(); break;
    case 'walk-clear': app.histSel = null; renderAll(); break;
    case 'hist-mine': app.histAll = false; pickCrew(app.crewSel); break;
    case 'hist-all': app.histAll = true; renderAll(); break;
    case 'hist-wipe': app.recorded = []; saveRecorded([]); rebuildWalks(); app.histSel = null; renderAll(); break;
  }
}
function wireInput() {
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cmd]'); if (c) return command(c.dataset.cmd);
    const a = e.target.closest('[data-act]'); if (a) return act(a.dataset.act, a);
  });
  document.addEventListener('change', (e) => { if (e.target.dataset.layer != null) toggleLayer(+e.target.dataset.layer); });
  $('modePlan').onclick = () => setMode('plan'); $('modeLive').onclick = () => setMode('live'); $('modeCrew').onclick = () => setMode('crew');
  $('viewFit').onclick = routeView; $('viewTop').onclick = () => app.map.view('top'); $('compass').onclick = () => app.map.flyTo({ az: 0 }, 500);
  $('viewFollow').onclick = () => { app.follow = !app.follow; if (app.follow) app.map.flyTo({ x: app.astro.x, y: app.astro.y }); renderHeader(); };
  $('soundBtn').onclick = () => { app.sound = !app.sound; if (!app.sound) stopAlarm(); renderHeader(); renderBanner(); };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Enter' && e.target.closest && e.target.closest('li[data-act]')) return e.target.click();
    if (e.target.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return; // let a focused button work normally
    const keys = { ArrowRight: () => command(e.shiftKey ? 'nextstop' : 'next'), ' ': () => command('next'), ArrowLeft: () => command('back'), n: () => command('nextstop'),
      s: () => command('storm'), p: () => command('panic'), r: () => command('reset'),
      t: () => app.map.view('top'), f: routeView, g: () => $('viewFollow').click(), m: () => $('soundBtn').click(),
      c: () => setMode(app.mode === 'crew' ? 'live' : 'crew'), v: () => toggleVitalsDrawer(), l: toggleLeak,
      h: () => document.body.classList.toggle('noPresenter'), Escape: () => { if (!$('vitalsDrawer').hidden) return toggleVitalsDrawer(false); app.placing = null; app.focusStop = null; app.histSel = null; renderAll(); } };
    if (/^[1-9]$/.test(k)) { toggleLayer(+k - 1); return e.preventDefault(); }
    if (keys[k]) { keys[k](); e.preventDefault(); }
  });
  const elev = $('elev');
  elev.addEventListener('pointermove', (e) => { app.elevHover = e.clientX - elev.getBoundingClientRect().left; renderProfile(); });
  elev.addEventListener('pointerleave', () => { app.elevHover = null; renderProfile(); });
  new ResizeObserver(() => renderProfile()).observe(elev);
  app.map.onClick = ({ sx, sy, world }) => {
    if (app.placing) return world ? placeAt(world) : toast('Click on the terrain.');
    if (app.mode === 'crew') { // a click near a past walk picks it
      let hit = null, hd = 0.9 * app.u;
      for (const k of historyList()) for (const p of k.pts) { const q = app.map.project(p.x, p.y); const d = Math.hypot(q.x - sx, q.y - sy); if (q.ok && d < hd && k.id !== app.histSel) { hd = d; hit = k.id; } }
      if (hit) return pickWalk(hit);
    }
    let best = -1, bd = 1.6 * app.u;
    app.route.stops.forEach((st, i) => { const p = app.map.project(st.x, st.y); const d = Math.hypot(p.x - sx, p.y - sy); if (p.ok && d < bd) { bd = d; best = i; } });
    if (best >= 0) focusStop(best);
  };
}

// ---------- relay ----------
function startRelay() {
  const q = new URLSearchParams(location.search), url = q.get('relay') || CONFIG.RELAY_URL;
  app.relayUrl = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  // A discovered relay session also works over loopback HTTP for laptop/USB rehearsal.
  if (q.has('local') || q.has('fake') || (location.protocol !== 'https:' && !url && !app.session)) return startLocal();
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

  // A relay session supplies its exact loaded route, avoiding a mismatch after an export or override.
  app.session = forceFake ? null : await getJSON('/session.json').catch(() => null);
  const wp = app.session
    ? { v: await getJSON(app.session.waypoints), url: app.session.waypoints, fake: app.session.synthetic }
    : await firstOf(R.waypoints, F.waypoints, getJSON);
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
  app.terrain = terrain; if (!terrain.flat) app.walkGrid = makeWalkGrid(terrain);
  // The site file names the site and the area the planner covers (plannerBounds).
  app.siteDoc = forceFake ? null : await getJSON(CONFIG.SITE).catch(() => null);
  const siteName = app.siteDoc && typeof app.siteDoc.site === 'string' ? app.siteDoc.site.split('. ')[0] : CONFIG.SITE_NAME;
  $('siteName').textContent = siteName; $('siteName').title = (app.siteDoc && app.siteDoc.site) || siteName;
  if (terrain.credit) $('siteName').title += '\nTerrain and image: ' + terrain.credit;
  document.title = `Beacon Hub · ${siteName}`;
  const b = (app.session && app.session.plannerBounds) || (app.siteDoc && app.siteDoc.plannerBounds);
  app.bounds = b && ['xMin', 'xMax', 'yMin', 'yMax'].every((k) => typeof b[k] === 'number') && !wp.fake ? b : null;
  app.routeId = app.session ? app.session.planId ?? null : null;
  const fakes = [app.fake.waypoints && 'route', app.fake.layers && 'layers', app.fake.terrain && 'terrain'].filter(Boolean);
  $('dataChip').hidden = !fakes.length; $('dataChip').textContent = fakes.length === 3 ? 'Fake data' : `Fake ${fakes.join(' and ')}`;
  const sun = (doc.main && doc.main[0] && doc.main[0].sun) || null;
  app.map = createMap($('gl'), $('ov'), { terrain, sun, exaggeration: CONFIG.EXAGGERATION, imageGain: CONFIG.IMAGE_GAIN });
  if (terrain.imageUrl) loadImage(terrain.imageUrl).then((im) => app.map.setOrtho(im)).catch(() => {});
  if (meta) {
    if (meta.version !== 1) note += ` Layer metadata is version ${meta.version}; the hub was written for version 1.`;
    const wanted = CONFIG.LAYERS.filter((l) => !l.hub && meta.layers && meta.layers[l.id]).slice(0, 6);
    const loaded = await Promise.all(wanted.map((l) => loadImage(layersUrl + meta.layers[l.id].file).then((im) => ({ l, im })).catch(() => null)));
    app.layerMeta = { meta, url: layersUrl };
    loaded.filter(Boolean).forEach(({ l, im }, i) => {
      const { min, max } = meta.layers[l.id];
      l.index = i;
      app.map.setLayer(i, im, layerOptions(l, meta));
      app.layers.push(l);
      if (l.id === 'slope') { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); app.slope = { data: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height, min, max, mpp: meta.metresPerPixel }; }
    });
  }
  // Crew: who is assigned (kept between visits), walks recorded earlier on this laptop, and the rover's real track.
  app.crewId = (member(loadChoice('crew')) || CREW.find((m) => m.condition === 'fit') || CREW[0] || {}).id || null; app.crewSel = app.crewId;
  app.recorded = loadRecorded(); app.rover = readSite(app.siteDoc); app.planner = (app.siteDoc && app.siteDoc.planner) || {};
  if (!wp.fake) await loadRouteExtras(app.routeId != null);
  setUnit(); window.addEventListener('resize', setUnit);
  setRoute(doc, false); buildBaseField(); renderLayers(); renderAll();
  app.map.onDraw = (g, now) => {
    const moving = tickAstro(now); if (moving) { renderMirror(); renderProfile(); }
    const L = live(); mapFurniture();
    drawOverlay(g, app.map, { u: app.u, bounds: app.mode === 'plan' ? app.bounds : null, route: app.route, state: app.state, base: app.route.base, shelters: app.route.shelters, astro: app.astro, live: L, headingDeg: L.headingDeg, emergency: emergency(), mode: app.mode, draft: app.draft, draftPath: app.draftPath, draftDirty: app.draftDirty, focusStop: app.focusStop, name: name(), history: historyForMap(), probe: app.elevPoint }, now);
  };
  wireInput(); renderLog();
  log(`Route loaded: ${fmt(app.route.totals.timeMin)} min, ${app.route.stops.length} science stop${app.route.stops.length === 1 ? '' : 's'}.`);
  if (note) log(note.trim(), 'caution');
  startRelay();
  setInterval(tick, 500);
  tickVitals(); setInterval(tickVitals, 1000);
  routeView();
}
// Engine extras that belong to the route (shared/outputs.md): the briefing's space weather and weather report,
// Curiosity photos per stop, and the minutes-to-shelter layer. After a plan they come from the relay's /mission/.
async function loadRouteExtras(fromPlan = true) {
  const R = CONFIG.REAL, base = app.session && fromPlan ? app.session.files || '/mission/' : null, q = `?r=${app.routeId ?? 0}`;
  app.briefing = await getJSON((base ? base + 'briefing.json' : R.briefing) + q).catch(() => null);
  const stops = await getJSON((base ? base + 'stops.json' : R.stops) + q).catch(() => null);
  app.stopNotes = {};
  for (const s of (stops && stops.stops) || []) {
    const im = (s.images || [])[0];
    if (im && s.waypoint) app.stopNotes[s.waypoint] = { photo: R.media + im.file, credit: im.credit, task: `Curiosity's view: ${im.title} (${im.date}).` };
  }
  const l = app.layers.find((x) => x.id === 'minutesToShelter'), M = app.layerMeta;
  if (base && l && M) {
    const im = await loadImage(base + 'layers/' + M.meta.layers[l.id].file + q).catch(() => null);
    if (im) app.map.setLayer(l.index, im, layerOptions(l, M.meta));
  }
}
function layerOptions(l, meta) {
  const { min, max } = meta.layers[l.id], span = (max - min) || 1; // pixel 0 = min, 255 = max (shared/layers.md)
  return { domain: [(l.domain[0] - min) / span, (l.domain[1] - min) / span], stops: l.stops, widthM: meta.width * meta.metresPerPixel, heightM: meta.height * meta.metresPerPixel,
    originX: meta.originX || 0, originY: meta.originY || 0, noData: l.noData ?? null, validBounds: meta.layers[l.id].validBounds || null };
}
// ---------- route profile ----------
// The draft while one is being placed, else the route: ground height, minutes to shelter, stops and shelters.
function profileData() {
  if (app.profile) return app.profile;
  const T = app.terrain, r = app.route;
  if (app.mode === 'plan' && app.draftDirty && app.draftPath && T && !T.flat) {
    const pts = profileFromPoints(sampleLine(app.draftPath, (x, y) => T.heightAt(x, y)));
    let n = 0;
    for (const q of app.draft) { if (q.kind !== 'stop') continue; n++; let best = null, bd = Infinity; for (const p of pts) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = p; } } if (best) best.stop = n; }
    return (app.profile = { pts, draft: true });
  }
  const stopNum = new Map(r.stops.map((st) => [st.wp, st.num]));
  const pts = profileFromPoints(r.waypoints.map((w, i) => ({ x: w.x, y: w.y, z: w.z != null ? w.z : T.heightAt(w.x, w.y), shelterMin: w.shelter ? w.shelter.min : null, stop: stopNum.get(i), shelter: w.isShelter && i > 0, wp: i })));
  return (app.profile = { pts, draft: false });
}
function renderProfile() {
  const panel = $('elevPanel'); if (!panel || getComputedStyle(panel).display === 'none') return;
  const P = profileData(), A = app.astro, s = app.state;
  let at = null;
  if (!P.draft && P.pts.length > 1) {
    const i = Math.min(s.reroute ? s.wp : A.seg, P.pts.length - 1), j = Math.min(i + 1, P.pts.length - 1);
    at = s.reroute ? P.pts[i].d : P.pts[i].d + (P.pts[j].d - P.pts[i].d) * (A.anim ? A.f : 0);
  }
  const hover = drawProfile($('elev'), P.pts, { at, maxSlopeDeg: CONFIG.MAX_SLOPE_DEG, hoverX: app.elevHover });
  app.elevPoint = hover;
  $('elevTitle').textContent = P.draft ? 'Draft profile' : 'Route profile';
  $('elevLen').textContent = P.pts.length > 1 ? (P.draft ? 'not planned yet' : km(P.pts[P.pts.length - 1].d)) : '';
  // hovering swaps the key for the values under the cursor; the map marks the same spot
  $('elevRead').hidden = !hover; panel.querySelector('.elevKey').hidden = !!hover;
  panel.querySelector('.kl.shel').parentElement.hidden = P.draft; // a draft has no shelter times until it is planned
  if (hover) $('elevRead').textContent = `${km(hover.d)} along · ${fmt(hover.z)} m${hover.shelterMin != null ? ` · ${fmt1(hover.shelterMin)} min to shelter` : ''}`;
}

// ---------- crew readiness while planning ----------
function renderReady() {
  if (!CREW.length) { $('readyPanel').innerHTML = ''; return; }
  $('readyPanel').innerHTML = `<h2>Who can walk it <span class="hint">current route</span></h2><ul class="crew compact">${CREW.map((m) => {
    const v = verdictFor(m);
    return `<li class="${m.id === app.crewId ? 'sel' : ''}" data-act="crew-open" data-id="${esc(m.id)}" tabindex="0" title="${esc(v.reasons.join('. '))}">
      <div class="c1"><span class="cname">${esc(m.name)}</span><span class="suit">${esc(m.suit)}</span>${m.id === app.crewId ? '<span class="assigned">Walking</span>' : ''}<span class="verdict ${v.level}">${VICON[v.level]}${WORD[v.level]}</span></div>
      <div class="why">${esc(v.reasons[0])}</div></li>`;
  }).join('')}</ul>`;
}

// Compass and scale bar follow the camera.
let lastAz = null, lastScale = '';
function mapFurniture() {
  const m = app.map, c = m.cam;
  if (c.az !== lastAz) { lastAz = c.az; $('compass').firstElementChild.style.transform = `rotate(${-c.az}deg)`; }
  const a = c.az * RAD, p0 = m.project(c.x, c.y, 0), p1 = m.project(c.x + Math.cos(a) * 100, c.y - Math.sin(a) * 100, 0);
  const px = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 100; if (!(px > 0) || !p0.ok) return;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * px >= 70) || 5000, key = nice + ':' + Math.round(nice * px);
  if (key !== lastScale) { lastScale = key; const el = $('scale'); el.firstElementChild.style.width = `${Math.round(nice * px)}px`; el.lastElementChild.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`; }
}
function setUnit() { app.u = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }
boot().catch((err) => {
  console.error(err);
  const f = $('fatal'); f.hidden = false;
  f.innerHTML = `<h1>The hub could not start</h1><p>${esc(err.message)}</p><p>Open the hub through the relay (<code>npm start</code> in <code>relay/</code>, then <code>/hub/</code>), not as a file. File locations are in <code>config.js</code>.</p>`;
});

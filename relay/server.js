// Beacon relay: serves the pages over HTTPS, holds the one state object and
// broadcasts it over WebSockets. Contracts: shared/state.md, events.md, waypoints.md.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');

// ---- Settings ---------------------------------------------------------------

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443; // pages + wss://…/ws for browsers
// Laptop/USB rehearsal uses the same relay, bound only to loopback, without certificates.
const LOCAL = process.argv.includes('--local');
const WIFI = process.argv.includes('--wifi');
const LOCAL_PORT = process.env.LOCAL_PORT === undefined ? 5174 : Number(process.env.LOCAL_PORT);
if ((LOCAL || WIFI) && (!Number.isInteger(LOCAL_PORT) || LOCAL_PORT < 0 || LOCAL_PORT > 65535)) throw new Error('Invalid LOCAL_PORT');
const PLAIN_PORT = Number(process.env.PLAIN_PORT) || 8081; // ws:// for the ESP32
// Mode is "warning" above this many minutes to shelter. data/site.json planner.minutesToShelterLimit
// overrides it when present; this is the fallback.
const DEFAULT_WARNING_MINUTES_TO_SHELTER = 12;
const DEFAULT_EARTH_DELAY_MINUTES = 14;
const PING_INTERVAL_MS = 15000;

const ROOT = path.resolve(__dirname, '..');

// Site: SITE=<name> in the environment, or --site <name>, serves data/sites/<name>/site.json,
// data/out/<name>/waypoints.json and data/out/<name>/ as /data/. Without one (the default, Gale) it is
// data/site.json and data/out/, as before. The apps keep the same URLs either way.
// The hub's planet view can switch site while the relay runs ({ type: "site", name }, see useSite); Gale, the
// default, is the id "gale". SITE is null for Gale.
const DEFAULT_SITE_ID = 'gale';
const siteNameOk = (name) => /^[A-Za-z0-9_-]+$/.test(name);
const siteFileOf = (name) => (name ? path.join(ROOT, 'data/sites', name, 'site.json') : path.join(ROOT, 'data/site.json'));
const dataOutOf = (name) => (name ? path.join(ROOT, 'data/out', name) : path.join(ROOT, 'data/out'));
let SITE = (() => {
  const i = process.argv.indexOf('--site');
  const name = i >= 0 ? process.argv[i + 1] : process.env.SITE;
  if (!name || name === DEFAULT_SITE_ID) return null;
  if (!siteNameOk(name)) throw new Error(`Site name "${name}" must be letters, digits, - or _`);
  return name;
})();
let SITE_FILE = siteFileOf(SITE);
let DATA_OUT = dataOutOf(SITE);
if (SITE && !fs.existsSync(SITE_FILE)) throw new Error(`No site file for site "${SITE}": ${path.relative(ROOT, SITE_FILE)}`);
const CERT_DIR = path.join(__dirname, 'certs');

// The headset is built with Vite (root package.json, vite.config.js) into dist/.
// Serve the build when there is one; otherwise the unbuilt source.
const BUILT_HEADSET = path.join(ROOT, 'dist/apps/headset');
const HEADSET_IS_BUILT = fs.existsSync(path.join(BUILT_HEADSET, 'index.html'));

const MOUNTS = {
  '/hub/': path.join(ROOT, 'apps/hub'),
  '/headset/': HEADSET_IS_BUILT ? BUILT_HEADSET : path.join(ROOT, 'apps/headset'),
  // The Vite build references its bundles as /assets/...
  ...(HEADSET_IS_BUILT ? { '/assets/': path.join(ROOT, 'dist/assets') } : {}),
  '/wrist/': path.join(ROOT, 'apps/wrist'),
  '/shared/': path.join(ROOT, 'shared'),
  '/data/': DATA_OUT,
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

// ---- Logging ----------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

// ---- Data -------------------------------------------------------------------

function loadWaypoints() {
  const candidates = process.env.WAYPOINTS
    ? [path.resolve(process.env.WAYPOINTS)]
    // A named site has no fake fallback: the fake route belongs to no site.
    : [path.join(DATA_OUT, 'waypoints.json'), ...(SITE ? [] : [path.join(ROOT, 'shared/fake/waypoints.json')])];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error(`No waypoint file found. Tried: ${candidates.join(', ')}`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.main) || doc.main.length === 0) throw new Error(`${file}: "main" is empty`);
  log(`Loaded waypoints from ${path.relative(ROOT, file)} (${doc.main.length} main, ${Object.keys(doc.reroutes || {}).length} reroutes)`);
  return { doc, synthetic: file === path.join(ROOT, 'shared/fake/waypoints.json') || doc.source?.kind === 'synthetic' };
}

function loadSite() {
  try {
    return JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'));
  } catch {
    return {}; // missing or unreadable: every value falls back to its default
  }
}

log(SITE ? `Site ${SITE}: ${path.relative(ROOT, SITE_FILE)}, /data/ = ${path.relative(ROOT, DATA_OUT)}/` : 'Site: default (Gale): data/site.json, /data/ = data/out/');
let { doc: waypoints, synthetic } = loadWaypoints(); // replaced when a new plan is made (see Planning)
let exampleRoute = { doc: waypoints, synthetic }; // the route the site started with: its example walk
let site = loadSite();
const earthDelayOf = (s) => (typeof s.earthDelayMinutes === 'number' ? s.earthDelayMinutes : DEFAULT_EARTH_DELAY_MINUTES);
const warningOf = (s) => (typeof s.planner?.minutesToShelterLimit === 'number' ? s.planner.minutesToShelterLimit : DEFAULT_WARNING_MINUTES_TO_SHELTER);
let earthDelayMinutes = earthDelayOf(site);
let WARNING_MINUTES_TO_SHELTER = warningOf(site);
log(`earthDelayMinutes = ${earthDelayMinutes}, warning above ${WARNING_MINUTES_TO_SHELTER} min to shelter`);

// Every site the relay can serve: Gale (data/site.json) and each data/sites/<name>/ with a waypoint file. lat and lon
// (degrees) come from the site file: Gale's parking spot, else the centre of the 3 km crop in its equirectangular frame.
function listSites() {
  const names = [null, ...(() => { try { return fs.readdirSync(path.join(ROOT, 'data/sites')).filter(siteNameOk); } catch { return []; } })()];
  const out = [];
  for (const name of names) {
    let s; try { s = JSON.parse(fs.readFileSync(siteFileOf(name), 'utf8')); } catch { continue; }
    if (!fs.existsSync(path.join(dataOutOf(name), 'waypoints.json'))) continue;
    let lat = s.parkingSpot?.lat, lon = s.parkingSpot?.lon;
    const g = s.grid, R = 3396190;
    if (!(Number.isFinite(lat) && Number.isFinite(lon)) && g && Number.isFinite(g.southWestEasting) && Number.isFinite(g.southWestNorthing)) {
      const sp = Number((/Standard_Parallel_1",\s*([-\d.]+)/.exec(g.projection || '') || [])[1]) || 0; // equidistant cylindrical
      lon = ((g.southWestEasting + 1500) / (R * Math.cos(sp * Math.PI / 180))) * 180 / Math.PI; lat = ((g.southWestNorthing + 1500) / R) * 180 / Math.PI;
    }
    const full = typeof s.site === 'string' ? s.site : name || DEFAULT_SITE_ID;
    out.push({ id: name || DEFAULT_SITE_ID, name: full.split('. ')[0], description: full, lat: lat ?? null, lon: lon ?? null });
  }
  return out;
}

// Switches the site the relay serves: its site file, /data/, example route and planning folder. The walk starts
// again at the new site's example route, and a plan still running for the old site is dropped when it ends.
function useSite(id) {
  if (typeof id !== 'string' || !siteNameOk(id)) return false;
  const name = id === DEFAULT_SITE_ID ? null : id;
  if (name === SITE) return false;
  if (!fs.existsSync(siteFileOf(name)) || !fs.existsSync(path.join(dataOutOf(name), 'waypoints.json'))) return false;
  const was = { SITE, SITE_FILE, DATA_OUT };
  SITE = name; SITE_FILE = siteFileOf(name); DATA_OUT = dataOutOf(name);
  let loaded;
  try { loaded = loadWaypoints(); } catch (e) { ({ SITE, SITE_FILE, DATA_OUT } = was); log(`! site ${id}: ${e.message}`); return false; }
  MOUNTS['/data/'] = DATA_OUT;
  ({ doc: waypoints, synthetic } = loaded); exampleRoute = loaded;
  site = loadSite(); earthDelayMinutes = earthDelayOf(site); WARNING_MINUTES_TO_SHELTER = warningOf(site);
  PLANS = plansOf(SITE); planDir = null; routePlanId = null; plan = null; planRunning = false; siteEpoch++;
  Object.assign(sim, { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 });
  log(`  site switched to ${id}: ${path.relative(ROOT, SITE_FILE)}, /data/ = ${path.relative(ROOT, DATA_OUT)}/`);
  return true;
}

// ---- State ------------------------------------------------------------------

// Inputs the events change. The broadcast state is derived from these.
const sim = { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 };

function currentRoute() {
  return sim.route === 'main' ? waypoints.main : waypoints.reroutes[String(sim.rerouteFrom)];
}

function buildState() {
  const wp = currentRoute()[sim.waypointIndex];
  const state = {
    version: 1,
    route: sim.route,
    waypointIndex: sim.waypointIndex,
    rerouteFrom: sim.route === 'reroute' ? sim.rerouteFrom : null,
    mode: 'nominal',
    storm: sim.storm,
    panic: sim.panic,
    rerouteRequested: sim.rerouteRequested,
    headingDeg: wp.headingDeg,
    shelterBearingDeg: wp.shelter.az,
    minutesToShelter: wp.shelter.minutes,
    openSky: wp.openSky,
    doseFraction: wp.doseFraction,
    // Optional (shared/state.md): present when the waypoint file has them.
    ...(wp.doseMicroGray != null && { doseMicroGray: wp.doseMicroGray }),
    ...(wp.doseRateMicroGrayPerHour != null && { doseRateMicroGrayPerHour: wp.doseRateMicroGrayPerHour }),
    oxygenFraction: wp.oxygenFraction,
    sunlit: wp.sun.visible,
    baseLink: wp.base.visible,
    earthLink: wp.earth.visible,
    earthDelayMinutes,
    // Addition (shared/state.md): which site the relay serves ("gale" by default). Clients reload when it changes.
    site: SITE || DEFAULT_SITE_ID,
    // Optional addition (shared/state.md): the latest plan request. Only sent once a plan was asked for.
    ...(plan && { plan: { id: plan.id, status: plan.status, message: plan.message, routeId: routePlanId } }),
  };
  if (state.storm || state.panic) state.mode = 'storm';
  else if (!state.baseLink || state.minutesToShelter > WARNING_MINUTES_TO_SHELTER) state.mode = 'warning';
  return state;
}

function clampIndex(i) {
  return Math.max(0, Math.min(currentRoute().length - 1, i));
}

function switchToReroute() {
  if (sim.route === 'reroute') return;
  const reroute = waypoints.reroutes && waypoints.reroutes[String(sim.waypointIndex)];
  if (!Array.isArray(reroute) || reroute.length === 0) {
    log(`No reroute for main index ${sim.waypointIndex}; staying on main`);
    return;
  }
  sim.rerouteFrom = sim.waypointIndex;
  sim.route = 'reroute';
  sim.waypointIndex = 0;
}

// Applies one event to sim. Returns false if the event is unknown or invalid.
function applyEvent(ev) {
  if (ev.requestId !== undefined && (typeof ev.requestId !== 'string' || ev.requestId.length === 0 || ev.requestId.length > 80)) return false;
  // Native walking acknowledges a specific sample. A delayed/replayed packet
  // must not advance a route selected meanwhile by the hub or an emergency.
  if (ev.expected !== undefined) {
    const expected = ev.expected;
    // An emergency press can overlap a walking acknowledgement on the same
    // route. Storm start/stop must still work, without rewinding another route.
    const changingStorm = ev.type === 'storm' && typeof ev.on === 'boolean';
    if (!expected || expected.route !== sim.route || (!changingStorm && expected.waypointIndex !== sim.waypointIndex) ||
        expected.rerouteFrom !== (sim.route === 'reroute' ? sim.rerouteFrom : null)) return false;
  }
  switch (ev.type) {
    case 'next': sim.waypointIndex = clampIndex(sim.waypointIndex + 1); return true;
    case 'back': sim.waypointIndex = clampIndex(sim.waypointIndex - 1); return true;
    case 'goto':
      if (!Number.isInteger(ev.index)) return false;
      sim.waypointIndex = clampIndex(ev.index);
      return true;
    case 'storm':
      if (typeof ev.on !== 'boolean') return false;
      if (ev.atIndex !== undefined) {
        if (!ev.on || sim.route !== 'main' || !Number.isInteger(ev.atIndex) || ev.atIndex < 0 || ev.atIndex >= waypoints.main.length ||
            !waypoints.reroutes?.[String(ev.atIndex)]?.length) return false;
        sim.waypointIndex = ev.atIndex;
      }
      if (ev.on) { sim.storm = true; switchToReroute(); return true; }
      sim.storm = false;
      if (sim.route === 'reroute' && !sim.panic && !sim.rerouteRequested) {
        sim.route = 'main';
        sim.waypointIndex = sim.rerouteFrom;
      }
      return true;
    case 'panic': sim.panic = true; switchToReroute(); return true;
    case 'requestReroute':
      // Optional VR position match; the engine still selects the entire shelter
      // route. Clients cannot submit replacement paths or shelter decisions.
      if (ev.atIndex !== undefined) {
        if (sim.route !== 'main' || !Number.isInteger(ev.atIndex) || ev.atIndex < 0 || ev.atIndex >= waypoints.main.length ||
            !waypoints.reroutes?.[String(ev.atIndex)]?.length) return false;
        sim.waypointIndex = ev.atIndex;
      }
      sim.rerouteRequested = true; switchToReroute(); return true;
    case 'reset':
      // { type: "reset", example: true } also puts back the site's example route if a plan replaced it
      // (hub "Example route" button, Quest A button).
      if (ev.example === true) loadExampleRoute();
      Object.assign(sim, { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 });
      return true;
    case 'cancelReroute':
      // Turns off SOS and the astronaut's shelter request together. Back on the main route where the reroute began,
      // unless a solar storm still needs the shelter route (only base ends a storm).
      if (!sim.panic && !sim.rerouteRequested) return false;
      sim.panic = false; sim.rerouteRequested = false;
      if (sim.route === 'reroute' && !sim.storm) { sim.route = 'main'; sim.waypointIndex = sim.rerouteFrom; }
      return true;
    case 'plan': return requestPlan(ev);
    case 'site': return useSite(ev.name);
    default: return false;
  }
}

// ---- Planning ---------------------------------------------------------------
// Addition to shared/events.md: { type: "plan", points: [{ x, y, kind: "start" | "stop" | "end", name? }] }.
// state.plan.routeId says which plan's route is in use; clients fetch /mission/waypoints.json again when it changes.
// The relay runs `engine plan --stops ... --out <dir>` in the background. While it runs, state.plan.status is
// "running"; when it succeeds the new route replaces the old one for every client, the walk starts again at its
// first waypoint, and state.plan.status is "done" with a new id; when it fails the old route stays and the status
// is "error" with the reason. Asked for mid-walk, the new route starts where the astronaut is.

const ENGINE = process.env.BEACON_ENGINE || path.join(ROOT, 'engine/target/release/engine' + (process.platform === 'win32' ? '.exe' : ''));
const plansOf = (name) => process.env.BEACON_PLANS || path.join(ROOT, '.local/plans', name || DEFAULT_SITE_ID); // .local/ is ignored by git
let PLANS = plansOf(SITE);
let siteEpoch = 0; // bumped by a site switch, so a plan for the old site neither lands nor clears the new site's lock
const PLAN_TIMEOUT_MS = 180000;
const MAX_PLAN_POINTS = 14;
let plan = null;      // { id, status: 'running' | 'done' | 'error', message }
let planDir = null;   // folder of the route in use when it came from a plan; null = the site's data/out
let routePlanId = null; // id of the plan whose route is in use; null = the site's own route
let planRunning = false;
let planSerial = 0;

function planBounds() {
  const b = site.plannerBounds;
  return b && ['xMin', 'xMax', 'yMin', 'yMax'].every((k) => typeof b[k] === 'number') ? b : null;
}

// Checks the points and returns { points } or { error }.
function checkPlanPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'A plan needs a start and an end.' };
  if (points.length > MAX_PLAN_POINTS) return { error: `A plan can have at most ${MAX_PLAN_POINTS} points.` };
  const b = planBounds(), out = [];
  for (const [i, p] of points.entries()) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { error: `Point ${i + 1} has no x and y.` };
    if (b && (p.x < b.xMin || p.x > b.xMax || p.y < b.yMin || p.y > b.yMax)) {
      return { error: `Point ${i + 1} (${Math.round(p.x)}, ${Math.round(p.y)}) is outside the planned area x ${b.xMin}..${b.xMax}, y ${b.yMin}..${b.yMax}.` };
    }
    const name = typeof p.name === 'string' ? p.name.replace(/[;,\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    out.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, name });
  }
  return { points: out };
}

function requestPlan(ev) {
  const id = ++planSerial;
  const fail = (message) => { plan = { id, status: 'error', message }; log(`  plan ${id} refused: ${message}`); return true; };
  if (planRunning) return fail('A plan is already being made. Wait for it to finish.');
  if (sim.storm || sim.panic) return fail('No new plans during a storm or panic. End it or reset first.');
  if (sim.route === 'reroute') return fail('The astronaut is on a reroute to shelter. Reset to the main route first.');
  const checked = checkPlanPoints(ev.points);
  if (checked.error) return fail(checked.error);
  const points = checked.points;
  let note = '';
  if (sim.waypointIndex > 0) { // mid-walk: start from where the astronaut is
    const here = waypoints.main[sim.waypointIndex].pos;
    points[0] = { x: here.x, y: here.y, name: '' };
    note = ' Started from the astronaut\'s position.';
  }
  if (!fs.existsSync(ENGINE)) return fail(`The engine is not built (${path.relative(ROOT, ENGINE)}). Run: cd engine && cargo build --release`);
  const dir = path.join(PLANS, String(Date.now()) + '-' + id);
  fs.mkdirSync(dir, { recursive: true });
  const stops = points.map((p, i) => `${p.x},${p.y}${i > 0 && i < points.length - 1 && p.name ? ',' + p.name : ''}`).join(';');
  const args = ['--root', ROOT, ...(SITE ? ['--site', SITE] : []), 'plan', '--stops', stops, '--out', dir];
  plan = { id, status: 'running', message: `Planning ${points.length - 2} science stop${points.length === 3 ? '' : 's'}…` };
  planRunning = true;
  log(`  plan ${id}: ${path.relative(ROOT, ENGINE)} ${args.slice(2).join(' ')}`);
  // A .js/.mjs engine (the tests' stand-in) runs through node, so it works on Windows too.
  const [cmd, cmdArgs] = /\.m?js$/.test(ENGINE) ? [process.execPath, [ENGINE, ...args]] : [ENGINE, args];
  const epoch = siteEpoch;
  execFile(cmd, cmdArgs, { timeout: PLAN_TIMEOUT_MS, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
    if (epoch !== siteEpoch) return; // the site changed while this plan ran: drop it
    planRunning = false;
    if (!plan || plan.id !== id) return;
    try {
      if (err) throw new Error((String(stderr || '').trim().split('\n').pop() || err.message).replace(/^Error:\s*/, ''));
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'waypoints.json'), 'utf8'));
      if (!Array.isArray(doc.main) || doc.main.length === 0) throw new Error('the engine wrote an empty route');
      waypoints = doc; synthetic = false; planDir = dir; routePlanId = id;
      Object.assign(sim, { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 });
      const n = doc.main.filter((w) => w.isScienceStop).length, min = doc.main[doc.main.length - 1].minutesFromStart;
      plan = { id, status: 'done', message: `New route: ${Math.round(min)} min, ${n} science stop${n === 1 ? '' : 's'}.${note}` };
      log(`  plan ${id} done: ${doc.main.length} main waypoints, ${Object.keys(doc.reroutes || {}).length} reroutes`);
      prunePlans(dir);
    } catch (e) {
      plan = { id, status: 'error', message: `The planner failed: ${e.message}` };
      log(`! plan ${id} failed: ${e.message}`);
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
    state = buildState();
    broadcast();
  });
  return true;
}

// Back to the site's example route, dropping a planned route and any plan still being made.
function loadExampleRoute() {
  if (routePlanId == null && !planRunning) return;
  waypoints = exampleRoute.doc; synthetic = exampleRoute.synthetic; planDir = null; routePlanId = null;
  plan = { id: ++planSerial, status: 'done', message: 'Example route loaded.' }; // a plan still running is ignored when it ends
  log('  example route loaded');
}

// Keeps the plan in use and the two before it.
function prunePlans(keep) {
  try {
    const dirs = fs.readdirSync(PLANS).map((d) => path.join(PLANS, d)).filter((d) => d !== keep).sort().reverse();
    for (const d of dirs.slice(2)) fs.rm(d, { recursive: true, force: true }, () => {});
  } catch { /* nothing to prune */ }
}

// Files of the route in use: the plan's folder first, then the site's data/out (terrain, other layers, photos).
function missionFile(rel) {
  const inPlan = planDir && path.join(planDir, rel);
  if (inPlan && inPlan.startsWith(planDir + path.sep) && fs.existsSync(inPlan)) return inPlan;
  return path.join(DATA_OUT, rel);
}

let state = buildState();

// ---- Clients ----------------------------------------------------------------

const clients = new Set(); // { ws, role, transport, address, since }

function sendState(client, replyTo) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ type: 'state', state, ...(replyTo && { replyTo }) }));
}

function broadcast(requester, requestId) {
  for (const c of clients) sendState(c, c === requester ? requestId : undefined);
}

function who(c) {
  return `${c.role}@${c.transport} ${c.address}`;
}

function onConnection(ws, req, transport) {
  const client = { ws, role: '?', transport, address: req.socket.remoteAddress, since: new Date().toISOString() };
  clients.add(client);
  ws.isAlive = true;
  log(`+ connect   ${who(client)} (${clients.size} connected)`);
  sendState(client);

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => {
    clients.delete(client);
    log(`- disconnect ${who(client)} (${clients.size} connected)`);
  });
  ws.on('error', (err) => log(`! error ${who(client)}: ${err.message}`));

  ws.on('message', (data) => {
    let ev;
    try { ev = JSON.parse(data.toString()); } catch {
      log(`? invalid JSON from ${who(client)}: ${String(data).slice(0, 80)}`);
      return;
    }
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') {
      log(`? message without a type from ${who(client)}`);
      return;
    }
    if (ev.type === 'hello') {
      client.role = typeof ev.role === 'string' && ev.role ? ev.role : '?';
      log(`  hello     ${who(client)}`);
      sendState(client);
      return;
    }
    if (!applyEvent(ev)) {
      log(`? ignored   ${who(client)}: ${JSON.stringify(ev)}`);
      return;
    }
    const before = JSON.stringify(state);
    state = buildState();
    const changed = JSON.stringify(state) !== before;
    log(`  event     ${who(client)}: ${JSON.stringify(ev)} -> ${state.route}[${state.waypointIndex}] ${state.mode}${changed ? '' : ' (no change)'}`);
    if (changed) broadcast(client, ev.requestId);
    else if (ev.requestId) sendState(client, ev.requestId);
  });
}

setInterval(() => {
  for (const c of clients) {
    if (!c.ws.isAlive) {
      log(`x dropping dead socket ${who(c)}`);
      c.ws.terminate();
      continue;
    }
    c.ws.isAlive = false;
    c.ws.ping();
  }
}, PING_INTERVAL_MS);

// ---- HTTPS ------------------------------------------------------------------

const INDEX_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Beacon relay</title>
<style>body{font:18px system-ui,sans-serif;margin:2rem;line-height:1.8}</style></head><body>
<h1>Beacon</h1><ul><li><a href="/hub/">Hub</a></li><li><a href="/headset/">Headset</a></li>
<li><a href="/wrist/">Wrist</a></li><li><a href="/debug">Debug / presenter control</a></li></ul></body></html>`;

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) return serveFile(res, path.join(file, 'index.html'));
    if (err || !st.isFile()) return send(res, 404, 'text/plain', 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function onRequest(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'https://x').pathname); } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }
  if (urlPath === '/') return send(res, 200, 'text/html; charset=utf-8', INDEX_HTML);
  if (urlPath === '/debug') return serveFile(res, path.join(__dirname, 'debug.html'));
  // Serve the exact in-memory route used by this relay, including WAYPOINTS overrides.
  if (urlPath === '/session.json') {
    return send(res, 200, 'application/json', JSON.stringify({ version: 1, waypoints: '/mission/waypoints.json', synthetic, files: '/mission/', planId: routePlanId, plannerBounds: planBounds(),
      capabilities: { commandReplies: true, stormStop: true, plan: true, exampleRoute: true } }));
  }
  if (urlPath === '/mission/waypoints.json') return send(res, 200, 'application/json', JSON.stringify(waypoints));
  // The route's other files (briefing, stops, minutesToShelter layer) follow the latest plan; see missionFile.
  if (urlPath.startsWith('/mission/')) {
    const rel = path.normalize(urlPath.slice('/mission/'.length));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return send(res, 403, 'text/plain', 'Forbidden');
    return serveFile(res, missionFile(rel));
  }
  // The one file outside data/out/ that pages may read.
  if (urlPath === '/data/site.json') return serveFile(res, SITE_FILE);
  if (urlPath === '/sites.json') return send(res, 200, 'application/json', JSON.stringify({ version: 1, current: SITE || DEFAULT_SITE_ID, sites: listSites() }));
  if (urlPath === '/clients') {
    const list = [...clients].map(({ role, transport, address, since }) => ({ role, transport, address, since }));
    return send(res, 200, 'application/json', JSON.stringify(list));
  }
  for (const [prefix, dir] of Object.entries(MOUNTS)) {
    if (urlPath === prefix.slice(0, -1)) {
      res.writeHead(301, { Location: prefix, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (urlPath.startsWith(prefix)) {
      const file = path.join(dir, urlPath.slice(prefix.length));
      if (file !== dir && !file.startsWith(dir + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
      return serveFile(res, file);
    }
  }
  send(res, 404, 'text/plain', 'Not found');
}

function readCerts() {
  try {
    return { key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) };
  } catch {
    console.error(`No certificate in ${path.relative(ROOT, CERT_DIR)}/. Run: npm run cert -- <laptop IP>`);
    process.exit(1);
  }
}

// ---- Start ------------------------------------------------------------------

const server = LOCAL ? http.createServer(onRequest) : https.createServer(readCerts(), onRequest);
// Browser sockets: /ws, plus /relay as an alias for the headset client (shared/socket.js).
const SECURE_WS_PATHS = new Set(['/ws', '/relay']);
const secureWss = new WebSocketServer({ noServer: true });
function upgradeBrowser(req, socket, head) {
  const wsPath = new URL(req.url, 'https://x').pathname;
  if (!SECURE_WS_PATHS.has(wsPath)) {
    socket.destroy();
    return;
  }
  if ((LOCAL || WIFI) && req.headers.origin !== undefined) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
    catch { socket.destroy(); return; }
  }
  secureWss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, `${req.socket.encrypted ? 'wss' : 'ws'}${wsPath}`));
}
server.on('upgrade', upgradeBrowser);

// The ESP32 socket also runs in Wi-Fi mode (hotspot demos), on the same address as the HTTPS pages.
if (!LOCAL) {
  const plainWss = new WebSocketServer({ port: PLAIN_PORT, ...(process.env.RELAY_HOST && { host: process.env.RELAY_HOST }) });
  plainWss.on('connection', (ws, req) => onConnection(ws, req, 'ws'));
  plainWss.on('listening', () => log(`Plain WebSocket (ESP32) on ws://<laptop>:${PLAIN_PORT}`));
}

server.on('error', (err) => { console.error(`Relay could not start: ${err.message}`); process.exit(1); });
server.listen(LOCAL ? LOCAL_PORT : HTTPS_PORT, LOCAL ? '127.0.0.1' : process.env.RELAY_HOST || undefined, () => {
  const port = server.address().port;
  const protocol = LOCAL ? 'http' : 'https';
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  log(`${LOCAL ? 'Local HTTP + WS (loopback only)' : 'HTTPS + WSS'} (/ws, /relay) on port ${port}`);
  log(HEADSET_IS_BUILT
    ? `Headset: serving the Vite build from ${path.relative(ROOT, BUILT_HEADSET)}/`
    : 'Headset: no build found (run npm run build in the repo root); serving unbuilt apps/headset/');
  for (const host of LOCAL ? ['127.0.0.1'] : process.env.RELAY_HOST ? [process.env.RELAY_HOST] : ['localhost', ...ips]) {
    console.log(`\n  ${host}`);
    for (const p of ['hub/', 'headset/', 'wrist/', 'debug']) console.log(`    ${protocol}://${host}:${port}/${p}`);
    if (!LOCAL && host !== 'localhost') console.log(`    ESP32: ws://${host}:${PLAIN_PORT}`);
  }
  console.log('');
});

// Laptop controls share this very same state with the Wi-Fi headset, without a second simulation.
if (WIFI && !LOCAL) {
  const laptop = http.createServer(onRequest);
  laptop.on('upgrade', upgradeBrowser);
  laptop.on('error', err => { console.error(`Laptop controls could not start: ${err.message}`); process.exit(1); });
  laptop.listen(LOCAL_PORT, '127.0.0.1', () => log(`Synced laptop controls: http://127.0.0.1:${laptop.address().port}/hub/`));
}

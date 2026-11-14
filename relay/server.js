// Beacon relay: serves the pages over HTTPS, holds the one state object and
// broadcasts it over WebSockets. Contracts: shared/state.md, events.md, waypoints.md.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
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
const SITE = (() => {
  const i = process.argv.indexOf('--site');
  const name = i >= 0 ? process.argv[i + 1] : process.env.SITE;
  if (!name) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Site name "${name}" must be letters, digits, - or _`);
  return name;
})();
const SITE_FILE = SITE ? path.join(ROOT, 'data/sites', SITE, 'site.json') : path.join(ROOT, 'data/site.json');
const DATA_OUT = SITE ? path.join(ROOT, 'data/out', SITE) : path.join(ROOT, 'data/out');
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
const { doc: waypoints, synthetic } = loadWaypoints();
const site = loadSite();
const earthDelayMinutes = typeof site.earthDelayMinutes === 'number' ? site.earthDelayMinutes : DEFAULT_EARTH_DELAY_MINUTES;
const WARNING_MINUTES_TO_SHELTER = typeof site.planner?.minutesToShelterLimit === 'number'
  ? site.planner.minutesToShelterLimit
  : DEFAULT_WARNING_MINUTES_TO_SHELTER;
log(`earthDelayMinutes = ${earthDelayMinutes}, warning above ${WARNING_MINUTES_TO_SHELTER} min to shelter`);

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
    // Optional addition (shared/state.md): which site the relay serves. Only sent when one was chosen.
    ...(SITE && { site: SITE }),
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
    // route. It must still start the storm, without rewinding another route.
    const startingStorm = ev.type === 'storm' && ev.on === true;
    if (!expected || expected.route !== sim.route || (!startingStorm && expected.waypointIndex !== sim.waypointIndex) ||
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
      Object.assign(sim, { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 });
      return true;
    default: return false;
  }
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
  if (urlPath === '/session.json') return send(res, 200, 'application/json', JSON.stringify({ version: 1, waypoints: '/mission/waypoints.json', synthetic, capabilities: { commandReplies: true } }));
  if (urlPath === '/mission/waypoints.json') return send(res, 200, 'application/json', JSON.stringify(waypoints));
  // The one file outside data/out/ that pages may read.
  if (urlPath === '/data/site.json') return serveFile(res, SITE_FILE);
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

if (!LOCAL && !WIFI) {
  const plainWss = new WebSocketServer({ port: PLAIN_PORT });
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
    if (!LOCAL && !WIFI && host !== 'localhost') console.log(`    ESP32: ws://${host}:${PLAIN_PORT}`);
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

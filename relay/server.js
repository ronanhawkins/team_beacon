// Beacon relay: serves the pages over HTTPS, holds the one state object and
// broadcasts it over WebSockets. Contracts: shared/state.md, events.md, waypoints.md.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');

// ---- Settings ---------------------------------------------------------------

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443; // pages + wss://…/ws for browsers
const PLAIN_PORT = Number(process.env.PLAIN_PORT) || 8081; // ws:// for the ESP32
const WARNING_MINUTES_TO_SHELTER = 5; // mode is "warning" above this
const DEFAULT_EARTH_DELAY_MINUTES = 14;
const PING_INTERVAL_MS = 15000;

const ROOT = path.resolve(__dirname, '..');
const CERT_DIR = path.join(__dirname, 'certs');

const MOUNTS = {
  '/hub/': path.join(ROOT, 'apps/hub'),
  '/headset/': path.join(ROOT, 'apps/headset'),
  '/wrist/': path.join(ROOT, 'apps/wrist'),
  '/shared/': path.join(ROOT, 'shared'),
  '/data/': path.join(ROOT, 'data/out'),
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
    : [path.join(ROOT, 'data/out/waypoints.json'), path.join(ROOT, 'shared/fake/waypoints.json')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error(`No waypoint file found. Tried: ${candidates.join(', ')}`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.main) || doc.main.length === 0) throw new Error(`${file}: "main" is empty`);
  log(`Loaded waypoints from ${path.relative(ROOT, file)} (${doc.main.length} main, ${Object.keys(doc.reroutes || {}).length} reroutes)`);
  return doc;
}

function loadEarthDelay() {
  const file = path.join(ROOT, 'data/site.json');
  try {
    const site = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof site.earthDelayMinutes === 'number') return site.earthDelayMinutes;
  } catch { /* missing or unreadable: use the default */ }
  return DEFAULT_EARTH_DELAY_MINUTES;
}

const waypoints = loadWaypoints();
const earthDelayMinutes = loadEarthDelay();
log(`earthDelayMinutes = ${earthDelayMinutes}`);

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
    mode: 'nominal',
    storm: sim.storm,
    panic: sim.panic,
    rerouteRequested: sim.rerouteRequested,
    headingDeg: wp.headingDeg,
    shelterBearingDeg: wp.shelter.az,
    minutesToShelter: wp.shelter.minutes,
    openSky: wp.openSky,
    doseFraction: wp.doseFraction,
    oxygenFraction: wp.oxygenFraction,
    sunlit: wp.sun.visible,
    baseLink: wp.base.visible,
    earthLink: wp.earth.visible,
    earthDelayMinutes,
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
  switch (ev.type) {
    case 'next': sim.waypointIndex = clampIndex(sim.waypointIndex + 1); return true;
    case 'back': sim.waypointIndex = clampIndex(sim.waypointIndex - 1); return true;
    case 'goto':
      if (!Number.isInteger(ev.index)) return false;
      sim.waypointIndex = clampIndex(ev.index);
      return true;
    case 'storm':
      if (typeof ev.on !== 'boolean') return false;
      if (ev.on) { sim.storm = true; switchToReroute(); return true; }
      sim.storm = false;
      if (sim.route === 'reroute' && !sim.panic && !sim.rerouteRequested) {
        sim.route = 'main';
        sim.waypointIndex = sim.rerouteFrom;
      }
      return true;
    case 'panic': sim.panic = true; switchToReroute(); return true;
    case 'requestReroute': sim.rerouteRequested = true; switchToReroute(); return true;
    case 'reset':
      Object.assign(sim, { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 });
      return true;
    default: return false;
  }
}

let state = buildState();

// ---- Clients ----------------------------------------------------------------

const clients = new Set(); // { ws, role, transport, address, since }

function sendState(client) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ type: 'state', state }));
}

function broadcast() {
  for (const c of clients) sendState(c);
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
    if (changed) broadcast();
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

const server = https.createServer(readCerts(), onRequest);
const secureWss = new WebSocketServer({ server, path: '/ws' });
secureWss.on('connection', (ws, req) => onConnection(ws, req, 'wss'));

const plainWss = new WebSocketServer({ port: PLAIN_PORT });
plainWss.on('connection', (ws, req) => onConnection(ws, req, 'ws'));
plainWss.on('listening', () => log(`Plain WebSocket (ESP32) on ws://<laptop>:${PLAIN_PORT}`));

server.listen(HTTPS_PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  log(`HTTPS + WSS on port ${HTTPS_PORT}`);
  for (const host of ['localhost', ...ips]) {
    console.log(`\n  ${host}`);
    for (const p of ['hub/', 'headset/', 'wrist/', 'debug']) console.log(`    https://${host}:${HTTPS_PORT}/${p}`);
    if (host !== 'localhost') console.log(`    ESP32: ws://${host}:${PLAIN_PORT}`);
  }
  console.log('');
});

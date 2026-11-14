import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { resolveSelection, validateRoute, validateState } from '../shared/model.js';
import { readState, readWaypoints } from '../apps/hub/route.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('laptop relay publishes its exact route and synchronises hub/headset through storm and reconnect', { timeout: 20000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'beacon-relay-'));
  const file = join(temp, 'waypoints.json');
  const doc = JSON.parse(await readFile(new URL('../shared/fake/waypoints.json', import.meta.url), 'utf8'));
  doc.main[0].label = 'Alternate relay route';
  await writeFile(file, JSON.stringify(doc));
  const child = spawn(process.execPath, ['relay/server.js', '--local'], {
    cwd: root, env: { ...process.env, LOCAL_PORT: '0', WAYPOINTS: file }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const clients = [];
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Relay startup timed out: ${logs}`)), 8000);
      child.once('error', err => { clearTimeout(timeout); reject(err); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Relay exited ${code}: ${logs}`)); });
      child.stdout.on('data', chunk => {
        logs += chunk;
        const match = logs.match(/Local HTTP .* on port (\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const session = await (await fetch(`${base}/session.json`)).json();
    assert.equal(session.synthetic, false);
    const route = validateRoute(await (await fetch(base + session.waypoints)).json());
    assert.deepEqual(route, doc);
    // Changing the on-disk export must not give a browser a different route from the running relay.
    await writeFile(file, JSON.stringify({ ...doc, main: doc.main.slice(0, 1) }));
    assert.deepEqual(await (await fetch(base + session.waypoints)).json(), doc);
    async function connect(path, role) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); clients.push(ws);
      const first = JSON.parse((await once(ws, 'message'))[0]).state;
      const hello = once(ws, 'message'); ws.send(JSON.stringify({ type: 'hello', role })); await hello;
      return { ws, first };
    }
    const hub = await connect('/ws', 'hub'), headset = await connect('/relay', 'headset');
    assert.deepEqual(hub.first, headset.first);
    async function event(ev) {
      const a = once(hub.ws, 'message'), b = once(headset.ws, 'message');
      hub.ws.send(JSON.stringify(ev));
      const [ra, rb] = await Promise.all([a, b]);
      assert.deepEqual(JSON.parse(ra[0]), JSON.parse(rb[0]));
      return validateState(JSON.parse(ra[0]).state, route);
    }
    assert.equal((await event({ type: 'goto', index: 3 })).waypointIndex, 3);
    assert.equal((await event({ type: 'storm', on: true })).rerouteFrom, 3);
    const walking = await event({ type: 'next' });
    assert.equal(resolveSelection(walking, route).point.id, 'r03-01');
    const reconnected = await connect('/relay', 'headset');
    assert.deepEqual(reconnected.first, walking);
    const hubRoute = readWaypoints(route, {});
    assert.equal(readState(walking, hubRoute, null).reroute.from, 3);
    // The identifier wins even when telemetry resembles another route (no heuristic override).
    assert.equal(readState({ ...walking, rerouteFrom: 4 }, hubRoute, null).reroute.from, 4);
    const shelter = await event({ type: 'next' });
    assert.equal(shelter.minutesToShelter, 0);
    const restored = await event({ type: 'storm', on: false });
    assert.equal(restored.route, 'main'); assert.equal(restored.waypointIndex, 3);
    const panic = await event({ type: 'panic' });
    assert.equal(panic.mode, 'storm'); assert.equal(panic.panic, true);
    assert.equal((await event({ type: 'reset' })).rerouteFrom, null);
    const roles = (await (await fetch(`${base}/clients`)).json()).map(c => c.role);
    assert.ok(roles.includes('hub') && roles.includes('headset'));
    assert.equal((await fetch(`${base}/hub/`)).status, 200);
    assert.equal((await fetch(`${base}/data/terrain/height_750.bin`)).headers.get('content-length'), '2250000');
  } finally {
    for (const ws of clients) ws.terminate();
    child.kill(); await exited;
    await unlink(file); await rmdir(temp);
  }
});

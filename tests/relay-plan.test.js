import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));

test('a plan from the hub runs the engine, replaces the route for every client and reports failures', { timeout: 20000 }, async () => {
  const plans = await mkdtemp(join(tmpdir(), 'beacon-plans-'));
  const child = spawn(process.execPath, ['relay/server.js', '--local'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LOCAL_PORT: '0', WAYPOINTS: join(root, 'shared/fake/waypoints.json'), BEACON_ENGINE: join(root, 'tests/fixtures/stub-engine.mjs'), BEACON_PLANS: plans },
  });
  const exited = once(child, 'exit'), clients = [];
  let logs = '';
  child.stderr.on('data', (c) => { logs += c; });
  try {
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Relay startup timed out: ' + logs)), 8000);
      child.once('exit', (code) => { clearTimeout(t); reject(new Error(`Relay exited ${code}: ${logs}`)); });
      child.stdout.on('data', (c) => { logs += c; const m = logs.match(/Local HTTP .* on port (\d+)/); if (m) { clearTimeout(t); resolve(+m[1]); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const before = await (await fetch(`${base}/mission/waypoints.json`)).json();
    assert.equal((await (await fetch(`${base}/session.json`)).json()).planId, null);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); clients.push(ws);
    await once(ws, 'message');
    // Collects states until one passes the test.
    const until = (ok) => new Promise((resolve) => { const on = (d) => { const s = JSON.parse(d).state; if (s && ok(s)) { ws.off('message', on); resolve(s); } }; ws.on('message', on); });
    const pts = (name) => [{ x: 1300, y: 1300, kind: 'start' }, { x: 1400, y: 1400, kind: 'stop', name }, { x: 1500, y: 1500, kind: 'end' }];

    // outside plannerBounds (data/site.json): refused before the engine runs
    let wait = until((s) => s.plan); ws.send(JSON.stringify({ type: 'plan', points: [{ x: 0, y: 0 }, { x: 1500, y: 1500 }] }));
    let s = await wait; assert.equal(s.plan.status, 'error'); assert.match(s.plan.message, /outside the planned area/);

    // the engine fails: the old route stays
    wait = until((x) => x.plan && x.plan.status === 'error' && x.plan.id > s.plan.id); ws.send(JSON.stringify({ type: 'plan', points: pts('fail') }));
    s = await wait; assert.match(s.plan.message, /no walkable path/); assert.equal(s.plan.routeId, null);
    assert.deepEqual(await (await fetch(`${base}/mission/waypoints.json`)).json(), before);

    // the engine succeeds: running, then done, with the new route served to everyone
    await (async () => { const w = until((x) => x.waypointIndex === 2); ws.send(JSON.stringify({ type: 'goto', index: 2 })); await w; })();
    const running = until((x) => x.plan && x.plan.status === 'running'), done = until((x) => x.plan && x.plan.status === 'done');
    ws.send(JSON.stringify({ type: 'plan', points: pts('Quela; drill, site') }));
    await running; s = await done;
    assert.equal(s.plan.routeId, s.plan.id); assert.equal(s.waypointIndex, 0); assert.equal(s.route, 'main');
    assert.match(s.plan.message, /astronaut's position/);
    const after = await (await fetch(`${base}/mission/waypoints.json`)).json();
    assert.equal(after.main[2].label, 'Quela drill site');
    assert.deepEqual(after.main[0].pos.x, before.main[2].pos.x); // mid-walk plans start where the astronaut is
    assert.equal((await (await fetch(`${base}/session.json`)).json()).planId, s.plan.id);
    assert.equal((await (await fetch(`${base}/mission/briefing.json`)).json()).stub, true);
    assert.equal((await fetch(`${base}/mission/terrain/terrain.json`)).status, 200); // falls back to the site's data/out
    assert.equal((await fetch(`${base}/mission/../relay/server.js`)).status, 404);

    // reset with example: true puts back the site's example route; a plain reset keeps the planned one
    await (async () => { const w = until((x) => x.waypointIndex === 0 && x.plan.routeId === s.plan.id); ws.send(JSON.stringify({ type: 'goto', index: 1 })); ws.send(JSON.stringify({ type: 'reset' })); await w; })();
    assert.equal((await (await fetch(`${base}/mission/waypoints.json`)).json()).main[2].label, 'Quela drill site');
    wait = until((x) => x.plan && x.plan.routeId === null); ws.send(JSON.stringify({ type: 'reset', example: true, requestId: 'a-press' }));
    const ex = await wait; assert.equal(ex.waypointIndex, 0); assert.match(ex.plan.message, /Example route/);
    assert.deepEqual(await (await fetch(`${base}/mission/waypoints.json`)).json(), before);
    assert.equal((await (await fetch(`${base}/session.json`)).json()).planId, null);
    // plan again so the storm check below has a planned route in use
    wait = until((x) => x.plan && x.plan.status === 'done' && x.plan.routeId != null); ws.send(JSON.stringify({ type: 'plan', points: pts('Again') }));
    s = await wait;

    // cancelReroute turns off SOS and the reroute request together and returns to the main route where it began
    await (async () => { const w = until((x) => x.waypointIndex === 2 && x.route === 'main'); ws.send(JSON.stringify({ type: 'goto', index: 2 })); await w; })();
    wait = until((x) => x.panic && x.rerouteRequested); ws.send(JSON.stringify({ type: 'requestReroute' })); ws.send(JSON.stringify({ type: 'panic' }));
    assert.equal((await wait).route, 'reroute');
    wait = until((x) => !x.panic && !x.rerouteRequested); ws.send(JSON.stringify({ type: 'cancelReroute' }));
    const cleared = await wait; assert.equal(cleared.route, 'main'); assert.equal(cleared.waypointIndex, 2); assert.equal(cleared.mode === 'storm', false);

    // no new plans during a storm
    await (async () => { const w = until((x) => x.storm); ws.send(JSON.stringify({ type: 'storm', on: true })); await w; })();
    wait = until((x) => x.plan && x.plan.id > s.plan.id); ws.send(JSON.stringify({ type: 'plan', points: pts('x') }));
    const storm = await wait; assert.equal(storm.plan.status, 'error'); assert.equal(storm.plan.routeId, s.plan.id);
    // during a storm, cancelReroute clears SOS but keeps the shelter route
    wait = until((x) => x.panic); ws.send(JSON.stringify({ type: 'panic' })); await wait;
    wait = until((x) => !x.panic); ws.send(JSON.stringify({ type: 'cancelReroute' }));
    const stormy = await wait; assert.equal(stormy.route, 'reroute'); assert.equal(stormy.storm, true);
  } finally {
    for (const ws of clients) ws.terminate();
    child.kill(); await exited; await rm(plans, { recursive: true, force: true });
  }
});

test('the relay switches site at run time: /sites.json lists both, the site event swaps /data/ and the route', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ['relay/server.js', '--local'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LOCAL_PORT: '0', WAYPOINTS: '', SITE: '', BEACON_ENGINE: join(root, 'tests/fixtures/stub-engine.mjs') },
  });
  const exited = once(child, 'exit');
  let logs = '', ws = null;
  child.stderr.on('data', (c) => { logs += c; });
  try {
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Relay startup timed out: ' + logs)), 8000);
      child.once('exit', (code) => { clearTimeout(t); reject(new Error(`Relay exited ${code}: ${logs}`)); });
      child.stdout.on('data', (c) => { logs += c; const m = logs.match(/Local HTTP .* on port (\d+)/); if (m) { clearTimeout(t); resolve(+m[1]); } });
    });
    const base = `http://127.0.0.1:${port}`, get = async (p) => (await fetch(base + p)).json();
    const list = await get('/sites.json');
    assert.equal(list.current, 'gale');
    assert.deepEqual(list.sites.map((x) => x.id).sort(), ['gale', 'jezero']);
    const gale = list.sites.find((x) => x.id === 'gale'), jez = list.sites.find((x) => x.id === 'jezero');
    assert.ok(Math.abs(gale.lat - -4.7) < 0.2 && Math.abs(gale.lon - 137.4) < 0.2, 'Gale near 4.7 S 137.4 E');
    assert.ok(Math.abs(jez.lat - 18.4) < 0.5 && Math.abs(jez.lon - 77.4) < 0.5, 'Jezero near 18.4 N 77.4 E');
    const galeRoute = await get('/mission/waypoints.json');

    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const first = JSON.parse((await once(ws, 'message'))[0]).state; assert.equal(first.site, 'gale');
    const until = (ok) => new Promise((resolve) => { const on = (d) => { const s = JSON.parse(d).state; if (s && ok(s)) { ws.off('message', on); resolve(s); } }; ws.on('message', on); });
    await (async () => { const w = until((x) => x.waypointIndex === 2); ws.send(JSON.stringify({ type: 'goto', index: 2 })); await w; })();

    let wait = until((x) => x.site === 'jezero'); ws.send(JSON.stringify({ type: 'site', name: 'jezero' }));
    const j = await wait; assert.equal(j.waypointIndex, 0); assert.equal(j.route, 'main');
    assert.match((await get('/data/site.json')).site, /Jezero/);
    assert.notDeepEqual((await get('/mission/waypoints.json')).main[1], galeRoute.main[1]);
    assert.equal((await get('/sites.json')).current, 'jezero');

    // unknown or unsafe names are ignored; the next accepted event shows the site did not change
    ws.send(JSON.stringify({ type: 'site', name: 'nowhere' })); ws.send(JSON.stringify({ type: 'site', name: '../data' }));
    wait = until((x) => x.waypointIndex === 1); ws.send(JSON.stringify({ type: 'next' }));
    assert.equal((await wait).site, 'jezero');

    wait = until((x) => x.site === 'gale'); ws.send(JSON.stringify({ type: 'site', name: 'gale' })); await wait;
    assert.deepEqual((await get('/mission/waypoints.json')).main[1], galeRoute.main[1]);
  } finally {
    if (ws) ws.terminate();
    child.kill(); await exited;
  }
});

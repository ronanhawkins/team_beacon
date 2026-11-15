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

    // no new plans during a storm
    await (async () => { const w = until((x) => x.storm); ws.send(JSON.stringify({ type: 'storm', on: true })); await w; })();
    wait = until((x) => x.plan && x.plan.id > s.plan.id); ws.send(JSON.stringify({ type: 'plan', points: pts('x') }));
    const storm = await wait; assert.equal(storm.plan.status, 'error'); assert.equal(storm.plan.routeId, s.plan.id);
  } finally {
    for (const ws of clients) ws.terminate();
    child.kill(); await exited; await rm(plans, { recursive: true, force: true });
  }
});

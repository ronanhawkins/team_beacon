import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const site of ['', 'jezero']) {
  test(`native walking and shelter requests stay consistent across every ${site || 'Gale'} route`, { timeout: 30000 }, async () => {
    const env = { ...process.env, LOCAL_PORT: '0', SITE: site };
    delete env.WAYPOINTS;
    const child = spawn(process.execPath, ['relay/server.js', '--local'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let logs = '', ws;
    child.stderr.on('data', chunk => { logs += chunk; });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Relay startup timeout: ${logs}`)), 8000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Relay exit ${code}: ${logs}`)); });
        child.stdout.on('data', chunk => {
          logs += chunk;
          const match = logs.match(/Local HTTP .* on port (\d+)/);
          if (match) { clearTimeout(timer); resolve(Number(match[1])); }
        });
      });
      const base = `http://127.0.0.1:${port}`;
      const session = await (await fetch(`${base}/session.json`)).json();
      assert.equal(session.capabilities.commandReplies, true, 'launcher can detect command acknowledgement support');
      const doc = await (await fetch(base + session.waypoints)).json();
      const metadata = await (await fetch(base + '/data/site.json')).json();
      assert.ok(metadata.site.includes(site ? 'Jezero' : 'Gale'));
      ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
      let state = JSON.parse((await once(ws, 'message'))[0]).state;
      let replyTo;
      const expected = () => ({ route: state.route, waypointIndex: state.waypointIndex, rerouteFrom: state.rerouteFrom });
      async function event(payload) {
        const reply = once(ws, 'message', { signal: AbortSignal.timeout(3000) });
        ws.send(JSON.stringify(payload));
        const message = JSON.parse((await reply)[0]);
        assert.equal(message.type, 'state');
        replyTo = message.replyTo;
        state = message.state;
        const path = state.route === 'main' ? doc.main : doc.reroutes[String(state.rerouteFrom)];
        const point = path[state.waypointIndex];
        assert.equal(state.openSky, point.openSky);
        assert.equal(state.minutesToShelter, point.shelter.minutes);
        assert.equal(state.doseFraction, point.doseFraction);
        return state;
      }
      async function ignored(payload) {
        // WebSocket messages are ordered. Hello returns the state after the
        // ignored event without relying on a timeout or an arbitrary sleep.
        ws.send(JSON.stringify(payload));
        return event({ type: 'hello', role: 'native-walk-test' });
      }
      for (let origin = 0; origin < doc.main.length; origin++) {
        if (origin > 0) await event({ type: 'reset' });
        const request = { type: 'requestReroute', atIndex: origin, expected: expected() };
        await event(request);
        assert.equal(state.rerouteFrom, origin);
        assert.equal(state.rerouteRequested, true);
        assert.equal(state.storm, false);
        const selected = structuredClone(state);
        assert.deepEqual(await ignored(request), selected, 'late request must not change an active shelter route');
        const path = doc.reroutes[String(origin)];
        for (let i = 1; i < path.length; i++) {
          const step = { type: 'next', expected: expected() };
          await event(step); assert.equal(state.waypointIndex, i);
          const reached = structuredClone(state);
          assert.deepEqual(await ignored(step), reached, 'replayed arrival must not skip another point');
        }
        assert.equal(path[state.waypointIndex].isShelter, true);
        assert.equal(state.minutesToShelter, 0);
      }
      await event({ type: 'reset' });
      const initial = structuredClone(state);
      for (const atIndex of [-1, doc.main.length, 1.5, '2'])
        assert.deepEqual(await ignored({ type: 'requestReroute', atIndex }), initial, 'invalid position leaves the state untouched');
      const oldStep = { type: 'next', expected: expected() };
      await event({ type: 'storm', on: true });
      const emergency = structuredClone(state);
      assert.deepEqual(await ignored(oldStep), emergency, 'a late main-route step must not advance an emergency route');
      await event({ type: 'reset', requestId: 'a-reset' });
      assert.equal(replyTo, 'a-reset');
      assert.equal(state.route, 'main'); assert.equal(state.waypointIndex, 0);
      assert.equal(state.storm, false); assert.equal(state.panic, false); assert.equal(state.rerouteRequested, false);
      await event({ type: 'reset', requestId: 'a-reset-again' });
      assert.equal(replyTo, 'a-reset-again', 'an unchanged reset still confirms the native VR reposition');
      const baseState = structuredClone(state);
      for (const atIndex of [-1, doc.main.length, 1.5, '2'])
        assert.deepEqual(await ignored({ type: 'storm', on: true, atIndex, requestId: 'invalid-origin' }), baseState, 'invalid storm origin changes no flags');
      const origin = doc.main.length - 1;
      const stormRequest = { type: 'storm', on: true, atIndex: origin, expected: expected(), requestId: 'b-storm' };
      await event({ type: 'next', expected: expected() });
      await event(stormRequest);
      assert.equal(replyTo, 'b-storm'); assert.equal(state.storm, true); assert.equal(state.mode, 'storm');
      assert.equal(state.rerouteFrom, origin); assert.equal(state.waypointIndex, 0);
      assert.equal(state.panic, false); assert.equal(state.rerouteRequested, false);
      const atStorm = structuredClone(state);
      assert.deepEqual(await ignored(stormRequest), atStorm, 'stale B origin never restarts a diversion');
      await event({ type: 'next', expected: expected() });
      const alongDiversion = structuredClone(state);
      await event({ type: 'storm', on: true, expected: expected(), requestId: 'b-already-storm' });
      assert.equal(replyTo, 'b-already-storm'); assert.deepEqual(state, alongDiversion, 'B is idempotent and keeps diversion progress');
      const delayedStep = { type: 'next', expected: expected() };
      await event({ type: 'reset', requestId: 'a-after-storm' });
      assert.equal(replyTo, 'a-after-storm'); assert.equal(state.route, 'main'); assert.equal(state.waypointIndex, 0);
      assert.equal(state.storm, false);
      const resetState = structuredClone(state);
      assert.deepEqual(await ignored(delayedStep), resetState, 'late shelter step cannot move the reset mission');
    } finally {
      ws?.terminate();child.kill();await exited;
    }
  });
}

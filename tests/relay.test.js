import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { demoRelay } from '../tools/demo-relay.js';
import { resolveSelection } from '../shared/model.js';
const route = JSON.parse(readFileSync(new URL('../shared/fake/waypoints.json', import.meta.url)));

test('two screens synchronise shared events, reconnect mid-reroute, and ignore unknown events', { timeout: 15000 }, async () => {
  const server = await createServer({ configFile: false, plugins: [demoRelay()], server: { host: '127.0.0.1', port: 0 } });
  const clients = [];
  try {
    await server.listen();
    const url = `ws://127.0.0.1:${server.httpServer.address().port}/relay`;
    async function client() {
      const ws = new WebSocket(url); clients.push(ws);
      const [data] = await once(ws, 'message'); return [ws, JSON.parse(data).state];
    }
    const [a, firstA] = await client(), [b, firstB] = await client();
    assert.deepEqual(firstA, firstB);
    const hello = once(a, 'message'); a.send(JSON.stringify({ type: 'hello', role: 'headset' }));
    assert.deepEqual(JSON.parse((await hello)[0]).state, firstA);
    async function event(payload) {
      const pa = once(a, 'message'), pb = once(b, 'message'); a.send(JSON.stringify(payload));
      const [ra, rb] = await Promise.all([pa, pb]);
      assert.deepEqual(JSON.parse(ra[0]), JSON.parse(rb[0])); return JSON.parse(ra[0]).state;
    }
    assert.equal((await event({ type: 'goto', index: 3 })).waypointIndex, 3);
    assert.equal((await event({ type: 'storm', on: true })).rerouteFromIndex, 3);
    const moving = await event({ type: 'next' }); assert.equal(resolveSelection(moving, route).point.id, 'r03-01');
    const [, reconnect] = await client(); assert.deepEqual(reconnect, moving);
    const malformed = once(a, 'message'); a.send('not json'); assert.equal(JSON.parse((await malformed)[0]).type, 'error');
    a.send(JSON.stringify({ type: 'future-event' }));
    assert.equal((await event({ type: 'reset' })).route, 'main');
    assert.equal((await event({ type: 'requestReroute' })).rerouteRequested, true);
    assert.equal((await event({ type: 'panic' })).mode, 'storm');
  } finally { for (const ws of clients) ws.terminate(); await server.close(); }
});

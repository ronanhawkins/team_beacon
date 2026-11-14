import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { direction, sitePosition, openSkyPct, sampleSkyline, blendAngle, blendWaypoints, validateRoute, validateState, reduceDemoState, resolveSelection, scenePoint } from '../shared/model.js';
import { relayUrl, connectRelay } from '../shared/socket.js';

const fixture = name => JSON.parse(readFileSync(new URL(`../shared/fake/${name}.json`, import.meta.url)));
const route = fixture('waypoints'), state = fixture('state'), storm = fixture('state-storm');
const step = (current, event) => reduceDemoState(current, event, route, state);

test('Ronan’s unchanged fixtures are consumed directly, including a fresh storm connection', () => {
  assert.equal(validateRoute(route), route);
  assert.equal(validateState(state, route), state);
  assert.equal(validateState(storm, route), storm);
  assert.equal(resolveSelection(storm, route).point.id, 'r03-00');
});
test('angle and position conversion preserve east/north/up and negative Mars heights', () => {
  assert.deepEqual(direction(0, 0), [0, 0, -1]);
  assert.ok(Math.abs(direction(90, 0)[0] - 1) < 1e-10);
  assert.ok(Math.abs(direction(0, 90)[1] - 1) < 1e-10);
  assert.deepEqual(sitePosition({ x: 412, y: 268, z: -4431.2 }), [412, -4431.2, -268]);
});
test('solid-angle open sky is 100% at flat horizon, 50% at 30°, 0% at zenith', () => {
  assert.equal(openSkyPct(Array(72).fill(0)), 100);
  assert.ok(Math.abs(openSkyPct(Array(72).fill(30)) - 50) < 1e-10);
  assert.equal(openSkyPct(Array(72).fill(90)), 0);
  assert.equal(openSkyPct(Array(72).fill(-10)), 100);
  for (const point of route.main) assert.ok(Math.abs(openSkyPct(point.skyline) / 100 - point.openSky) < .005);
});
test('skyline and marker interpolation wrap through north without a long rotation', () => {
  assert.equal(sampleSkyline([0, 10, 20, 30], 315), 15);
  assert.equal(sampleSkyline([0, 10, 20, 30], -45), 15);
  assert.equal(blendAngle(350, 10, .5), 0);
  const a = scenePoint(route.main[0]), b = scenePoint(route.main[1]);
  a.skylineDeg = Array(72).fill(0); b.skylineDeg = Array(72).fill(20);
  assert.deepEqual(blendWaypoints(a, b, .5).skylineDeg, Array(72).fill(10));
});
test('scene respects supplied visibility and treats base/shelter as bearings only', () => {
  const point = scenePoint(route.main.at(-1));
  assert.equal(point.markers.earth.visible, false);
  assert.equal(point.markers.base.visible, false);
  assert.equal(point.markers.base.bearingOnly, true);
  assert.equal(point.markers.shelter.bearingOnly, true);
  assert.equal(point.markers.shelter.elevationDeg, 0);
});
test('rejects wrong fractions, malformed skylines and invalid telemetry while tolerating additive fields', () => {
  const bad = structuredClone(route); bad.main[0].skyline[0] = NaN; assert.throws(() => validateRoute(bad));
  const duplicate = structuredClone(route); duplicate.main[1].id = duplicate.main[0].id; assert.throws(() => validateRoute(duplicate));
  for (const patch of [{ oxygenFraction: 86 }, { doseFraction: -.1 }, { waypointIndex: 99 }, { storm: 'true' }, { mode: 'safe' }, { earthDelayMinutes: NaN }]) assert.throws(() => validateState({ ...state, ...patch }, route));
  assert.equal(validateState({ ...state, futureField: 'allowed' }, route).futureField, 'allowed');
});
test('next/back/goto follow the main route and refresh all telemetry', () => {
  assert.equal(step(state, { type: 'back' }).waypointIndex, 0);
  const next = step(state, { type: 'next' });
  assert.equal(next.waypointIndex, 1);
  assert.equal(next.oxygenFraction, route.main[1].oxygenFraction);
  assert.equal(next.doseFraction, route.main[1].doseFraction);
  assert.equal(step(state, { type: 'goto', index: 999 }).waypointIndex, route.main.length - 1);
  assert.throws(() => step(state, { type: 'goto', index: 1.5 }));
});
test('storm at main 3 selects reroute 3, advances to shelter, and reset returns to main', () => {
  const atThree = step(state, { type: 'goto', index: 3 });
  const alert = step(atThree, { type: 'storm', on: true });
  assert.deepEqual(Object.fromEntries(Object.keys(storm).map(key => [key, alert[key]])), storm);
  assert.equal(alert.rerouteFromIndex, 3);
  let current = alert;
  for (let i = 0; i < 10; i++) current = step(current, { type: 'next' });
  assert.equal(resolveSelection(current, route).point.isShelter, true);
  assert.equal(current.minutesToShelter, 0);
  assert.deepEqual(step(current, { type: 'reset' }), state);
});
test('requestReroute does not invent a storm; panic does, and clearing storm does not clear panic', () => {
  const request = step(state, { type: 'requestReroute' });
  assert.equal(request.route, 'reroute'); assert.equal(request.rerouteRequested, true); assert.equal(request.storm, false);
  const panic = step(request, { type: 'panic' }); assert.equal(panic.mode, 'storm');
  assert.equal(step(panic, { type: 'storm', on: false }).mode, 'storm');
  assert.equal(step(state, { type: 'unknown-future-event' }), state);
});
test('base-link loss triggers demo warning, without inventing an agreed shelter-time limit', () => {
  const warning = step(state, { type: 'goto', index: 3 });
  assert.equal(warning.baseLink, false); assert.equal(warning.mode, 'warning');
  assert.equal(state.mode, 'nominal');
});
test('ambiguous reconnect never guesses a reroute; explicit origin and continuous history resolve it', () => {
  const ambiguous = structuredClone(route);
  ambiguous.reroutes['2'][0] = { ...structuredClone(ambiguous.reroutes['3'][0]), id: 'different-id' };
  validateRoute(ambiguous);
  assert.throws(() => resolveSelection(storm, ambiguous), /ambiguous/);
  assert.equal(resolveSelection({ ...storm, rerouteFromIndex: 3 }, ambiguous).point.id, 'r03-00');
  const prior = resolveSelection({ ...state, waypointIndex: 3 }, ambiguous);
  assert.equal(resolveSelection(storm, ambiguous, prior).point.id, 'r03-00');
});
test('secure pages use a secure WebSocket', () => {
  assert.equal(relayUrl({ protocol: 'https:', host: 'demo.example' }), 'wss://demo.example/relay');
});
test('browser sends hello on every connection and typed events, and accepts state without sequence/timestamp', async () => {
  const sockets = [], received = [], statuses = [];
  class Socket {
    readyState = 1; sent = [];
    constructor() { sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.onclose?.(); }
  }
  const connection = connectRelay({ url: 'ws://localhost/relay', WebSocketImpl: Socket, retryDelay: 1,
    onState: next => received.push(next), onStatus: value => statuses.push(value), onError: () => {} });
  try {
    sockets[0].onopen();
    assert.deepEqual(sockets[0].sent[0], { type: 'hello', role: 'headset', version: 1 });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'state', state: storm }) });
    assert.deepEqual(received, [storm]);
    connection.send({ type: 'requestReroute' });
    assert.deepEqual(sockets[0].sent[1], { version: 1, type: 'requestReroute' });
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 20));
    sockets[1].onopen();
    assert.equal(sockets[1].sent[0].type, 'hello');
    assert.ok(statuses.includes('offline'));
  } finally { connection.close(); }
});

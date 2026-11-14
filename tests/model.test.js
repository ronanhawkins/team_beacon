import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { direction, openSkyPct, sampleSkyline, blendAngle, blendWaypoints, validateRoute, validateState, reduceDemoState } from '../shared/model.js';
import { relayUrl } from '../shared/socket.js';

const route=JSON.parse(readFileSync(new URL('../shared/fake-waypoints.json',import.meta.url)));
const state=JSON.parse(readFileSync(new URL('../shared/fake-state.json',import.meta.url)));
test('fake files satisfy the documented contract',()=>{assert.equal(validateRoute(route),route);assert.equal(validateState(state,route),state);});
test('azimuth convention is north -Z, east +X, up +Y',()=>{
  assert.deepEqual(direction(0,0),[0,0,-1]);
  assert.ok(Math.abs(direction(90,0)[0]-1)<1e-10);
  assert.ok(Math.abs(direction(0,90)[1]-1)<1e-10);
});
test('hemisphere solid angle is 100% at flat horizon, 50% at 30 degrees, 0% at zenith',()=>{
  assert.equal(openSkyPct(Array(72).fill(0)),100);
  assert.ok(Math.abs(openSkyPct(Array(72).fill(30))-50)<1e-10);
  assert.equal(openSkyPct(Array(72).fill(90)),0);
  assert.equal(openSkyPct(Array(72).fill(-10)),100);
});
test('skyline interpolation wraps correctly across north',()=>{
  assert.equal(sampleSkyline([0,10,20,30],315),15);
  assert.equal(sampleSkyline([0,10,20,30],-45),15);
  assert.equal(sampleSkyline([0,10,20,30],360),0);
});
test('marker interpolation takes short arc through 0 degrees',()=>{assert.equal(blendAngle(350,10,.5),0);assert.equal(blendAngle(10,350,.5),0);});
test('waypoint blend supports different skyline resolutions',()=>{
  const a=structuredClone(route.waypoints[0]),b=structuredClone(route.waypoints[1]);
  a.skylineDeg=Array(8).fill(0);b.skylineDeg=Array(16).fill(20);
  assert.deepEqual(blendWaypoints(a,b,.5).skylineDeg,Array(16).fill(10));
});
test('rejects malformed routes and telemetry before rendering',()=>{
  const bad=structuredClone(route);bad.waypoints[0].skylineDeg[0]=NaN;assert.throws(()=>validateRoute(bad));
  const duplicate=structuredClone(route);duplicate.waypoints[1].id=duplicate.waypoints[0].id;assert.throws(()=>validateRoute(duplicate));
  for(const patch of [{oxygenPct:101},{waypointId:'missing'},{storm:'true'},{doseMicroSv:-1},{sequence:1.2},{updatedAt:'invalid'}])assert.throws(()=>validateState({...state,...patch},route));
});
test('demo steps clamp at route edges and update waypoint telemetry',()=>{
  const back=reduceDemoState(state,{action:'back'},route,state);assert.equal(back.waypointId,state.waypointId);
  const next=reduceDemoState(state,{action:'next'},route,state);assert.equal(next.waypointId,route.waypoints[1].id);assert.equal(next.minutesToShelter,route.waypoints[1].minutesToShelter);assert.equal(next.sequence,1);
});
test('storm and scripted shelter destination synchronize, reset restores initial values',()=>{
  const alert=reduceDemoState(state,{action:'storm'},route,state);assert.equal(alert.storm,true);
  const panic=reduceDemoState(alert,{action:'panic'},route,state);assert.equal(panic.waypointId,'shelter');assert.equal(panic.minutesToShelter,0);assert.equal(panic.contact,'blocked');
  const reset=reduceDemoState(panic,{action:'reset'},route,state);assert.equal(reset.waypointId,state.waypointId);assert.equal(reset.storm,false);assert.equal(reset.sequence,3);
  assert.equal(reduceDemoState(state,{action:'unknown'},route,state),state);
});
test('secure pages use secure WebSocket transport',()=>{
  assert.equal(relayUrl({protocol:'https:',host:'demo.example'}),'wss://demo.example/relay');
  assert.equal(relayUrl({protocol:'http:',host:'localhost:5173'}),'ws://localhost:5173/relay');
});

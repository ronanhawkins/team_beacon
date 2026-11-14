// Presenter rehearsal: run only while the wearer keeps Beacon open.
// No simulated walking or independently calculated mission readings.
import WebSocket from 'ws';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root='http://127.0.0.1:5174';
const quick=process.argv.includes('--quick');
const clients=await (await fetch(root+'/clients')).json();
assert.ok(clients.some(c=>c.role==='headset-unity'),'Wear the Quest with Beacon open and USB connected first.');
const doc=await (await fetch(root+'/mission/waypoints.json')).json();
const ws=new WebSocket(root.replace('http:','ws:')+'/ws');
let state=JSON.parse((await once(ws,'message'))[0]).state;
const timeline=[];
const hold=ms=>new Promise(resolve=>setTimeout(resolve,quick ? Math.min(ms,200):ms));
async function send(event) {
    const reply=once(ws,'message',{signal:AbortSignal.timeout(5000)});
    ws.send(JSON.stringify(event)); state=JSON.parse((await reply)[0]).state;
    const path=state.route==='main' ? doc.main:doc.reroutes[String(state.rerouteFrom)];
    const point=path[state.waypointIndex];
    assert.equal(state.openSky,point.openSky); assert.equal(state.sunlit,point.sun.visible);
    assert.equal(state.baseLink,point.base.visible); assert.equal(state.minutesToShelter,point.shelter.minutes);
    timeline.push({time:new Date().toISOString(),event,waypoint:point.id,mode:state.mode,openSky:state.openSky,minutes:state.minutesToShelter});
    console.log(`${point.id}: ${state.mode}, ${(state.openSky*100).toFixed(1)}% open, ${state.minutesToShelter.toFixed(2)} min`);
    return point;
}
try {
    await send({type:'hello',role:'quest-demo-check',version:1});
    if(state.route!=='main'||state.waypointIndex!==0||state.storm||state.panic||state.rerouteRequested) await send({type:'reset'});
    await hold(3000);
    for(let i=1;i<doc.main.length;i++) {
        const point=await send({type:'goto',index:i});
        if(!point.base.visible) assert.equal(state.mode,'warning');
        await hold(i===19 ? 5000:i===25 ? 3500:i===30 ? 4000:1000);
    }
    await send({type:'storm',on:true});
    const origin=String(doc.main.length-1);
    assert.equal(state.rerouteFrom,Number(origin)); assert.equal(state.route,'reroute');
    const chosen=doc.rerouteInfo[origin];
    assert.equal(chosen.chosen.id,doc.reroutes[origin].at(-1).shelter.id);
    await hold(6000);
    let arrival;
    arrival=doc.reroutes[origin][0];
    for(let i=1;i<doc.reroutes[origin].length;i++) { arrival=await send({type:'next'}); await hold(1000); }
    assert.ok(arrival.isShelter); assert.equal(state.minutesToShelter,0); assert.equal(state.baseLink,arrival.base.visible);
    await hold(6000);
} finally {
    if(ws.readyState===WebSocket.OPEN) {
        if(state.route!=='main'||state.waypointIndex!==0||state.storm||state.panic) await send({type:'reset'});
        await hold(3000); ws.close();
    }
    const folder=new URL('../.local/',import.meta.url); await mkdir(folder,{recursive:true});
    await writeFile(new URL('quest-demo-timeline.json',folder),JSON.stringify(timeline,null,2));
}
console.log('Full route, storm diversion, arrival and reset passed. Timeline: '+fileURLToPath(new URL('../.local/quest-demo-timeline.json',import.meta.url)));

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { once } from 'node:events';
import { demoRelay } from '../tools/demo-relay.js';

test('two clients receive identical state, malformed messages do not break the relay, reconnect gets snapshot', {timeout:15000}, async()=>{
  const server=await createServer({configFile:false,plugins:[demoRelay()],server:{host:'127.0.0.1',port:0}});
  const clients=[];
  try {
    await server.listen();
    const url=`ws://127.0.0.1:${server.httpServer.address().port}/relay`;
    async function client(){const ws=new WebSocket(url);clients.push(ws);const [data]=await once(ws,'message');return [ws,JSON.parse(data).state];}
    const [a,initialA]=await client();const [b,initialB]=await client();assert.deepEqual(initialA,initialB);
    async function command(action){const pa=once(a,'message'),pb=once(b,'message');a.send(JSON.stringify({type:'command',action}));const [ra,rb]=await Promise.all([pa,pb]);assert.deepEqual(JSON.parse(ra[0]),JSON.parse(rb[0]));return JSON.parse(ra[0]).state;}
    assert.equal((await command('next')).waypointId,'approach');
    assert.equal((await command('storm')).storm,true);
    assert.equal((await command('panic')).waypointId,'shelter');
    const malformed=once(a,'message');a.send('not json');assert.equal(JSON.parse((await malformed)[0]).type,'error');
    const [,reconnected]=await client();assert.equal(reconnected.waypointId,'shelter');assert.equal(reconnected.storm,true);
    assert.equal((await command('reset')).storm,false);
  } finally {for(const ws of clients)ws.terminate();await server.close();}
});

import { WebSocketServer } from 'ws';
import { readFileSync } from 'node:fs';
import { validateRoute, validateState, reduceDemoState } from '../shared/model.js';

export function demoRelay() {
  function attach(server) {
    const route = validateRoute(JSON.parse(readFileSync(new URL('../shared/fake-waypoints.json', import.meta.url))));
    const initial = validateState(JSON.parse(readFileSync(new URL('../shared/fake-state.json', import.meta.url))), route);
    let state = { ...initial, updatedAt: new Date().toISOString() };
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    function upgrade(request, socket, head) {
      if (request.url?.split('?')[0] !== '/relay') return;
      // Same-origin browser clients only. This is a development simulator, not the ESP relay.
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) { socket.destroy(); return; }
      wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
    }
    server.httpServer.on('upgrade', upgrade);
    const send = ws => ws.send(JSON.stringify({ type: 'state', state }));
    wss.on('connection', ws => {
      send(ws);
      ws.on('error', () => {});
      ws.on('message', bytes => {
        try {
          const command = JSON.parse(bytes.toString());
          if (command.type !== 'command' || !['next', 'back', 'storm', 'panic', 'reset'].includes(command.action)) throw new Error('Unsupported demo command');
          state = reduceDemoState(state, command, route, initial);
          for (const client of wss.clients) if (client.readyState === 1) send(client);
        } catch (error) { ws.send(JSON.stringify({ type: 'error', message: error.message })); }
      });
    });
    server.httpServer.once('close', () => { for (const ws of wss.clients) ws.terminate(); wss.close(); });
  }
  return { name: 'beacon-local-demo-relay', configureServer: attach, configurePreviewServer: attach };
}

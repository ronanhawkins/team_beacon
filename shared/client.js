// Beacon relay client for the browser pages. No dependencies.
//
//   import { connect } from '/shared/client.js';
//   const relay = connect({
//     role: 'wrist',                         // hub | headset | wrist
//     onState: (state) => { ... },           // every state from the relay (see shared/state.md)
//     onStatus: (connected) => { ... },      // optional: true on connect, false on drop
//   });
//   relay.send({ type: 'requestReroute' }); // any event from shared/events.md
//
// Connects to wss://<page host>/ws, sends hello, and reconnects on its own
// with a short backoff. send() returns false if the socket is not open.

const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

export function connect({ role, onState, onStatus = () => {}, url } = {}) {
  const target = url || `wss://${location.host}/ws`;
  let ws = null;
  let delay = MIN_DELAY_MS;
  let closed = false;
  let timer = null;

  function open() {
    ws = new WebSocket(target);

    ws.addEventListener('open', () => {
      delay = MIN_DELAY_MS;
      ws.send(JSON.stringify({ type: 'hello', role }));
      onStatus(true);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && msg.type === 'state' && msg.state) onState && onState(msg.state);
      // Other message types are ignored (shared/events.md).
    });

    ws.addEventListener('close', () => {
      onStatus(false);
      if (closed) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    });

    // 'close' follows every 'error', so reconnecting is handled there.
    ws.addEventListener('error', () => {});
  }

  open();

  return {
    send(event) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(event));
      return true;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      if (ws) ws.close();
    },
  };
}

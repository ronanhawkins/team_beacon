export function relayUrl(location = window.location) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;
}

export function connectRelay({ url, role = 'headset', onState, onStatus, onError, WebSocketImpl = WebSocket, retryDelay = 1000 }) {
  let socket, retry, stopped = false, attempts = 0;
  function reconnect() {
    if (stopped) return;
    onStatus('offline');
    retry = setTimeout(connect, Math.min(retryDelay * 2 ** attempts++, 10000));
  }
  function connect() {
    if (stopped) return;
    onStatus('connecting');
    try { socket = new WebSocketImpl(url); }
    catch (error) { onError(error.message); reconnect(); return; }
    socket.onopen = () => {
      attempts = 0; onStatus('connected');
      socket.send(JSON.stringify({ type: 'hello', role, version: 1 }));
    };
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'state') onState(message.state);
        else if (message.type === 'error') onError(message.message || 'Relay rejected event');
      } catch (error) { onError(`Relay message ignored: ${error.message}`); }
    };
    socket.onerror = () => onError('Relay unavailable; waiting to reconnect.');
    socket.onclose = reconnect;
  }
  connect();
  return {
    send(event) {
      if (socket?.readyState !== 1) return false;
      socket.send(JSON.stringify({ version: 1, ...event }));
      return true;
    },
    close() { stopped = true; clearTimeout(retry); socket?.close(); },
  };
}

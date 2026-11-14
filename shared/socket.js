export function relayUrl(location = window.location) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;
}

export function connectRelay({ url, onState, onStatus, onError, WebSocketImpl = WebSocket }) {
  let socket, retry, stopped = false, attempts = 0;
  function connect() {
    onStatus('connecting');
    try { socket = new WebSocketImpl(url); }
    catch (error) { onError(error.message); onStatus('offline'); return; }
    socket.onopen = () => { attempts = 0; onStatus('connected'); };
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'state') onState(message.state);
        else if (message.type === 'error') onError(message.message || 'Relay rejected command');
      } catch (error) { onError(`Relay message ignored: ${error.message}`); }
    };
    socket.onerror = () => onError('Relay unavailable; waiting to reconnect.');
    socket.onclose = () => {
      if (stopped) return;
      onStatus('offline');
      retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
    };
  }
  connect();
  return {
    send(action) {
      if (socket?.readyState !== 1) return false;
      socket.send(JSON.stringify({ type: 'command', action }));
      return true;
    },
    close() { stopped = true; clearTimeout(retry); socket?.close(); },
  };
}

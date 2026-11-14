# relay

**Owner:** Ronan

Node server that holds one state object and broadcasts it to every connected device over WebSockets. Its shape is defined in `shared/state.md`.

It listens on two ports:

- **Secure port (HTTPS + WSS):** serves the `apps/` pages and the browser WebSocket on the same port, so the headset and phone only accept one certificate warning, and a socket can't fail silently on a second, untrusted certificate.
- **Plain port (WS):** for the ESP32 panic button, which can't easily handle TLS.

Files that will probably live here:

- `server.js`: HTTPS static server for `apps/`, WSS and WS endpoints, state broadcast
- `certs/`: local TLS certificates for the headset and phone. Not committed.

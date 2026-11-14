# apps

**Owners:** CJ (headset), Ronn (hub), Joel (wrist)

Plain browser pages served by the relay on its secure port, which they also use for the WebSocket. No build tooling, no frameworks: each page is an `index.html` that loads `main.js` as an ES module.

- `headset/`: Quest 3 AR page
- `hub/`: map and route
- `wrist/`: phone wristband

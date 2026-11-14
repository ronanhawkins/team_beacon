// Smoke test: talks to the relay's plain WebSocket port like the ESP32 would.
// Usage: node test-client.js [ws://host:8081]   (the relay must be running)

'use strict';

const { WebSocket } = require('ws');

const url = process.argv[2] || 'ws://localhost:8081';
const STEP_MS = 300;

const steps = [
  { type: 'hello', role: 'esp' },
  { type: 'next' },
  { type: 'storm', on: true },
  { type: 'next' },
  { type: 'storm', on: false },
  { type: 'reset' },
];

const ws = new WebSocket(url);
let received = 0;

function summary(s) {
  return `${s.route}[${s.waypointIndex}] mode=${s.mode} storm=${s.storm} panic=${s.panic} ` +
    `reroute=${s.rerouteRequested} heading=${s.headingDeg} shelter=${s.shelterBearingDeg}deg/${s.minutesToShelter}min ` +
    `openSky=${s.openSky} dose=${s.doseFraction} O2=${s.oxygenFraction} ` +
    `sun=${s.sunlit} base=${s.baseLink} earth=${s.earthLink} delay=${s.earthDelayMinutes}`;
}

ws.on('open', async () => {
  console.log(`connected to ${url}`);
  for (const ev of steps) {
    await new Promise((r) => setTimeout(r, STEP_MS));
    console.log(`\n> ${JSON.stringify(ev)}`);
    ws.send(JSON.stringify(ev));
  }
  await new Promise((r) => setTimeout(r, STEP_MS));
  console.log(`\n${received} states received`);
  ws.close();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type !== 'state') return;
  received += 1;
  console.log(`< state ${summary(msg.state)}`);
});

ws.on('error', (err) => {
  console.error(`cannot connect to ${url}: ${err.message}. Is the relay running (npm start)?`);
  process.exit(1);
});

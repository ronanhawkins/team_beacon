#!/usr/bin/env node
// Bridge between the Beacon cuff (ESP32-S3, firmware/beacon_cuff with LINK_USB 1) plugged into this laptop by USB
// and the relay running on this laptop. No extra packages: Windows uses its built-in serial port class through
// PowerShell, macOS and Linux use stty.
//
//   npm run esp                                  find the cuff's port by itself, relay at ws://127.0.0.1:5174/ws
//   npm run esp -- --port COM5                   or a given port (macOS: /dev/cu.usbmodem1101)
//   npm run esp -- --relay ws://127.0.0.1:5174/ws
//   npm run esp -- --stdio                       test without a cuff: type JSON lines, see what the cuff would get
//
// Cuff -> relay: lines that are JSON events ({"type":"panic"}, requestReroute, cancelReroute). Lines starting
// with "# " are the cuff's log and are printed here. Relay -> cuff: each state as one JSON line, repeated every
// 5 s so the cuff knows the link is alive. The bridge connects to the relay as role "esp" only while the cuff is
// plugged in, so the hub's "Button" light is honest.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const RELAY = arg('--relay') || process.env.BEACON_RELAY || 'ws://127.0.0.1:5174/ws';
const STDIO = args.includes('--stdio');
const EVENTS = new Set(['panic', 'requestReroute', 'cancelReroute']);
const STATE_KEYS = ['version', 'route', 'waypointIndex', 'mode', 'storm', 'panic', 'rerouteRequested', 'baseLink', 'minutesToShelter'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- finding the cuff ----------
function findPort() {
  if (process.platform === 'win32') {
    // Espressif native USB (VID 303A), plus the common USB-UART chips on dev boards (CP210x, CH340, FTDI)
    const ps = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_(303A|10C4|1A86|0403)' -and $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { [regex]::Match($_.Name,'COM\\d+').Value }";
    try { return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).find(Boolean) || null; } catch { return null; }
  }
  const dir = '/dev', names = fs.readdirSync(dir);
  const hit = names.find((n) => /^cu\.usbmodem/.test(n)) || names.find((n) => /^(ttyACM|ttyUSB)\d/.test(n)) || names.find((n) => /^cu\.(usbserial|wchusbserial|SLAB)/.test(n));
  return hit ? `${dir}/${hit}` : null;
}

// ---------- the serial link: { write(line), onLine(cb), onClose(cb), close() } ----------
function openSerial(port) {
  const listeners = { line: () => {}, close: () => {} };
  let buf = '', closed = false;
  const feed = (chunk) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l) listeners.line(l); } };
  const done = (why) => { if (!closed) { closed = true; listeners.close(why); } };
  let write, close;
  if (port === '-') {
    process.stdin.setEncoding('utf8'); process.stdin.on('data', feed); process.stdin.on('end', () => done('stdin closed'));
    write = (l) => process.stdout.write('> cuff ' + l + '\n'); close = () => {};
  } else if (process.platform === 'win32') {
    // DTR and RTS stay off: toggling them can reset an ESP32-S3.
    const ps = `$ErrorActionPreference='Stop'
$p=New-Object System.IO.Ports.SerialPort '${port}',115200,'None',8,'One'; $p.DtrEnable=$false; $p.RtsEnable=$false; $p.Open()
$in=[Console]::In; $t=$in.ReadLineAsync()
while ($p.IsOpen) {
  $s=$p.ReadExisting(); if ($s) { [Console]::Out.Write($s); [Console]::Out.Flush() }
  if ($t.IsCompleted) { $l=$t.Result; if ($l -eq $null) { break }; $p.Write($l + [char]10); $t=$in.ReadLineAsync() }
  Start-Sleep -Milliseconds 15
}
$p.Close()`;
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', feed);
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (e) => log('serial:', e.trim().split('\n')[0]));
    child.on('exit', () => done('port closed'));
    write = (l) => { if (!closed) child.stdin.write(l + '\n'); }; close = () => child.kill();
  } else {
    execFileSync('stty', [process.platform === 'darwin' ? '-f' : '-F', port, '115200', 'raw', '-echo', '-hupcl']);
    const rd = fs.createReadStream(port, { encoding: 'utf8' }), wr = fs.createWriteStream(port, { flags: 'r+' });
    rd.on('data', feed); rd.on('error', () => done('port error')); rd.on('close', () => done('port closed')); wr.on('error', () => done('port error'));
    write = (l) => { if (!closed) wr.write(l + '\n'); }; close = () => { rd.destroy(); wr.destroy(); };
  }
  return { write, close, onLine: (cb) => { listeners.line = cb; }, onClose: (cb) => { listeners.close = cb; } };
}

// ---------- one session: cuff plugged in, connected to the relay ----------
function session(serial) {
  return new Promise((resolve) => {
    let ws = null, last = null, ended = false, timer = 0, retry = 0;
    const toCuff = () => { if (last) serial.write(JSON.stringify({ type: 'state', state: last })); };
    const connect = () => {
      if (ended) return;
      ws = new WebSocket(RELAY);
      ws.on('open', () => { log(`relay: connected to ${RELAY} as esp`); ws.send(JSON.stringify({ type: 'hello', role: 'esp' })); });
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.type !== 'state' || !m.state) return;
        last = Object.fromEntries(STATE_KEYS.filter((k) => k in m.state).map((k) => [k, m.state[k]]));
        toCuff();
      });
      ws.on('close', () => { if (!ended) { log('relay: not reachable, retrying (is the relay running?)'); retry = setTimeout(connect, 2000); } });
      ws.on('error', () => {});
    };
    serial.onLine((l) => {
      if (l.startsWith('#')) return log('cuff', l.replace(/^#\s?/, ''));
      if (!l.startsWith('{')) return;
      let ev; try { ev = JSON.parse(l); } catch { return; }
      if (!EVENTS.has(ev.type)) return log('cuff: ignored', l);
      if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: ev.type })); log(`cuff -> relay: ${ev.type}`); }
      else log(`cuff -> relay: ${ev.type} NOT sent, relay not connected (the cuff will retry a panic)`);
    });
    serial.onClose((why) => { ended = true; clearInterval(timer); clearTimeout(retry); if (ws) ws.close(); log(`cuff: ${why}`); resolve(); });
    timer = setInterval(toCuff, 5000); // heartbeat: the cuff shows "no link" after 15 s without a state
    connect();
  });
}

// ---------- main: keep looking for the cuff, reconnect when it is unplugged and plugged back in ----------
log(`Beacon cuff bridge. Relay ${RELAY}`);
let warned = false;
for (;;) {
  const port = STDIO ? '-' : arg('--port') || findPort();
  if (!port) { if (!warned) { log('cuff: not found. Plug it in by USB (or pass --port COMx)'); warned = true; } await sleep(2000); continue; }
  warned = false;
  log(`cuff: opening ${port === '-' ? 'stdin/stdout' : port}`);
  try { await session(openSerial(port)); } catch (e) { log('cuff:', e.message); }
  if (STDIO) break;
  await sleep(2000);
}

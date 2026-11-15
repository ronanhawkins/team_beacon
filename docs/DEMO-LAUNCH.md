# Launching the Beacon demo (instructions for an AI agent)

You are on **CJ's Windows laptop**, in the `team_beacon` repository. This laptop runs everything. Follow the steps in
order, check each one before the next, and stop and ask the human when a step needs them (hardware, a dialog, admin
rights). Use PowerShell from the repository root unless a step says otherwise.

## What connects to what

```
                     CJ's laptop
   ┌──────────────────────────────────────────────┐
   │ relay  (node relay/server.js --wifi)         │
   │   http://127.0.0.1:5174   hub, Quest, cuff   │
   │   https://<laptop IP>:8443  phone            │
   │ hub     browser on this laptop               │
   │ bridge  npm run esp  (cuff USB <-> relay)    │
   └───────┬──────────────────┬───────────────────┘
       USB │ (adb reverse)    │ USB (serial)          Wi-Fi hotspot
       Quest 3 native app     ESP32-S3 cuff           phone (wrist page)
```

- **Quest 3**: USB to this laptop. The native app talks to `127.0.0.1:5174`, carried over USB by `adb reverse`.
- **ESP32-S3 cuff**: USB to this laptop. The bridge (`tools/esp-usb-bridge.mjs`) carries its messages to the relay.
- **Hub**: a browser on this laptop at `http://127.0.0.1:5174/hub/`.
- **Phone**: the only device on the network. The laptop joins the phone's hotspot (or both join the same Wi-Fi), and
  the phone opens `https://<laptop IP>:8443/wrist/`.

There must be exactly **one** relay. It holds the mission state that every device shares.

## Rules

- Never stop processes you did not start. In particular do not run `taskkill /im node.exe` or `Stop-Process -Name node`:
  other node processes may be the human's. Stop only the windows or process IDs you started.
- Do not commit, push, or edit files to make the demo run. If something is broken, report it.
- Steps marked **(human)** need the person at the laptop: plugging in, putting on the headset, dialogs, admin rights.

## 1. Check the machine

```powershell
git status                      # expect a clean tree on main
git pull                        # get the latest main
node --version                  # 22.12 or newer
npm ci                          # dependencies (once per pull that changed package-lock.json)
cargo --version                 # Rust, for the route planner
Test-Path .local\platform-tools\adb.exe     # True: the Quest tools are installed
Get-Command openssl -ErrorAction SilentlyContinue; Test-Path 'C:\Program Files\Git\usr\bin\openssl.exe'   # one of them, for the HTTPS certificate
```

Build the route planner once after each pull that touched `engine/` (the hub's "Plan this route" and the phone's
"Waypoint" need it; without it they report that the engine is not built):

```powershell
cd engine; cargo build --release; cd ..
```

If `cargo` is missing, tell the human. Everything except planning still works without it.

## 2. Network **(human)**

1. Turn on the phone's hotspot. On an iPhone, turn on **Maximise Compatibility**.
2. Connect this laptop's Wi-Fi to it.
3. Find the laptop's address on it and note it as `<laptop IP>`:
   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Wireless' } | Select-Object IPAddress
   ```
   An iPhone hotspot gives `172.20.10.x`; Android usually `192.168.x.x`.
4. Windows must let the phone reach port 8443. If Windows asks whether Node may use the network, the human allows it
   on private networks. If the phone cannot load the page later, the human (as admin) runs:
   ```powershell
   New-NetFirewallRule -DisplayName 'Beacon relay 8443' -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private,Public
   ```

## 3. Start the relay

The site is **Jezero** (the Quest launcher expects it). Start the relay in Wi-Fi mode as a long-running background
process, and keep its window or process ID:

```powershell
$env:SITE = 'jezero'
powershell -NoProfile -ExecutionPolicy Bypass -File tools\start-wifi-demo.ps1 -IpAddress <laptop IP>
```

It creates a certificate for that address the first time, then prints:

- `Site jezero: data/sites/jezero/site.json …`
- `HTTPS + WSS (/ws, /relay) on port 8443`
- `Synced laptop controls: http://127.0.0.1:5174/hub/`

Check it:

```powershell
Invoke-RestMethod http://127.0.0.1:5174/session.json     # capabilities.plan and capabilities.exampleRoute are True
(Invoke-RestMethod http://127.0.0.1:5174/data/site.json).site   # starts with "Three Forks", Jezero
```

If port 5174 is already taken by an older relay that you did not start, ask the human before stopping it.

## 4. Quest 3 **(human: plug in, accept, put on)**

1. The human plugs the Quest into this laptop by USB and accepts "Allow USB debugging" in the headset.
2. Launch the app. It finds the running relay and sets up `adb reverse`:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-quest-native.ps1 -LaunchOnly
   ```
   Without `-LaunchOnly` it also installs `apps\quest\Builds\BeaconAR.apk` (only needed after a new Unity build).
3. It should end without errors. If it says "A different service is using the mission port", the relay is serving the
   wrong site: it must be started with `$env:SITE='jezero'` (step 3).

## 5. ESP32-S3 cuff **(human: plug in)**

1. The human plugs the cuff into this laptop by USB.
2. **First time only**: the cuff needs the Beacon firmware in USB mode. Ask the human whether it is already flashed.
   If not (needs PlatformIO: `pip install platformio`, or the VS Code PlatformIO extension):
   ```powershell
   cd firmware\beacon_cuff
   Copy-Item include\beacon_config.example.h include\beacon_config.h   # LINK_USB 1 is already set: no Wi-Fi details needed
   pio run -t upload
   cd ..\..
   ```
   Flashing needs the serial port, so the bridge (next step) must not be running while flashing.
3. Start the bridge as a long-running background process:
   ```powershell
   npm run esp
   ```
   It finds the cuff's COM port (pass `-- --port COM5` if it picks the wrong one) and prints
   `relay: connected to ws://127.0.0.1:5174/ws as esp`, then the cuff's own log lines. The cuff's light turns from slow
   yellow blinking (no link) to green.

## 6. Hub

Open `http://127.0.0.1:5174/hub/` in a browser on this laptop (`Start-Process http://127.0.0.1:5174/hub/`).
The top bar shows **Relay** with a tick, and **Headset** and **Button** once the Quest and the cuff are connected.

## 7. Phone **(human)**

On the phone, joined to the same hotspot, open `https://<laptop IP>:8443/wrist/`. Accept the certificate warning
once (self-signed certificate for the demo). Turn the phone sideways; "Tap for full screen, landscape" locks it.
The page shows **Linked**.

## 8. Check everything is connected

```powershell
Invoke-RestMethod http://127.0.0.1:5174/clients | Select-Object role, transport
```

Expect `hub`, `headset-unity`, `esp` and `wrist`. Then a quick functional check with the human watching:

| Do | Expect |
|---|---|
| Hub: **Start example route** (or A on the Quest controller) | every screen at the start of the example route |
| Hub: **Next** a few times | the Quest, phone map and hub move together |
| Cuff: hold PANIC 1 s | red on every screen, cuff and hub alarm |
| Cuff: hold ACK 2 s (or phone: hold **Back to route**) | SOS off, back on the route |
| Hub: **Storm**, then **End storm** | storm on every screen; the alarm stops once in shelter |

## Stopping

Close only what you started: the bridge, the relay (Ctrl+C in its window, or `Stop-Process -Id <its id>`), and the
browser tab. Unplugging the cuff is fine at any time; the bridge waits for it to come back.

## If something is wrong

| Symptom | Likely cause and fix |
|---|---|
| Phone: page does not load | Not on the same hotspot, wrong address, or Windows firewall (step 2.4). Check `https://<laptop IP>:8443/` from the laptop itself |
| Phone: loads but says **No link** | The certificate was not accepted for this address; reopen `https://<laptop IP>:8443/` and accept |
| Laptop address changed | Restart the relay with the new `-IpAddress`; the script remakes the certificate. The phone reopens the new address. |
| Hub: **Button** has a cross | Bridge not running, cuff unplugged, or the cuff has Wi-Fi firmware (`LINK_USB 0`); see step 5 |
| Bridge: `cuff: not found` | Unplugged, a charge-only cable, or a missing driver; pass `--port COMx` from Device Manager |
| Quest launcher: wrong site or "different service" | The relay was started without `$env:SITE='jezero'` |
| Hub: "The engine is not built" when planning | `cd engine; cargo build --release`, then restart the relay |
| Quest still on an old route after a plan | It reloads routes by itself; if it does not, run step 4.2 again |

More detail: `relay/README.md` (relay, planning), `apps/hub/README.md`, `apps/wrist/README.md`,
`firmware/beacon_cuff/README.md`, `apps/quest/README.md`, `docs/CJ-START-HERE.md`.

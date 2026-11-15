# firmware/beacon_cuff

ESP32-S3 wrist cuff for Beacon, on the relay's plain WebSocket (port 8081). Same wiring as Joel's
`firmware/cuff_core` test sketch, which stays as the hardware test.

| Part | Pin | What it does |
|---|---|---|
| PANIC button | 4 to GND | hold 1 s: `{"type":"panic"}`. With no link, sent as soon as the link is back |
| REROUTE button | 5 to GND | hold 0.6 s: `{"type":"requestReroute"}` |
| ACK button | 7 to GND | press: silence the alarm. Hold 2 s: `{"type":"cancelReroute"}`, which turns off SOS and the shelter request together |
| LEDs | R 15, Y 16, G 17 | green nominal, yellow caution or reroute, red storm or panic (flashing while the alarm sounds), slow yellow blink = no link |
| Buzzer | 18 | rising siren for a storm, pulses for a panic. Stops on ACK, a wrist flick, after 20 s, or (storm) in shelter |
| MPU-9250 (optional) | SDA 8, SCL 9 | a wrist flick silences the alarm |

## Two ways to reach the relay

Set in `include/beacon_config.h` (copy it from `include/beacon_config.example.h`; the copy is ignored by git).

- **USB (`LINK_USB 1`, the default and the demo setup).** Plug the cuff into the laptop running the relay and run the
  bridge there: `npm run esp` (`tools/esp-usb-bridge.mjs`, no extra packages). It finds the cuff's port, connects to the
  relay as `esp` and passes JSON lines both ways; the relay's state reaches the cuff at least every 5 s, and the cuff
  shows "no link" after 15 s without one. No Wi-Fi details are needed.
- **Wi-Fi (`LINK_USB 0`).** Fill in the hotspot name and password and the relay laptop's address (the relay prints
  `ESP32: ws://<address>:8081`). An iPhone hotspot needs **Maximise Compatibility** on (the ESP32 only joins 2.4 GHz).
  The relay must open the ESP port: `npm start` in `relay/`, or Wi-Fi mode; local mode (`npm run demo`) has none.

## Build and flash

PlatformIO (VS Code extension, or `pip install platformio`):

```sh
cd firmware/beacon_cuff
pio run -t upload            # stop the USB bridge first: flashing needs the port
pio device monitor           # 115200: ? = status, p = panic, r = reroute, x = cancel. Log lines start with "# "
```

The hub's top bar shows **Button** when the cuff is connected. Events and their effects are in `shared/events.md`;
the whole demo launch is in `docs/DEMO-LAUNCH.md`.

// Copy this file to beacon_config.h (ignored by git).
#pragma once

// 1 = the cuff is plugged into the relay laptop by USB and the laptop runs the bridge (npm run esp). No Wi-Fi needed.
// 0 = the cuff joins Wi-Fi and connects to the relay's ESP port itself (fill in the three lines below).
#define LINK_USB 1

#define WIFI_SSID      "your-hotspot-name"
#define WIFI_PASSWORD  "your-hotspot-password"
#define RELAY_HOST     "172.20.10.2"   // the laptop running the relay; it prints "ESP32: ws://<address>:8081"
#define RELAY_PORT     8081

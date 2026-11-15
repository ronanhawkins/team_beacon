// Beacon cuff (ESP32-S3): the astronaut's wrist cuff, on the relay's plain WebSocket (shared/events.md).
// Wiring is Joel's cuff_core board (firmware/cuff_core):
//   Buttons to GND: 4 PANIC (hold 1 s)   5 REROUTE (hold 0.6 s)
//                   7 ACK (press = silence the alarm, hold 2 s = cancel the shelter request and SOS)
//   Traffic LEDs: R 15, Y 16, G 17      Buzzer: 18      MPU-9250 (optional): SDA 8, SCL 9, a wrist flick also silences
//
// Sends   {"type":"hello","role":"esp"} on connect, {"type":"panic"}, {"type":"requestReroute"} and {"type":"cancelReroute"}.
// Shows   the relay state: green = nominal, yellow = caution or reroute, red = storm or panic,
//         slow yellow blink = no link to the relay. A storm or panic sounds the alarm until ACK, a wrist flick,
//         20 s, or (storm only) arriving in shelter. A panic pressed with no link is sent as soon as the link is back.
// Link    LINK_USB 1 (beacon_config.h): plugged into the relay laptop; tools/esp-usb-bridge.mjs (npm run esp) carries
//         JSON lines both ways. LINK_USB 0: joins Wi-Fi and connects to ws://RELAY_HOST:8081 itself.
// Serial  (115200): ? = status, p = send panic, r = send reroute, x = cancel (bench testing). Log lines start with "# ".
#include <Arduino.h>
#include <Wire.h>
#include <ArduinoJson.h>
#if __has_include("beacon_config.h")
#include "beacon_config.h"
#else
#warning "No include/beacon_config.h: using beacon_config.example.h. Copy it and fill in your network."
#include "beacon_config.example.h"
#endif
#ifndef LINK_USB
#define LINK_USB 0
#endif
#if !LINK_USB
#include <WiFi.h>
#include <WebSocketsClient.h>
#endif
// Every human-readable line starts with "# ", so the USB bridge (tools/esp-usb-bridge.mjs) can tell it from JSON.
#define LOG(...) do { Serial.print("# "); Serial.printf(__VA_ARGS__); } while (0)
#define LOGLN(x) do { Serial.print("# "); Serial.println(x); } while (0)

const int BTN_PANIC = 4, BTN_REROUTE = 5, BTN_ACK = 7;
const int LED_R = 15, LED_Y = 16, LED_G = 17, BUZZER = 18;
const int SDA_PIN = 8, SCL_PIN = 9;
const uint8_t MPU = 0x68;
const unsigned long PANIC_HOLD_MS = 1000, REROUTE_HOLD_MS = 600, CANCEL_HOLD_MS = 2000, ALARM_MS = 20000;

#if !LINK_USB
WebSocketsClient ws;
#endif
bool linked = false, mpuOk = false;
unsigned long lastStateAt = 0; // USB link: the bridge sends the state at least every 5 s; silence for 15 s = no link

// ---- what the relay says (shared/state.md) ----
struct Mission { bool known = false, storm = false, panic = false, requested = false, warning = false, reroute = false, baseLink = true; float shelterMin = -1; } m;
enum Level { OFFLINE, NOMINAL, CAUTION, EMERGENCY };
Level level() {
  if (!linked || !m.known) return OFFLINE;
  if (m.storm || m.panic) return EMERGENCY;
  if (m.warning || m.reroute) return CAUTION;
  return NOMINAL;
}
bool inShelter() { return m.reroute && m.shelterMin == 0; }

// ---- alarm ----
bool alarmOn = false, acked = false; unsigned long alarmAt = 0, flashUntil = 0;
bool pendingPanic = false;

void startAlarm() { alarmOn = true; acked = false; alarmAt = millis(); LOGLN(m.panic ? "!!! PANIC: go to shelter" : "!!! SOLAR STORM: go to shelter"); }
void stopAlarm(const char* why) { if (alarmOn) LOG("-> alarm off (%s)\n", why); alarmOn = false; noTone(BUZZER); }
void acknowledge(const char* how) {
  if (!alarmOn) return;
  acked = true; stopAlarm(how); tone(BUZZER, 2500, 60);
}

// ---- relay ----
void sendEvent(const char* type) {
  char buf[48]; snprintf(buf, sizeof buf, "{\"type\":\"%s\"}", type);
#if LINK_USB
  if (linked) { Serial.println(buf); LOG("-> sent %s\n", type); return; }
#else
  if (linked && ws.sendTXT(buf)) { LOG("-> sent %s\n", type); return; }
#endif
  LOG("-> %s not sent: no link\n", type);
}

void onState(JsonObject s) {
  bool wasEmergency = m.storm || m.panic, wasPanic = m.panic, first = !m.known;
  m.known = true;
  m.storm = s["storm"] | false;
  m.panic = s["panic"] | false;
  m.requested = s["rerouteRequested"] | false;
  m.warning = strcmp(s["mode"] | "nominal", "warning") == 0;
  m.reroute = strcmp(s["route"] | "main", "reroute") == 0;
  m.baseLink = s["baseLink"] | true;
  m.shelterMin = s["minutesToShelter"] | -1.0f;
  bool emergency = m.storm || m.panic;
  // a new storm or panic sounds the alarm, and so does booting into one; reconnecting into the same one does not
  if (emergency && (first || !wasEmergency || (m.panic && !wasPanic))) startAlarm();
  if (!emergency) { stopAlarm("emergency over"); acked = false; }
  if (alarmOn && m.storm && !m.panic && inShelter()) stopAlarm("in shelter");
}

void onMessage(const char* payload, size_t length) {
  JsonDocument filter; filter["type"] = true;
  for (const char* k : { "storm", "panic", "rerouteRequested", "mode", "route", "baseLink", "minutesToShelter" }) filter["state"][k] = true;
  JsonDocument doc;
  if (deserializeJson(doc, payload, length, DeserializationOption::Filter(filter))) return;
  if (strcmp(doc["type"] | "", "state") == 0) { lastStateAt = millis(); onState(doc["state"].as<JsonObject>()); }
}
void onLinked() { if (pendingPanic) { pendingPanic = false; sendEvent("panic"); } }

#if !LINK_USB
void onSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      linked = true; LOG("[relay] connected to ws://%s:%d\n", RELAY_HOST, RELAY_PORT);
      ws.sendTXT("{\"type\":\"hello\",\"role\":\"esp\"}");
      onLinked();
      break;
    case WStype_DISCONNECTED:
      if (linked) LOGLN("[relay] disconnected");
      linked = false; break;
    case WStype_TEXT: onMessage((const char*)payload, length); break;
    default: break;
  }
}
#endif

// ---- buttons ----
const int btns[3] = { BTN_PANIC, BTN_REROUTE, BTN_ACK };
bool down[3] = { false, false, false }, fired[3] = { false, false, false };
unsigned long pressedAt[3] = { 0, 0, 0 }, changedAt[3] = { 0, 0, 0 };

void handleButtons() {
  unsigned long now = millis();
  for (int i = 0; i < 3; i++) {
    bool pressed = digitalRead(btns[i]) == LOW;
    if (pressed != down[i] && now - changedAt[i] > 25) { // debounce
      down[i] = pressed; changedAt[i] = now;
      if (pressed) { pressedAt[i] = now; fired[i] = false; if (btns[i] == BTN_ACK) acknowledge("ACK button"); }
    }
    if (!down[i] || fired[i]) continue;
    unsigned long held = now - pressedAt[i];
    if (btns[i] == BTN_PANIC && held >= PANIC_HOLD_MS) {
      fired[i] = true; tone(BUZZER, 880, 150); flashUntil = now + 1500;
      if (linked) sendEvent("panic"); else { pendingPanic = true; LOGLN("-> panic queued until the link is back"); }
    }
    if (btns[i] == BTN_ACK && held >= CANCEL_HOLD_MS) {  // all clear from the wrist: one hold cancels both
      fired[i] = true;
      if (m.panic || m.requested || pendingPanic) { pendingPanic = false; tone(BUZZER, 2000, 80); delay(110); tone(BUZZER, 2600, 120); sendEvent("cancelReroute"); }
      else LOGLN("-> nothing to cancel (a storm is ended by base)");
    }
    if (btns[i] == BTN_REROUTE && held >= REROUTE_HOLD_MS) {
      fired[i] = true; tone(BUZZER, 1500, 80); flashUntil = now + 1500; sendEvent("requestReroute");
    }
  }
}

// ---- outputs ----
void setLeds(bool r, bool y, bool g) { digitalWrite(LED_R, r); digitalWrite(LED_Y, y); digitalWrite(LED_G, g); }
void updateOutputs() {
  unsigned long now = millis();
  static unsigned long lastTone = 0;
  if (alarmOn && now - alarmAt > ALARM_MS) stopAlarm("timed out");
  switch (level()) {
    case OFFLINE: setLeds(0, (now / 1000) % 2, 0); break;                  // slow yellow blink
    case NOMINAL: setLeds(0, now < flashUntil && (now / 150) % 2, now >= flashUntil); break;
    case CAUTION: setLeds(0, 1, 0); break;
    case EMERGENCY:
      if (alarmOn) { bool p = (now / 250) % 2; setLeds(p, m.storm && !p, 0); }
      else setLeds(1, 0, 0);
      break;
  }
  if (!alarmOn) return;
  if (m.panic) { if (now - lastTone > 900) { lastTone = now; tone(BUZZER, 880, 600); } }  // panic: steady pulses
  else if (now - lastTone > 40) { lastTone = now; tone(BUZZER, 600 + (now % 1000) * 0.6); } // storm: rising siren
}

// ---- MPU-9250: a wrist flick silences the alarm ----
int16_t mpuRead16(uint8_t reg) {
  Wire.beginTransmission(MPU); Wire.write(reg); Wire.endTransmission(false);
  Wire.requestFrom(MPU, (uint8_t)2);
  return (Wire.read() << 8) | Wire.read();
}
void handleMpu() {
  if (!mpuOk) return;
  static unsigned long last = 0, lastFlick = 0;
  if (millis() - last < 50) return;
  last = millis();
  float gx = mpuRead16(0x43) / 16.4, gy = mpuRead16(0x45) / 16.4, gz = mpuRead16(0x47) / 16.4;
  if ((fabs(gx) > 300 || fabs(gy) > 300 || fabs(gz) > 300) && millis() - lastFlick > 1000) { lastFlick = millis(); acknowledge("wrist flick"); }
}

// ---- status ----
void printStatus() {
  const char* names[] = { "NO LINK", "NOMINAL", "CAUTION", "EMERGENCY" };
#if LINK_USB
  const char* net = "usb";
#else
  String ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("down"); const char* net = ip.c_str();
#endif
  LOG("[status] link %s | relay %s | %s%s%s%s | alarm %s\n",
    net, linked ? "linked" : "no link", names[level()],
    m.storm ? " storm" : "", m.panic ? " panic" : "", m.reroute ? (inShelter() ? " in-shelter" : " reroute") : "", alarmOn ? "ON" : "off");
}
void handleSerial() {
  static char line[2048]; static size_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (n < sizeof line - 1) line[n++] = c; continue; }
    if (!n) continue;
    line[n] = 0;
    if (line[0] == '{') {
#if LINK_USB
      bool was = linked; onMessage(line, n); linked = true;
      if (!was) { LOGLN("[relay] linked over USB"); onLinked(); }
#endif
    } else if (n == 1) {
      if (line[0] == '?') printStatus();
      if (line[0] == 'p') sendEvent("panic");
      if (line[0] == 'r') sendEvent("requestReroute");
      if (line[0] == 'x') sendEvent("cancelReroute");
    }
    n = 0;
  }
#if LINK_USB
  if (linked && millis() - lastStateAt > 15000) { linked = false; LOGLN("[relay] USB link lost"); }
#endif
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  LOGLN("\n===== BEACON CUFF =====");
  for (int b : btns) pinMode(b, INPUT_PULLUP);
  pinMode(LED_R, OUTPUT); pinMode(LED_Y, OUTPUT); pinMode(LED_G, OUTPUT);
  setLeds(1, 0, 0); tone(BUZZER, 1000, 120); delay(160);
  setLeds(0, 1, 0); tone(BUZZER, 1500, 120); delay(160);
  setLeds(0, 0, 1); tone(BUZZER, 2000, 120); delay(160);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.beginTransmission(MPU); mpuOk = Wire.endTransmission() == 0;
  if (mpuOk) {
    Wire.beginTransmission(MPU); Wire.write(0x6B); Wire.write(0x00); Wire.endTransmission();  // wake
    Wire.beginTransmission(MPU); Wire.write(0x1B); Wire.write(0x18); Wire.endTransmission();  // gyro +-2000 dps
  }
  LOG("MPU-9250: %s\n", mpuOk ? "found" : "not connected (flick disabled)");

#if LINK_USB
  LOGLN("Link: USB serial. Run the bridge on the laptop: npm run esp");
#else
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  LOG("Wi-Fi: joining \"%s\"; relay ws://%s:%d\n", WIFI_SSID, RELAY_HOST, RELAY_PORT);
  ws.begin(RELAY_HOST, RELAY_PORT, "/");
  ws.onEvent(onSocket);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2); // drop a dead link within ~20 s even if the relay vanished without closing
#endif
}

void loop() {
#if !LINK_USB
  ws.loop();
#endif
  handleButtons();
  handleSerial();
  handleMpu();
  updateOutputs();
  static unsigned long lastStatus = 0;
  if (millis() - lastStatus > 5000) { lastStatus = millis(); printStatus(); }
}

// CUFF CORE TEST (ESP32-S3) - buttons, traffic LEDs, buzzer, MPU-9250 (no RFID, no HR)
// Board: ESP32S3 Dev Module. USB CDC On Boot: Enabled. Serial Monitor 115200.
//
// Buttons (to GND):  4 PANIC (hold 1 s)   5 REROUTE   7 ACK (hold 2 s = all clear)
// Traffic LEDs: R 15, Y 16, G 17      Buzzer: 18
// MPU-9250 (optional): SDA 8, SCL 9 - wrist flick also acknowledges an alarm
// Serial Monitor commands: s = simulate storm, c = clear, ? = status

#include <Wire.h>

const int BTN_PANIC = 4, BTN_REROUTE = 5, BTN_ACK = 7;
const int LED_R = 15, LED_Y = 16, LED_G = 17, BUZZER = 18;
const int SDA_PIN = 8, SCL_PIN = 9;
const uint8_t MPU = 0x68;
bool mpuOk = false;

// ---- state ----
enum Mode { NOMINAL, STORM, PANIC };
Mode mode = NOMINAL;
bool acked = false;
unsigned long amberUntil = 0;
float exertion = 0;

// ---- buttons ----
const int btns[3] = {BTN_PANIC, BTN_REROUTE, BTN_ACK};
const char* names[3] = {"PANIC", "REROUTE", "ACK"};
bool lastState[3] = {HIGH, HIGH, HIGH};
unsigned long pressedAt[3] = {0, 0, 0};
bool holdFired[3] = {false, false, false};

// ---------- helpers ----------
void setLeds(bool r, bool y, bool g) { digitalWrite(LED_R, r); digitalWrite(LED_Y, y); digitalWrite(LED_G, g); }
void beep(int f, int ms) { tone(BUZZER, f, ms); delay(ms + 30); }

void setMode(Mode m, const char* msg) {
  mode = m; acked = false; noTone(BUZZER);
  Serial.println(msg);
}

void acknowledge(const char* how) {
  if (mode == NOMINAL || acked) return;
  acked = true; noTone(BUZZER); beep(2500, 60);
  Serial.printf("-> alarm acknowledged (%s). Hold ACK 2 s or type c for all clear.\n", how);
}

int16_t mpuRead16(uint8_t reg) {
  Wire.beginTransmission(MPU); Wire.write(reg); Wire.endTransmission(false);
  Wire.requestFrom(MPU, (uint8_t)2);
  return (Wire.read() << 8) | Wire.read();
}

bool i2cPresent(uint8_t addr) { Wire.beginTransmission(addr); return Wire.endTransmission() == 0; }

void printStatus() {
  const char* m = mode == NOMINAL ? "NOMINAL" : (mode == STORM ? "STORM" : "PANIC");
  Serial.printf("[status] mode %s%s | exertion %s\n", m, acked ? " (acked)" : "",
                mpuOk ? String(exertion, 2).c_str() : "n/a");
}

// ---------- setup ----------
void setup() {
  Serial.begin(115200);
  delay(3000);   // give the USB serial time to reconnect so the report isn't missed
  Serial.println("\n===== CUFF CORE TEST =====");

  for (int i = 0; i < 3; i++) pinMode(btns[i], INPUT_PULLUP);
  pinMode(LED_R, OUTPUT); pinMode(LED_Y, OUTPUT); pinMode(LED_G, OUTPUT);

  setLeds(1,0,0); beep(1000, 250);
  setLeds(0,1,0); beep(1500, 250);
  setLeds(0,0,1); beep(2000, 250);
  Serial.println("[ OK ] LEDs + buzzer (did you see R/Y/G and hear 3 beeps?)");

  Wire.begin(SDA_PIN, SCL_PIN);
  delay(200);
  for (int t = 0; t < 5 && !mpuOk; t++) { mpuOk = i2cPresent(MPU); if (!mpuOk) delay(200); }
  if (mpuOk) {
    Wire.beginTransmission(MPU); Wire.write(0x6B); Wire.write(0x00); Wire.endTransmission(); // wake
    Wire.beginTransmission(MPU); Wire.write(0x1B); Wire.write(0x18); Wire.endTransmission(); // gyro +-2000 dps
  }
  Serial.printf("[%s] MPU-9250 at 0x68%s\n", mpuOk ? " OK " : "----", mpuOk ? "" : " (not connected - skipping)");

  Serial.println("Buttons: 4 PANIC(hold 1 s)  5 REROUTE  7 ACK(hold 2 s = clear)");
  Serial.println("Serial commands: s = simulate storm, c = clear, ? = status");
  Serial.println("==========================\n");
}

// ---------- loop parts ----------
void handleButtons() {
  for (int i = 0; i < 3; i++) {
    bool s = digitalRead(btns[i]);
    if (s != lastState[i]) {
      delay(20);
      s = digitalRead(btns[i]);
      if (s == lastState[i]) continue;
      lastState[i] = s;
      if (s == LOW) {
        pressedAt[i] = millis(); holdFired[i] = false;
        Serial.printf("button %s pressed\n", names[i]);
        if (btns[i] == BTN_REROUTE) { Serial.println("-> REROUTE requested"); amberUntil = millis() + 1500; beep(1500,100); beep(1500,100); }
        if (btns[i] == BTN_ACK)     acknowledge("button");
      }
    }
    if (lastState[i] == LOW && !holdFired[i]) {
      unsigned long held = millis() - pressedAt[i];
      if (btns[i] == BTN_PANIC && held >= 1000 && mode != PANIC) { holdFired[i] = true; setMode(PANIC, "!!! PANIC - SOS sent with position !!!"); }
      if (btns[i] == BTN_ACK && held >= 2000 && mode != NOMINAL) { holdFired[i] = true; setMode(NOMINAL, "-> ALL CLEAR"); beep(2000,80); beep(2600,120); }
    }
  }
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 's' && mode != STORM) setMode(STORM, "!!! SOLAR STORM WARNING - shelter 6 min (simulated) !!!");
    if (c == 'c' && mode != NOMINAL) { setMode(NOMINAL, "-> ALL CLEAR"); beep(2000,80); beep(2600,120); }
    if (c == '?') printStatus();
  }
}

void updateOutputs() {
  unsigned long now = millis();
  static unsigned long lastTone = 0;
  if (mode == NOMINAL) {
    if (now < amberUntil) setLeds(0,1,0); else setLeds(0,0,1);
  } else if (mode == STORM) {
    if (!acked) {
      bool p = (now / 250) % 2;
      setLeds(p, !p, 0);
      if (now - lastTone > 40) { lastTone = now; tone(BUZZER, 600 + (now % 1000) * 0.6); }  // rising siren
    } else {
      setLeds(1,0,0);
      if (now - lastTone > 5000) { lastTone = now; tone(BUZZER, 1200, 80); }                // reminder chirp
    }
  } else { // PANIC
    if (!acked) {
      setLeds((now / 300) % 2, 0, 0);
      if (now - lastTone > 900) { lastTone = now; tone(BUZZER, 880, 600); }
    } else setLeds(1,0,0);
  }
}

void handleMpu() {
  if (!mpuOk) return;
  static unsigned long last = 0, lastFlick = 0;
  if (millis() - last < 50) return;
  last = millis();
  float ax = mpuRead16(0x3B) / 16384.0, ay = mpuRead16(0x3D) / 16384.0, az = mpuRead16(0x3F) / 16384.0;
  float gx = mpuRead16(0x43) / 16.4,    gy = mpuRead16(0x45) / 16.4,    gz = mpuRead16(0x47) / 16.4;
  float motion = fabs(sqrt(ax*ax + ay*ay + az*az) - 1.0);
  exertion = 0.9 * exertion + 0.1 * constrain(motion * 2.0, 0, 1);
  if ((fabs(gx) > 300 || fabs(gy) > 300 || fabs(gz) > 300) && millis() - lastFlick > 1000) {
    lastFlick = millis();
    if (mode != NOMINAL && !acked) acknowledge("wrist flick");
    else Serial.println("(flick detected)");
  }
}

void loop() {
  handleButtons();
  handleSerial();
  updateOutputs();
  handleMpu();
  static unsigned long lastStatus = 0;
  if (millis() - lastStatus > 3000) { lastStatus = millis(); printStatus(); }
}

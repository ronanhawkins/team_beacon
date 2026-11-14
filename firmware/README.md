# firmware

**Owner:** Joel

ESP32 panic button that notifies the relay when pressed. It connects to the relay's plain (non-TLS) WebSocket port.

Files that will probably live here:

- `panic_button/panic_button.ino`: Arduino sketch (button input, Wi-Fi, WebSocket to relay)
- `panic_button/config.h`: Wi-Fi and relay address settings

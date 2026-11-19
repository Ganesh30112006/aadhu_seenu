# Circuit Diagram and Wiring

This is the recorder device: an ESP32-S3-DevKitC-1 N8R8 with an INMP441 microphone, an SSD1306 OLED, three buttons and an RGB LED. The source of truth for pins is [firmware/README.md](../../firmware/README.md) §1. If they ever disagree, the firmware README wins.

## Bill of materials

| # | Part | Qty | Notes |
|---|---|---|---|
| 1 | ESP32-S3-DevKitC-1 **N8R8** (8 MB flash, 8 MB octal PSRAM) | 1 | The PSRAM is required for the audio buffer |
| 2 | INMP441 I²S MEMS microphone module | 1 | 3.3 V only |
| 3 | SSD1306 0.96" 128×64 OLED, I²C | 1 | Address 0x3C |
| 4 | Tactile push button, 6×6 mm | 3 | Start, Stop, Pause/Resume |
| 5 | RGB LED, 5 mm, common cathode | 1 | |
| 6 | Resistor 220 Ω | 1 | Red LED channel |
| 7 | Resistor 100 Ω | 2 | Green and blue LED channels |
| 8 | Resistor 100 kΩ | 1 | Pull-down on the microphone data line |
| 9 | Capacitor 100 nF ceramic | 1 | Decoupling at the microphone |
| 10 | Breadboard or perfboard, jumper wires | — | |
| 11 | USB-C cable and 5 V / 1 A supply | 1 | Powers the board |
| 12 | Enclosure | 1 | Leave an opening over the microphone port |

## Schematic (block form)

```
                         ESP32-S3-DevKitC-1 (N8R8)
                      ┌──────────────────────────────┐
   INMP441            │                              │
  ┌────────┐          │                              │
  │ VDD ───┼──────────┤ 3V3                          │
  │ GND ───┼──────────┤ GND                          │
  │ L/R ───┼──── GND  │                              │
  │ SCK ───┼──────────┤ GPIO4   (I2S BCLK)           │
  │ WS  ───┼──────────┤ GPIO5   (I2S LRCLK)          │
  │ SD  ───┼────┬─────┤ GPIO6   (I2S DIN)            │
  └────────┘    │     │                              │
             100kΩ    │                              │
                │     │                              │
               GND    │                              │
   100 nF between VDD and GND, close to the mic      │
                      │                              │
   SSD1306 OLED       │                              │
  ┌────────┐          │                              │
  │ VCC ───┼──────────┤ 3V3                          │
  │ GND ───┼──────────┤ GND                          │
  │ SDA ───┼──────────┤ GPIO8   (I2C SDA)            │
  │ SCL ───┼──────────┤ GPIO9   (I2C SCL)            │
  └────────┘          │                              │
                      │                              │
   START  ─o o─ GND ──┤ GPIO1   (internal pull-up)   │
   STOP   ─o o─ GND ──┤ GPIO2   (internal pull-up)   │
   PAUSE  ─o o─ GND ──┤ GPIO7   (internal pull-up)   │
                      │                              │
   RGB LED (common cathode)                          │
     R ── 220Ω ───────┤ GPIO16                       │
     G ── 100Ω ───────┤ GPIO17                       │
     B ── 100Ω ───────┤ GPIO18                       │
     K ───────── GND  │                              │
                      │                              │
                      │ USB-C ── 5 V supply          │
                      └──────────────────────────────┘
```

## Pin table

| Part | Part pin | ESP32-S3 | Notes |
|---|---|---|---|
| INMP441 | VDD | 3V3 | **Never 5 V.** 100 nF capacitor across VDD–GND at the module |
| INMP441 | GND | GND | |
| INMP441 | L/R | GND | Selects the left channel |
| INMP441 | SCK | GPIO4 | I²S bit clock |
| INMP441 | WS | GPIO5 | I²S word select |
| INMP441 | SD | GPIO6 | I²S data; 100 kΩ to GND so the line is defined when the mic is idle |
| SSD1306 | VCC / GND | 3V3 / GND | Some modules order these pins GND-VCC, others VCC-GND: check the silkscreen |
| SSD1306 | SDA / SCL | GPIO8 / GPIO9 | |
| Start button | — | GPIO1 → button → GND | |
| Stop button | — | GPIO2 → button → GND | |
| Pause/Resume button | — | GPIO7 → button → GND | |
| RGB LED | R / G / B | GPIO16 / 17 / 18 | Through 220 Ω / 100 Ω / 100 Ω |
| RGB LED | Cathode | GND | |

### Pins deliberately not used

| Pins | Reason |
|---|---|
| GPIO0, 3, 45, 46 | Strapping pins; they affect boot mode |
| GPIO19, 20 | USB |
| GPIO35–37 | Used by the octal PSRAM on N8R8 boards |
| GPIO43, 44 | Serial console |
| GPIO38 / 48 | The board's own RGB LED (depends on board revision) |

## Design notes

- **Resistor values:** they balance the LED's brightness. The red channel has a lower forward voltage, so it gets the larger resistor.
- **Button debouncing:** done in firmware (30 ms settle, 400 ms repeat guard), so the buttons need no capacitors.
- **Microphone placement:** keep the microphone away from the board's Wi-Fi antenna and away from fans. Point its port toward the lecturer.
- **Offline storage:** internal flash plus PSRAM holds about 12.7 minutes of audio. MicroSD is deliberately not used (see the report, Chapter 5).

## First power-on check

1. Flash `firmware/mic_test` and run it. It records 10 s and reports whether the I²S wiring is correct, including swapped SCK/WS and a floating SD line.
2. Flash `firmware/recorder`. The OLED should show READY and the LED should be green once Wi-Fi and the server are reachable.

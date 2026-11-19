# Firmware: ESP32-S3 Lecture Capture Device

| Folder | What it is |
|---|---|
| `lc_core/` | Platform-independent C: frame encoding, IMA-ADPCM, selective ACK, PSRAM ring, flash log, backoff. Host-tested. |
| `mic_test/` | Module 1, hardware validation: INMP441 → 10 s WAV over USB, with automatic wiring diagnosis. |
| `recorder/` | Module 3, the device firmware: audio, net, spill, UI and button tasks with the state machine. |
| `tools/capture_wav.py` | Saves the WAV that `mic_test` prints. |

> **Verification status:** `lc_core` comes with host unit tests, and its ADPCM codec is checked byte-for-byte against the Python codec's test vectors. The ESP-IDF projects were written against ESP-IDF v5.3 APIs, but neither an ESP-IDF toolchain nor a C compiler was available where they were written. So **neither the firmware nor the host tests have been compiled yet**, and the first build on your machine is the first compile. Report any build errors with the full log.

## 1. Wiring (ESP32-S3-DevKitC-1-N8R8)

| Part | Pin | GPIO | Notes |
|---|---|---|---|
| INMP441 | SCK (BCLK) | 4 | |
| | WS (LRCLK) | 5 | |
| | SD | 6 | 100 kΩ pull-down to GND |
| | L/R | GND | left channel |
| | VDD / GND | 3V3 / GND | 100 nF capacitor across VDD–GND at the mic. **Never 5 V.** |
| SSD1306 0.96" | SDA / SCL | 8 / 9 | address 0x3C. Some modules order the pins GND-VCC, others VCC-GND: check yours. |
| Start button | | 1 | to GND (internal pull-up) |
| Stop button | | 2 | to GND (internal pull-up) |
| Pause/Resume button | | 7 | to GND (internal pull-up) |
| RGB LED (common cathode) | R / G / B | 16 / 17 / 18 | through 220 Ω / 100 Ω / 100 Ω; cathode to GND |

**Pins not used, deliberately:**
- GPIO0, 3, 45, 46: strapping pins.
- GPIO19/20: USB.
- GPIO35–37: octal PSRAM.
- GPIO43/44: serial console.
- GPIO38/48: the board's own RGB LED.

## 2. Toolchain

- ESP-IDF **v5.3 or newer** (it needs the split driver components and the `i2c_master` API).
- On first build, the component manager fetches `espressif/esp_websocket_client` automatically.

```bash
. $IDF_PATH/export.sh            # Windows: run "ESP-IDF 5.3 CMD"
```

## 3. Module 1: microphone validation

```bash
cd firmware/mic_test
idf.py set-target esp32s3 && idf.py build flash
pip install pyserial
python ../tools/capture_wav.py --port COM5 --out mic.wav    # /dev/ttyACM0 on Linux
```

**Expected output:** a `LEVEL` line every 0.5 s, then one `DIAG` line, then `saved mic.wav (320044 bytes)`.

| DIAG | Meaning and fix |
|---|---|
| `ok` | Wiring good. Play `mic.wav`; speech at 1 m should be clearly audible. |
| `stuck` | The same raw word every sample: SD floating or shorted, or SCK and WS swapped. |
| `silent` | Below −70 dBFS: no VDD, L/R not grounded (data comes on the right slot), or SD not connected. |
| `clipping` | Too loud or too close; move the mic away (gain is fixed at +24 dB in the test). |
| `dc_offset` | A large DC offset: check grounding. The high-pass filter removes it in the recorder. |

## 4. Module 3: recorder

### Provisioning (D10)

Copy `recorder/nvs_config.csv.example` to `nvs_config.csv` and fill in:
- Wi-Fi SSID and password,
- `server_url` (`wss://<your-domain>/ws/device`),
- the device UUID and token that the admin web page shows **once** when the device is registered.

Then flash it:

```bash
cd firmware/recorder
python $IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py \
       generate nvs_config.csv nvs_config.bin 0x6000
idf.py set-target esp32s3 && idf.py build flash
esptool.py --chip esp32s3 write_flash 0x9000 nvs_config.bin
idf.py monitor
```

For development you can set the same values with `idf.py menuconfig → Lecture Capture` instead. Values in NVS take precedence. For deployment, enable NVS encryption and flash encryption so the token isn't stored in plaintext (`menuconfig → Security features`).

### Partition table

| Partition | Size | Purpose |
|---|---|---|
| nvs | 24 KB | Wi-Fi, URL, device id, token, session state |
| factory | 3 MB | Application |
| audiobuf | 4.94 MB | 1264 × 4 KB sectors = 632 s of ADPCM offline audio |

The PSRAM ring (`CONFIG_LC_RING_SLOTS=256`) holds 128 s of PCM. Total offline capacity is about **12.7 min**: arithmetic from these sizes, to be **measured** in the soak test.

### Tasks

| Task | Core | Priority | Job |
|---|---|---|---|
| `audio` | 1 | max−3 | I2S DMA (8 × 512 frames = 256 ms of buffering), 24-bit → high-pass → gain → 16-bit, 500 ms chunks into the ring, level meter, 60 s silence warning |
| `net` | 0 | 5 | Wi-Fi with backoff, WSS (certificate bundle), `hello`→`config`, live-first sending (≤ 40 chunks in flight), selective ACKs, `start`/`resume`/`pause`/`stop`, web `command`s, `status` every 1 s while recording (level meter) and 5 s otherwise |
| `spill` | 0 | 4 | Chunks un-ACKed for > 2 s while offline, or ring ≥ 80% full, are ADPCM-encoded into the flash log; refreshes buffer facts |
| `ui` | 0 | 2 | LED every 250 ms, OLED at 2 Hz |
| `buttons` | 0 | 6 | Start / Stop / Pause: ISR → 30 ms settle → 400 ms repeat guard |

### Indicators

| State | LED | OLED |
|---|---|---|
| READY | green | READY, Wi-Fi bars, server OK, prepared lecture title |
| RECORDING | red | `REC hh:mm:ss` (exact audio time), Wi-Fi, level meter |
| RECORDING_OFFLINE | red ↔ yellow at 1 Hz | `REC (offline)`, PSRAM % and flash % |
| PAUSED | slow red blink | `PAUSED hh:mm:ss`, "Press Pause to resume" (no audio is captured) |
| SYNCING / FINALIZING | blue | `Syncing N chunks` |
| ERROR, no Wi-Fi, no server | yellow | Error text; "Start still records" |

The bottom two OLED lines are reserved for warnings:
- `BUFFER FULL – AUDIO NOT SAVED`
- `STORAGE ALMOST FULL` (flash ≥ 90%)
- `NO SPEECH 60 s – Check microphone`

## 5. Host tests (lc_core)

These run from the repository root with any C11 compiler:

```bash
cmake -S firmware/lc_core/test_host -B firmware/lc_core/test_host/build
cmake --build firmware/lc_core/test_host/build
./firmware/lc_core/test_host/build/lc_core_tests        # expect: "N checks, 0 failures"
```

They cover:
- frame encoding and validation;
- ADPCM round-trip and odd-length blocks;
- **byte-exact agreement with the Python codec** (`contracts/test_vectors`);
- selective ACK;
- live-first ring ordering and session isolation;
- the spill policy;
- the flash log: recovery after reboot, ACK persistence, power cut mid-write, never overwriting pending audio;
- backoff bounds.

## 6. Failure points to check first

1. **Flash erase stalls.** During an erase, both cores pause, so audio survives only on the 256 ms of I2S DMA buffering. Measure the worst erase time on your module. If chunks show gaps, raise `DMA_DESC` in `audio.c`.
2. **TLS memory.** If a handshake fails with `MBEDTLS_ERR_SSL_ALLOC_FAILED`, keep `CONFIG_MBEDTLS_DYNAMIC_BUFFER=y`, or allow mbedTLS to use PSRAM (`CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC`).
3. **Campus networks that block NTP.** The device falls back to the server time sent in `config`.
4. **SD line noise.** Keep the mic wires under 15 cm, and keep the 100 kΩ pull-down on SD.
5. **Soak test.** Over 90 minutes, `heap_caps_get_free_size()` in the monitor must stay flat. Log it every minute.

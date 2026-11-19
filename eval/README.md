# Evaluation

These scripts measure the three claims the system makes:
- accurate multilingual transcripts (WER/CER);
- low live latency (p50/p95 per stage);
- no audio lost when the network drops (recovery).

They use the backend's own code (the transcriber, the database models), so they measure what production runs.

| Script | Measures | Needs |
|---|---|---|
| `asr_benchmark.py` | WER, CER and real-time factor per model and language | `pip install -e "backend[asr,eval]"`, a manifest of recordings with reference transcripts |
| `latency_report.py` | p50/p95/max for each stage of `contracts/PROTOCOL.md` §3 | the database of a deployment that recorded lectures |
| `recovery_report.py` | every seq stored exactly once, gaps filled, backlog delay | the database, after a recording with an outage |
| `metrics.py` | the pure functions behind all three | jiwer |

Run everything from `backend/` with its virtual environment, so that `DATABASE_URL` is read the same way the services read it. Use `.venv/bin/python` on Linux and `.venv/Scripts/python` on Windows.

## Tests

```bash
backend/.venv/bin/python -m pytest eval          # 38 tests: normalisation, WER, percentiles, latency pairing, reports
```

## 1. ASR accuracy and speed (choosing `ASR_MODEL`, D11)

Record at least 30 minutes per language in a real classroom with the actual device, then transcribe it by hand. Split it into 1–5 minute files and list them in `eval/data/manifest.jsonl`:

```json
{"audio": "hi/0001.wav", "reference": "आज हम प्रोसेस शेड्यूलिंग पढ़ेंगे", "language": "hi"}
{"audio": "te/0001.wav", "reference_file": "te/0001.txt", "language": "te"}
{"audio": "en/0001.wav", "reference_file": "en/0001.txt", "language": "en"}
```

```bash
cd backend
.venv/bin/python ../eval/asr_benchmark.py --manifest ../eval/data/manifest.jsonl \
    --model small --model medium --model large-v3 --device cpu --compute-type int8
.venv/bin/python ../eval/asr_benchmark.py --manifest ../eval/data/manifest.jsonl --model small --beam 1   # live decoding
```

The output is a table per model and language, and a JSON file in `eval/results/`. The `eval/data/` and `eval/results/` folders are git-ignored because recordings of people are personal data.

**How scoring works:**
- Text is normalised before scoring: NFC; zero-width joiners removed; punctuation, including । and ॥, removed; Indic digits mapped to ASCII; case-folded.
- Vowel signs, viramas and nuktas are kept, because removing them changes Indic words.
- `--fold-nasals` also treats chandrabindu and anusvara as equal.
- WER and CER are corpus-level: total errors divided by total reference words or characters.
- Report CER next to WER for Hindi and Telugu, since word segmentation of transcripts varies.

**How to choose:** pick the smallest model whose WER is acceptable and whose live RTF (`--beam 1`) is at most about 0.3 for each classroom you expect to record at the same time on that machine.

## 2. Latency

During a lecture, keep one browser on the live page: it sends `render.ack`, which supplies the browser-side stages. Then run:

```bash
cd backend
.venv/bin/python ../eval/latency_report.py --last 5 --json ../eval/results/latency.json
```

It prints one row per interval (`capture→gateway_receive`, `gateway_receive→asr_start`, `asr_start→asr_end`, `asr_end→published`, `published→rendered`, `capture→published`, `capture→rendered`), each with n, p50, p95 and max in ms.

**How chunks are paired:**
- `capture` and `gateway_receive` are recorded per chunk.
- `asr_start`, `asr_end` and `published` are recorded per decoding window, with the window's last chunk number. A chunk counts from the first window at or after it, in both chunk number and time.
- So `capture→published` is the time until the chunk's words first appeared, partial or final.

**Clocks:** `capture` uses the device clock (SNTP) and `rendered` uses the browser clock. Intervals that cross clocks include the clock offset; keep both synced with NTP. Outage backlog shows up as a long tail in `capture→gateway_receive`. Use `recovery_report.py` to separate it from live traffic.

## 3. Network recovery

No hardware is needed: the device simulator speaks the exact device protocol.

```bash
cd backend
# 1. Stream a 5-minute WAV with a 60-second outage starting at 30 s:
.venv/bin/python -m tools.device_simulator --url ws://127.0.0.1:8001/ws/device \
    --device-id <uuid> --token <token> --wav lecture.wav --outage 30:60 --speed 1
# 2. Check the lecture it printed:
.venv/bin/python ../eval/recovery_report.py --lecture-id <lecture_id>
```

The report passes, with exit code 0, when:
- every seq from 0 to `last_seq` is stored exactly once;
- every gap the gateway announced is `filled`.

It also reports the backlog delay per gap and the live delay outside the gaps. With the real device, unplug the access point's uplink for the outage instead, and also test a power cut during the outage: on reboot, the spilled flash backlog (D2) must still arrive.

## Not covered here

- **Bedrock model choice (D9):** the LLM and embedding models are configurable, but there is no automated quality benchmark for notes or Ask answers. Review a sample of generated notes per language by hand, and compare Ask results with `cohere.embed-multilingual-v3` against any alternative on the same questions.
- **Firmware timing:** I²S overruns and flash write latency need the board and are not measured here. `firmware/mic_test` checks only the microphone signal (level, clipping, DC offset).

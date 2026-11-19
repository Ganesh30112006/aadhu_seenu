# Presentation Outline (15–18 slides, about 15 minutes)

Each slide has a title, what goes on it, and what to say. Keep text on slides short: diagrams and screenshots carry the content. Diagrams come from [UML.md](UML.md) (export them from mermaid.live). Screenshots come from the running app (`npm run dev:mock` in `frontend/` works without a server).

| # | Slide | On the slide | What to say | Time |
|---|---|---|---|---|
| 1 | Title | Project title, team names and roll numbers, guide, department, college, year | One-sentence summary: "A desk device that turns a lecture into a live multilingual transcript and study material." | 0:30 |
| 2 | The problem | Three short points: students miss content while writing; absent students; English–Telugu–Hindi code-switching | Why ordinary recording does not solve it: nobody re-watches a 50-minute video | 1:00 |
| 3 | Objectives | O1–O8 from the report, as one line each | Point out the two hard ones: no audio loss offline, and live latency | 0:45 |
| 4 | Existing solutions | Table: lecture capture systems, cloud speech APIs, Whisper; their gaps | We combine open ASR, an offline-safe device and grounded AI | 1:00 |
| 5 | Architecture | The architecture diagram (report Chapter 4) | Follow one audio chunk: device → gateway → database → ASR → browser | 1:30 |
| 6 | Hardware | Photo of the built device + the pin table from CIRCUIT.md | ESP32-S3 for PSRAM and dual cores; INMP441 because it is digital | 1:00 |
| 7 | Device states | State machine diagram (UML §5); a photo of the OLED in REC and REC (offline) | The lecturer never has to think about the network | 0:45 |
| 8 | No audio loss | Outage sequence diagram (UML §4) | PSRAM ring, 2-second flash spill, live-first sending, selective ACKs, idempotent storage | 1:30 |
| 9 | Live transcription | Diagram: sliding window + local agreement; screenshot of grey partials becoming black finals | Whisper is not a streaming model; local agreement makes it one | 1:15 |
| 10 | AI study material | Screenshots: Notes, Flashcards, Revision, Ask with "Jump to" links | Everything is grounded in the transcript and links back to the moment it came from | 1:15 |
| 11 | Web application | 4 screenshots: Live page with device monitor, Library, Search, Devices | Roles: student, lecturer, admin | 1:00 |
| 12 | Security and privacy | Bullets: TLS everywhere, hashed device tokens, server-side sessions with CSRF, consent gate, audio retention (DPDP Act 2023) | Recording students' classrooms creates obligations; we built them in | 0:45 |
| 13 | Testing | Table of test suites and counts; the axe accessibility check | Every layer is tested automatically; the end-to-end tests drive a real browser | 0:45 |
| 14 | Results | WER/CER table, latency p50/p95, outage table (measured values from report Chapter 9) | Use only measured numbers. If something is not measured yet, say so. | 1:30 |
| 15 | Live demo | "Demo" title only | Follow [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | 4:00 |
| 16 | Limitations and future work | 3 limitations, 4 future items (report Chapter 11) | Be direct about what is not done | 0:45 |
| 17 | Conclusion | Three outcomes in one line each | Repeat the one-sentence summary | 0:30 |
| 18 | Thank you / Questions | Contact, repository link | — | — |

## Likely questions and short answers

| Question | Answer |
|---|---|
| Why not use a phone as the microphone? | A dedicated device is always in the room, starts with one button, keeps recording offline, and does not depend on a lecturer's phone settings or battery. |
| Why not MicroSD? | PSRAM plus internal flash gives about 12.7 minutes of buffer, which covers normal classroom outages, with fewer parts that can fail or be removed. It is listed as future work for long outages. |
| How do you know no audio was lost? | Every chunk has a sequence number. The server stores each `(lecture, seq)` once and the device frees only acknowledged chunks. `eval/recovery_report.py` checks for missing and duplicate chunks. |
| How accurate is Telugu? | Give the measured CER from Chapter 9 and the model used; explain code-switching and the fixed decode language. |
| What if the AI is wrong? | Material is a draft until the lecturer publishes it; lecturers can edit it; Ask answers cite transcript moments and warn when they cite none. |
| Why AWS Bedrock instead of running an LLM locally? | No GPU is needed on the server, there is a choice of models, and the data stays in the ap-south-1 (Mumbai) region. ASR runs locally because it is continuous and cheap to run on CPU. |
| Why no Docker? | One server, few services: systemd units and system packages are simpler to operate and debug for a college IT team. |
| How much does it cost? | Device parts (list from CIRCUIT.md with local prices) plus the EC2 instance per month plus Bedrock usage per lecture: fill in with current prices. |

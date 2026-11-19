# Demo Script (about 4 minutes)

Two people are best: **Presenter** talks and drives the browser, **Operator** handles the device and the Wi-Fi.

## Setup (before the session)

| Check | How |
|---|---|
| Server running | Open `https://<your-server>/api/health`: it should return `"status": "ok"` |
| Device READY | Green light, title of the prepared demo lecture on the OLED |
| Three browser windows signed in | Lecturer (Live page), Student (same lecture, Live page), Admin (Devices page) |
| A lecture already completed and published | So Notes, Flashcards and Ask have content to show (record one the day before) |
| A way to cut Wi-Fi | A phone hotspot the device uses, which the Operator can switch off |
| Backup | A screen recording of a full run, in case the network in the hall fails |

**No hardware available?** Run the frontend in mock mode:

```bash
cd frontend
npm run dev:mock
```

This serves http://localhost:5173 with simulated live data. Use the demo logins in the main [README](../../README.md). The live lecture "CPU Scheduling Algorithms (Section B)" streams a scripted lecture, including an outage and backfill.

## Script

| Time | Presenter does | Presenter says | Operator does |
|---|---|---|---|
| 0:00 | Shows the device | "This is the recorder: microphone, screen, light, three buttons. It is ready." | Holds the device up |
| 0:15 | — | "I'll start the lecture." | Presses **Start**; the light turns red and the screen shows REC |
| 0:20 | Switches to the student window | "This is what a student sees." | Speaks a few sentences in English, then a sentence in Telugu or Hindi |
| 0:45 | Points at the transcript | "Grey text is provisional; it settles into black final text. Each line is tagged with its language." | Keeps speaking |
| 1:05 | Switches to the lecturer window | "The lecturer sees the microphone level, Wi-Fi and buffers, and can pause from here." | — |
| 1:15 | Clicks **Pause**, then **Resume** | "Pause from the web is relayed to the device." | Shows the device: PAUSED, slow red blink, then REC again |
| 1:30 | — | "Now the classroom Wi-Fi fails." | Switches off the hotspot. Keeps speaking. The light blinks red/yellow; the screen shows REC (offline) |
| 1:50 | Shows the student window | "The device keeps recording into its own memory. The transcript shows a gap." | Keeps speaking for about 20 s |
| 2:15 | — | "Wi-Fi is back." | Switches the hotspot on; the screen shows syncing |
| 2:30 | Points at the gap | "The missed audio uploads in the background, and the gap fills in place. No audio lost, no duplicate lines." | — |
| 2:45 | — | "End of lecture." | Presses **Stop** |
| 2:50 | Opens the prepared, published lecture | "After a lecture, the system writes notes and study material." | — |
| 3:00 | Notes → Revision → Flashcards | "Notes, quick revision points, and flashcards: show answer, next." | — |
| 3:20 | Ask: "Why does a very small time quantum hurt performance?" | "Answers come only from the transcript and link to the exact moment." | — |
| 3:35 | Clicks a **Jump to** link | "This takes me to that moment in the lecture." | — |
| 3:45 | Search for a term across lectures | "And everything is searchable." | — |
| 4:00 | — | "That's the system. Questions?" | — |

## If something goes wrong

| Problem | Recovery |
|---|---|
| The transcript does not appear | Check the device light. If it is yellow, say "the device is offline, so it is buffering", which is itself a feature, then switch to the backup recording. |
| Hall Wi-Fi blocks WebSockets | Use the phone hotspot for both the laptop and the device, or run the mock demo. |
| Bedrock is unavailable | The transcript still works. Show the study material of the lecture prepared the day before. |
| The device does not boot | Show the mock demo and the hardware photo, and explain the wiring from CIRCUIT.md. |

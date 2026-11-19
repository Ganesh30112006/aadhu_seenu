# User Manual

This manual is for the people who use the system day to day: **lecturers**, **students** and **administrators**. Installing the server is covered in [infra/README.md](../../infra/README.md); building the device is covered in [CIRCUIT.md](CIRCUIT.md) and [firmware/README.md](../../firmware/README.md).

Open the website your college gives you (for example `https://lecture.college.edu`) and sign in with the email and password your administrator created.

---

## 1. The recorder device

The device sits on the lecturer's desk. It has a screen, a coloured light and three buttons.

| Button | What it does |
|---|---|
| **Start** | Starts recording. If you prepared a lecture on the website, the recording goes into that lecture. |
| **Pause/Resume** | Pauses recording; press again to resume. While paused, no audio is captured. |
| **Stop** | Ends the recording. The device uploads anything still waiting, then shows READY. |

| Light | Screen | Meaning |
|---|---|---|
| Green | READY | Connected and ready to record |
| Red | REC hh:mm:ss | Recording and uploading live |
| Red ↔ yellow, blinking | REC (offline) | Recording, but the network is down. Audio is kept on the device and uploaded later. **Keep teaching.** |
| Slow red blink | PAUSED | Paused; press Pause/Resume to continue |
| Blue | Syncing N chunks | Uploading audio that was recorded offline |
| Yellow | Error text | No Wi-Fi or no server. Start still records. |

**Warnings on the bottom of the screen:**

| Warning | What to do |
|---|---|
| `NO SPEECH 60 s – Check microphone` | Check that nothing covers the microphone and that you are close to it |
| `STORAGE ALMOST FULL` | The device has been offline for a long time; restore Wi-Fi soon |
| `BUFFER FULL – AUDIO NOT SAVED` | The offline storage (about 12 minutes) is full. New audio is lost until the network returns. |

---

## 2. Lecturers

### 2.1 Before class: prepare the lecture

1. On **Home**, fill in **Prepare a lecture**: subject, title, the main language you will speak, and the device in your room.
2. Tick the consent box to confirm that students have been told the lecture is recorded. Students cannot see a lecture until consent is confirmed.
3. Select **Prepare lecture**. The device screen shows the title.

> If you press Start on the device without preparing, a lecture is still created. Give it a title and confirm consent afterwards from the banner on the lecture page.

### 2.2 During class: the Live page

Open the lecture and select **Open live view**, or go to **Lectures** and choose the lecture marked *Recording*.

- **Start / Pause / Resume / Stop** control the device from the website. They work the same as the physical buttons.
- The **device monitor** shows:
  - the microphone level and whether sound is being picked up;
  - Wi-Fi strength;
  - how full the offline buffers are;
  - how many audio chunks are still waiting to upload.
- The **transcript** grows as you speak:
  - grey text is provisional and may change;
  - black text is final;
  - each line is tagged EN, TE or HI.
- If the network drops, a **gap** marker appears. It fills in automatically when the device reconnects.
- **Correcting a line:** select **Correct this line** on a final line, fix the text and save. Students see the corrected text.

### 2.3 After class: notes and study material

A few minutes after Stop, the system generates:
- notes;
- a summary;
- revision notes;
- key terms;
- flashcards;
- practice questions.

Students cannot see them until you publish.

1. Open the lecture's **Notes** tab and read the draft.
2. Select **Edit notes** to change headings or text (Markdown is supported), then **Save changes**.
3. Select **Regenerate** if you want a fresh version. This replaces your edits.
4. Select **Publish** when you are happy. Students can now see the notes and the other study tabs.

**Export** (top of the lecture page) downloads the transcript, notes or questions.

**Delete** removes the lecture and its audio permanently.

---

## 3. Students

### 3.1 Following a lecture live

Open **Home** or **Lectures**. A lecture that is recording has a *Recording* badge; open it to see the live transcript.
- New lines appear within a few seconds.
- To change the text size, or to show only some languages, open **Settings → Transcript / Languages**.
- If you scroll up to reread something, the page stops following new text. Select **Jump to live** to return.

### 3.2 Studying after a lecture

Each lecture has these tabs:

| Tab | What it is |
|---|---|
| Transcript | The full transcript. Use **Find in transcript** to search it, and the timestamps to share a moment. |
| Notes | Structured notes written from the lecture |
| Summary | A short overview and the key points |
| Revision | Points to remember and the key takeaways, for quick exam revision |
| Key terms | Terms with definitions, each linked to where it was first mentioned |
| Flashcards | One question at a time. Think of the answer, select **Show answer**, then **Next**. **Shuffle** changes the order. |
| Questions | Multiple-choice and short-answer practice. Your answers are not saved or graded. |
| Ask | Ask a question about the lecture. The answer is based only on the transcript, with **Jump to mm:ss** links to the moments it used. |

Study material is AI-generated. If something looks wrong, check it against the transcript and tell your lecturer.

### 3.3 Searching

**Search** looks through every lecture you can see. Each match opens the transcript at that moment.

---

## 4. Administrators

### 4.1 Users and subjects

- **Admin → Users:** add lecturers, students and other administrators; change a role; disable an account (you cannot disable your own).
- **Admin → Subjects:** add subjects (code and name).

### 4.2 Devices

1. **Devices → Register device:** enter a name, the room, and the 12-character serial shown on the device screen at first boot.
2. Copy the **device token** shown. It is shown only once. Put it in the device configuration (`nvs_config.csv`) and flash it.
3. Open the device and, under **Lecturers**, tick who may record with it. Select **Save lecturers**.
4. Under **Device settings**:
   - **Microphone gain** (0.5–16): raise it if lecturers sound quiet, lower it if the audio distorts.
   - **Voice detection:** skips long silences so less audio is uploaded.
   - Both apply the next time the device connects.

### 4.3 Server settings and retention

**Settings → Server** shows the AI models, the speech-recognition model, the device defaults and the **audio retention** policy. These are read-only on the website; they are set in the server configuration file (`/etc/smartclass/backend.env`).

`AUDIO_RETENTION_DAYS` deletes recorded audio after that many days; `0` keeps it forever. Transcripts and notes are kept.

---

## 5. Your settings (everyone)

| Section | Options | Saved where |
|---|---|---|
| Profile | Full name | Your account |
| Password | Change password (signs you out on other devices) | Your account |
| Appearance | Light, dark or match device | This browser |
| Transcript | Text size; follow live text; read new lines aloud with a screen reader | This browser |
| Languages | Show EN/TE/HI labels; show Telugu and Hindi in Latin script; choose which languages to show | This browser |
| Notifications | Messages on the live page when the microphone disconnects or reconnects, when the lecture ends, and when notes are ready | This browser |

---

## 6. Troubleshooting

| Problem | Try this |
|---|---|
| The live transcript is not updating | Check the device light. If it is blinking red/yellow, the device is offline; the text will catch up when it reconnects. Reload the page if your own internet dropped. |
| The device shows yellow and an error | Check the classroom Wi-Fi. You can still press Start: audio is stored on the device. |
| "Notes are still being generated" | Wait a few minutes after the lecture ends, then reload. |
| "Notes haven't been published yet" | The lecturer has not published them. The transcript is still available. |
| A transcript line is wrong | Lecturers can correct it from the Live page or the Transcript tab. |
| Forgotten password | Ask an administrator to set a new one. |

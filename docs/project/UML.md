# UML Diagrams

All diagrams are Mermaid. They render on GitHub and in VS Code with a Mermaid preview extension. To get images for the report, paste each block into https://mermaid.live and export it as PNG or SVG.

## 1. Use case diagram

```mermaid
flowchart LR
  S([Student])
  L([Lecturer])
  A([Administrator])
  D([Recorder device])

  subgraph System[Smart Classroom Lecture Capture]
    UC1(Watch live transcript)
    UC2(Read notes, summary, revision notes)
    UC3(Practise with questions and flashcards)
    UC4(Ask a question about a lecture)
    UC5(Search lectures)
    UC6(Export transcript / notes)
    UC7(Prepare lecture and confirm consent)
    UC8(Start / pause / resume / stop recording)
    UC9(Correct transcript lines)
    UC10(Edit and publish notes)
    UC11(Monitor device)
    UC12(Manage users and subjects)
    UC13(Register device, assign lecturers, set gain)
    UC14(Stream audio and status)
  end

  S --- UC1 & UC2 & UC3 & UC4 & UC5 & UC6
  L --- UC1 & UC5 & UC6 & UC7 & UC8 & UC9 & UC10 & UC11
  A --- UC11 & UC12 & UC13
  D --- UC8 & UC14
```

## 2. Class diagram (data model)

```mermaid
classDiagram
  class User {
    uuid id
    string email
    string name
    Role role
    bool active
    string password_hash
  }
  class WebSession {
    uuid id
    string token_hash
    string csrf_token
    datetime expires_at
  }
  class Subject {
    uuid id
    string code
    string name
  }
  class Device {
    uuid id
    string name
    string room
    string serial
    string token_hash
    float gain
    bool vad_enabled
  }
  class Lecture {
    uuid id
    string title
    LectureStatus status
    uuid session_id
    string language_hint
    bool consent_confirmed
    bool paused
    datetime started_at
    datetime ended_at
  }
  class AudioChunk {
    int seq
    int sample_offset
    int codec
    string storage_key
  }
  class LectureGap {
    uuid id
    int start_ms
    int end_ms
    GapState state
  }
  class TranscriptSegment {
    uuid id
    int start_ms
    int end_ms
    string text
    string language
    SegmentSource source
    vector embedding
  }
  class LectureArtifact {
    ArtifactKind kind
    json content
    string status
    int version
    datetime published_at
  }
  class QaMessage {
    string question
    string answer
    uuid[] cited_segment_ids
  }
  class AuditLog {
    string action
    string target
    datetime at
  }

  User "1" --> "*" WebSession
  User "*" -- "*" Device : device_lecturers
  User "1" --> "*" Lecture : lecturer
  Subject "1" --> "*" Lecture
  Device "1" --> "*" Lecture
  Lecture "1" *-- "*" AudioChunk
  Lecture "1" *-- "*" LectureGap
  Lecture "1" *-- "*" TranscriptSegment
  Lecture "1" *-- "*" LectureArtifact
  Lecture "1" --> "*" QaMessage
  User "1" --> "*" AuditLog : actor
```

`ArtifactKind` is one of: summary, notes, key_terms, questions, flashcards, revision. `LectureStatus` is one of: scheduled, recording, processing, completed, failed.

## 3. Sequence diagram: live lecture

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Recorder device
  participant GW as Device gateway
  participant DB as PostgreSQL
  participant R as Redis
  participant ASR as ASR worker
  participant API as API
  participant B as Student browser

  Dev->>GW: hello (device token)
  GW-->>Dev: config (gain, VAD, prepared lecture)
  Dev->>GW: start {session_id, lecture_id}
  GW->>DB: lecture.status = recording
  B->>API: open /ws/lectures/{id} (last_seq)
  loop every 0.5 s
    Dev->>GW: audio frame (seq n)
    GW->>DB: store chunk (lecture_id, seq) once
    GW-->>Dev: ack {seq, ranges}
    GW->>R: queue lecture for ASR
  end
  ASR->>DB: read new chunks
  ASR->>R: transcript.partial / transcript.final (stream)
  R-->>API: stream entries
  API-->>B: events with seq + server_ts
  B-->>API: render.ack (latency measurement)
  Dev->>GW: stop {session_id, last_seq}
  GW->>R: finalise job
  ASR->>DB: final transcript, status = processing
  ASR->>R: queue notes job
```

## 4. Sequence diagram: Wi-Fi outage and recovery

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Recorder device
  participant GW as Device gateway
  participant ASR as ASR worker
  participant B as Browser

  Dev->>GW: audio seq 100..119 (acked)
  Note over Dev,GW: Wi-Fi drops
  Dev->>Dev: keep recording into PSRAM ring
  Dev->>Dev: chunks older than 2 s → ADPCM → flash log
  Note over Dev: OLED "REC (offline)", LED red↔yellow
  Note over Dev,GW: Wi-Fi returns
  Dev->>GW: hello + resume {session_id}
  GW->>B: transcript.gap {gap_id, start_ms}
  par live first
    Dev->>GW: live chunks seq 240, 241, …
  and backlog in spare bandwidth
    Dev->>GW: backlog seq 120..239
  end
  GW-->>Dev: ack {seq, ranges} (selective)
  Dev->>Dev: free exactly the acknowledged chunks
  ASR->>B: transcript.backfill {gap_id, segments}
  Note over B: gap marker replaced in place, no duplicates
```

## 5. State machine: recorder device

```mermaid
stateDiagram-v2
  [*] --> BOOT
  BOOT --> WIFI_CONNECTING
  WIFI_CONNECTING --> SERVER_CONNECTING : Wi-Fi up
  SERVER_CONNECTING --> READY : hello/config ok
  WIFI_CONNECTING --> ERROR : no Wi-Fi
  SERVER_CONNECTING --> ERROR : server unreachable
  ERROR --> WIFI_CONNECTING : retry with back-off
  READY --> RECORDING : Start (button or web)
  ERROR --> RECORDING_OFFLINE : Start (still records)
  RECORDING --> RECORDING_OFFLINE : connection lost
  RECORDING_OFFLINE --> RECORDING : reconnected
  RECORDING --> PAUSED : Pause (button or web)
  PAUSED --> RECORDING : Resume
  RECORDING --> SYNCING : Stop with backlog
  RECORDING --> FINALIZING : Stop, nothing pending
  RECORDING_OFFLINE --> SYNCING : Stop
  PAUSED --> FINALIZING : Stop
  SYNCING --> FINALIZING : backlog acknowledged
  FINALIZING --> READY : stop acknowledged
```

## 6. Lecture lifecycle

```mermaid
stateDiagram-v2
  [*] --> scheduled : lecturer prepares
  scheduled --> recording : device/web Start
  recording --> recording : pause / resume (paused flag)
  recording --> processing : Stop, transcript finalised
  processing --> completed : study material stored
  processing --> failed : unrecoverable error
  completed --> [*]
```

## 7. Activity diagram: generating study material

```mermaid
flowchart TD
  A[Lecture stopped] --> B[ASR worker finalises transcript]
  B --> C[Queue notes job]
  C --> D[Notes worker loads final segments]
  D --> E[Compute embeddings for search and Ask]
  E --> F{Bedrock available?}
  F -- no --> G[Mark artifacts failed, lecture completed<br/>transcript still usable]
  F -- yes --> H[Generate notes, summary, key terms,<br/>questions, flashcards, revision notes]
  H --> I{Valid JSON for each?}
  I -- no --> J[Retry once, then mark that artifact failed]
  I -- yes --> K[Store as draft artifacts]
  K --> L[Lecturer reviews / edits]
  L --> M[Publish → students can see]
```

## 8. Deployment diagram

```mermaid
flowchart TB
  subgraph Classroom
    DEV[ESP32-S3 recorder]
  end
  subgraph Clients
    BR[Browsers: students, lecturers, admin]
  end
  subgraph EC2[AWS EC2 · Ubuntu 24.04]
    CADDY[Caddy :443 TLS]
    subgraph systemd units
      GW[smartclass-gateway :8001]
      API[smartclass-api :8000]
      ASRW[smartclass-asr]
      NW[smartclass-notes]
    end
    PG[(PostgreSQL 16 + pgvector)]
    RD[(Redis)]
    FS[/Audio files or S3/]
  end
  BEDROCK[Amazon Bedrock ap-south-1]

  DEV -- wss --> CADDY
  BR -- https / wss --> CADDY
  CADDY --> GW & API
  GW --> PG & RD & FS
  API --> PG & RD
  ASRW --> PG & RD & FS
  NW --> PG & RD
  NW --> BEDROCK
  API --> BEDROCK
```

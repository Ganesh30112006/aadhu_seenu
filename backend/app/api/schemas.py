"""REST request/response models. They generate contracts/openapi.json, the source of the
frontend's TypeScript types (`npm run api:generate`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["lecturer", "student", "admin"]
LanguageCode = Literal["en", "te", "hi"]
LectureStatus = Literal["scheduled", "recording", "processing", "completed", "failed"]
ExportFormat = Literal["pdf", "txt", "md"]


class Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorResponse(Model):
    code: str = Field(description="Machine-readable, e.g. invalid_credentials, notes_not_published")
    message: str


class User(Model):
    id: uuid.UUID
    email: str
    full_name: str
    role: Role
    active: bool


class LoginRequest(Model):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class UserCreate(Model):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: Role
    password: str = Field(
        min_length=8, max_length=200, description="Initial password; the user changes it later."
    )


class UserUpdate(Model):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    active: bool | None = None


class Subject(Model):
    id: uuid.UUID
    code: str
    name: str


class SubjectCreate(Model):
    code: str = Field(min_length=2, max_length=16)
    name: str = Field(min_length=2, max_length=120)


class SubjectRef(Model):
    id: uuid.UUID
    code: str
    name: str


class Lecture(Model):
    id: uuid.UUID
    title: str
    subject: SubjectRef | None = Field(description="null for an 'Untitled' lecture started on the device")
    lecturer_id: uuid.UUID | None
    lecturer_name: str | None
    status: LectureStatus
    language: LanguageCode
    languages_detected: list[LanguageCode]
    started_at: datetime | None = Field(
        description="Wall-clock start; transcript offsets are relative to it."
    )
    ended_at: datetime | None
    duration_ms: int
    notes_ready: bool
    notes_published: bool
    consent_confirmed: bool
    device_id: uuid.UUID | None
    created_at: datetime
    paused: bool = Field(description="Capture is paused on the device; status stays 'recording'.")
    audio_available: bool = Field(description="False once the retention policy deleted the audio.")


class LecturePage(Model):
    items: list[Lecture]
    page: int
    page_size: int
    total: int


class LectureCreate(Model):
    subject_id: uuid.UUID
    title: str = Field(min_length=3, max_length=160)
    language: LanguageCode
    device_id: uuid.UUID
    consent_confirmed: Literal[True] = Field(
        description="Recording consent confirmed by the lecturer (required)."
    )


class LectureUpdate(Model):
    title: str | None = Field(default=None, min_length=3, max_length=160)
    subject_id: uuid.UUID | None = None
    consent_confirmed: Literal[True] | None = None


class TranscriptSegment(Model):
    segment_id: str
    start_ms: int
    end_ms: int
    text: str = Field(description="Original script.")
    language: LanguageCode
    confidence: float | None
    transliteration: str | None = Field(description="ISO 15919 romanisation for te/hi; null for en.")
    source: Literal["live", "backfill"]
    edited: bool = Field(description="Corrected by the lecturer after transcription.")


class SegmentUpdate(Model):
    text: str = Field(min_length=1, max_length=2000)


class LectureControl(Model):
    action: Literal["start", "pause", "resume", "stop"]


class ControlAccepted(Model):
    lecture_id: uuid.UUID
    action: Literal["start", "pause", "resume", "stop"]
    device_id: uuid.UUID


class TranscriptGap(Model):
    gap_id: str
    start_ms: int
    end_ms: int


class TranscriptPage(Model):
    items: list[TranscriptSegment]
    next_cursor: str | None
    gaps: list[TranscriptGap] = Field(description="Audio never received (identical on every page).")


class NoteSection(Model):
    id: str
    heading: str
    body_markdown: str
    start_ms: int | None = Field(description="Where the topic starts in the transcript.")


class Notes(Model):
    lecture_id: uuid.UUID
    published: bool
    generation_status: Literal["pending", "ready", "failed"]
    updated_at: datetime
    version: int = Field(description="Optimistic concurrency token sent back on PATCH.")
    sections: list[NoteSection]


class NoteSectionInput(Model):
    id: str | None = Field(description="null for a new section.")
    heading: str = Field(min_length=1, max_length=160)
    body_markdown: str = Field(max_length=20000)


class NotesUpdate(Model):
    version: int
    sections: list[NoteSectionInput] = Field(min_length=1)


class Summary(Model):
    lecture_id: uuid.UUID
    overview: str
    key_points: list[str]
    generated_at: datetime


class KeyTerm(Model):
    id: str
    term: str
    definition: str
    language: LanguageCode
    first_mentioned_ms: int | None


class KeyTermList(Model):
    items: list[KeyTerm]


class McqQuestion(Model):
    id: str
    prompt: str
    options: list[str] = Field(min_length=2)
    correct_index: int = Field(ge=0)
    explanation: str
    source_ms: int | None


class ShortAnswerQuestion(Model):
    id: str
    prompt: str
    model_answer: str
    source_ms: int | None


class QuestionSet(Model):
    lecture_id: uuid.UUID
    mcq: list[McqQuestion]
    short_answer: list[ShortAnswerQuestion]


class Flashcard(Model):
    id: str
    front: str
    back: str
    source_ms: int | None


class FlashcardSet(Model):
    lecture_id: uuid.UUID
    cards: list[Flashcard]


class RevisionNotes(Model):
    lecture_id: uuid.UUID
    points: list[str]
    takeaways: list[str]
    generated_at: datetime


class AskRequest(Model):
    question: str = Field(min_length=3, max_length=500)


class AskResponse(Model):
    answer: str = Field(description="Plain text. Never rendered as HTML.")
    cited_segment_ids: list[str]


class Highlight(Model):
    start: int = Field(ge=0, description="Unicode code-point offset into text (end exclusive below).")
    end: int = Field(ge=0)


class SearchHit(Model):
    segment_id: str
    start_ms: int
    text: str
    language: LanguageCode
    highlights: list[Highlight]


class SearchLecture(Model):
    id: uuid.UUID
    title: str
    subject: SubjectRef | None
    started_at: datetime | None


class SearchGroup(Model):
    lecture: SearchLecture
    hits: list[SearchHit]


class SearchResponse(Model):
    query: str
    total_hits: int
    groups: list[SearchGroup]


class Device(Model):
    id: uuid.UUID
    name: str
    room: str
    serial: str
    firmware_version: str
    online: bool
    wifi_rssi: int | None = Field(description="dBm, null when offline")
    psram_buffer_pct: float
    flash_buffer_pct: float
    recording: bool
    last_seen_at: datetime | None
    current_lecture_id: uuid.UUID | None
    lecturer_ids: list[uuid.UUID]
    paused: bool = Field(description="Recording is paused on the device.")
    level_dbfs: float | None = Field(description="Microphone level over the last status interval.")
    mic_ok: bool | None = Field(description="False after 60 s of silence while recording.")
    pending_chunks: int = Field(description="Audio chunks on the device not yet acknowledged.")
    gain: float = Field(description="Effective microphone gain sent to the device.")
    vad_enabled: bool


class DeviceUpdate(Model):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    room: str | None = Field(default=None, min_length=1, max_length=60)
    gain: float | None = Field(default=None, ge=0.5, le=16, description="Applied on the next connection.")
    vad_enabled: bool | None = None


class DeviceCreate(Model):
    name: str = Field(min_length=2, max_length=60)
    room: str = Field(min_length=1, max_length=60)
    serial: str = Field(pattern=r"^[0-9A-F]{12}$")
    lecturer_ids: list[uuid.UUID] = []


class DeviceRegistered(Model):
    device: Device
    token: str = Field(description="Shown once. Provision it into the device NVS; only its hash is stored.")


class DeviceLecturers(Model):
    lecturer_ids: list[uuid.UUID]


class Health(Model):
    status: Literal["ok", "degraded"]
    database: bool
    redis: bool


class ProfileUpdate(Model):
    full_name: str = Field(min_length=1, max_length=120)


class PasswordChange(Model):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class SystemInfo(Model):
    environment: str
    llm_model: str = Field(description="Empty when no Bedrock model is configured.")
    embedding_model: str
    asr_model: str
    asr_device: str
    prompt_version: str
    audio_retention_days: int = Field(description="0 keeps audio forever.")
    device_gain_default: float
    device_vad_default: bool

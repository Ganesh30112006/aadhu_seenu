"""PostgreSQL schema (brief §4 plus the justified additions noted below)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

EMBEDDING_DIMS = 1024  # cohere.embed-multilingual-v3


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: DateTime(timezone=True), dict[str, Any]: JSONB}  # noqa: RUF012


class Role(enum.StrEnum):
    lecturer = "lecturer"
    student = "student"
    admin = "admin"


class LectureStatus(enum.StrEnum):
    scheduled = "scheduled"
    recording = "recording"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class SegmentSource(enum.StrEnum):
    live = "live"
    backfill = "backfill"


class GapState(enum.StrEnum):
    open = "open"  # announced, audio still on the device
    filled = "filled"  # every chunk arrived, backfill queued
    done = "done"  # transcribed and published
    missing = "missing"  # never arrived (dropped on the device)


class ArtifactKind(enum.StrEnum):
    summary = "summary"
    notes = "notes"
    key_terms = "key_terms"
    questions = "questions"
    flashcards = "flashcards"  # addition (master plan §24)
    revision = "revision"  # addition: revision points + takeaways (master plan §23)


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_enum(Role, "user_role"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class WebSession(Base):
    """Addition (D13): server-side sessions behind the httpOnly cookie, revocable."""

    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    user: Mapped[User] = relationship(lazy="joined")


class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    lecturer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    room: Mapped[str] = mapped_column(String(60), default="")
    serial: Mapped[str] = mapped_column(String(12), unique=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    firmware_version: Mapped[str] = mapped_column(String(32), default="unknown")
    last_seen_at: Mapped[datetime | None]
    last_status: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-device overrides of the defaults sent in `config` (NULL = use the server default).
    gain: Mapped[float | None] = mapped_column(Float)
    vad_enabled: Mapped[bool | None] = mapped_column(Boolean)


class DeviceLecturer(Base):
    """Addition: which lecturers may use (and see) a device."""

    __tablename__ = "device_lecturers"
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Lecture(Base):
    __tablename__ = "lectures"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    lecturer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)  # D3: device session
    title: Mapped[str] = mapped_column(String(160))
    language_hint: Mapped[str] = mapped_column(String(2), default="en")
    status: Mapped[LectureStatus] = mapped_column(
        _enum(LectureStatus, "lecture_status"), default=LectureStatus.scheduled
    )
    consent_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    duration_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    last_seq: Mapped[int | None] = mapped_column(Integer)
    stop_received: Mapped[bool] = mapped_column(Boolean, default=False)
    # Pause keeps status=recording (buffered audio is still transcribed); capture is suspended.
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the retention job deleted the audio (the transcript and notes are kept).
    audio_purged_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    subject: Mapped[Subject | None] = relationship(lazy="joined")
    lecturer: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (Index("ix_lectures_status_created", "status", "created_at"),)


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    sample_offset: Mapped[int] = mapped_column(BigInteger)
    codec: Mapped[int] = mapped_column(SmallInteger)
    duration_ms: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(200))
    capture_unix_ms: Mapped[int] = mapped_column(BigInteger)
    received_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (UniqueConstraint("lecture_id", "seq", name="uq_audio_chunks_lecture_seq"),)


class LectureGap(Base):
    """Addition: seq holes seen by the gateway; drives transcript.gap / backfill."""

    __tablename__ = "lecture_gaps"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    gap_id: Mapped[str] = mapped_column(String(64))
    start_seq: Mapped[int] = mapped_column(Integer)
    end_seq: Mapped[int | None] = mapped_column(Integer)  # inclusive; NULL while open-ended
    state: Mapped[GapState] = mapped_column(_enum(GapState, "gap_state"), default=GapState.open)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (UniqueConstraint("lecture_id", "gap_id", name="uq_gap_lecture_gap"),)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    start_ms: Mapped[int] = mapped_column(BigInteger)
    end_ms: Mapped[int] = mapped_column(BigInteger)
    text: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(2))
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[SegmentSource] = mapped_column(_enum(SegmentSource, "segment_source"))
    transliteration: Mapped[str | None] = mapped_column(Text)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)  # corrected by the lecturer
    tsv: Mapped[Any] = mapped_column(TSVECTOR, Computed("to_tsvector('simple', text)", persisted=True))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMS))

    __table_args__ = (
        Index("ix_segments_lecture_start", "lecture_id", "start_ms"),
        Index("ix_segments_tsv", "tsv", postgresql_using="gin"),
    )


class LectureArtifact(Base):
    __tablename__ = "lecture_artifacts"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    kind: Mapped[ArtifactKind] = mapped_column(_enum(ArtifactKind, "artifact_kind"))
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="ready")  # pending | live | ready | failed
    version: Mapped[int] = mapped_column(Integer, default=1)
    edited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    __table_args__ = (UniqueConstraint("lecture_id", "kind", name="uq_artifact_lecture_kind"),)


class QaMessage(Base):
    __tablename__ = "qa_messages"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    cited_segment_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid), default=list)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class LatencyMark(Base):
    """Addition (brief §4 latency instrumentation): one row per stage timestamp."""

    __tablename__ = "latency_marks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lecture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    seq: Mapped[int | None] = mapped_column(Integer)  # audio chunk seq (stages 1–4)
    event_seq: Mapped[int | None] = mapped_column(Integer)  # live event seq (stages 5–6)
    stage: Mapped[str] = mapped_column(String(24))
    ts_ms: Mapped[int] = mapped_column(BigInteger)

    __table_args__ = (Index("ix_latency_lecture_stage", "lecture_id", "stage"),)


class AsrProgress(Base):
    """Addition: where live ASR has committed up to, so a worker restart resumes cleanly."""

    __tablename__ = "asr_progress"
    lecture_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lectures.id", ondelete="CASCADE"), primary_key=True
    )
    committed_sample: Mapped[int] = mapped_column(BigInteger, default=0)
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)

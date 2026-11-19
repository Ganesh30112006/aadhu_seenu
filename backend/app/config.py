"""Settings from environment variables (and backend/.env). See backend/.env.example."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = Field("development", description="development | production")
    database_url: str = "postgresql+asyncpg://smartclass:smartclass@127.0.0.1:5432/smartclass"
    redis_url: str = "redis://127.0.0.1:6379/0"

    # Audio storage: local directory, or S3 when s3_bucket is set.
    audio_dir: Path = Path("data/audio")
    s3_bucket: str | None = None
    aws_region: str = "ap-south-1"

    # Web sessions
    session_cookie: str = "sc_session"
    csrf_cookie: str = "csrftoken"
    session_ttl_hours: int = 12
    cookie_secure: bool = True
    cors_origins: list[str] = []

    # Device defaults sent in `config`
    device_gain: float = 4.0
    device_vad_enabled: bool = True
    stop_fallback_minutes: int = 10

    # ASR (faster-whisper)
    asr_model: str = "small"
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"
    asr_live_interval_s: float = 1.5
    asr_language_mode: str = Field("fixed", description="fixed (D6) | auto")

    # Bedrock (D9). The LLM model must be one enabled in your AWS account.
    bedrock_llm_model_id: str = ""
    bedrock_embed_model_id: str = "cohere.embed-multilingual-v3"
    embedding_dims: int = 1024
    live_key_terms_interval_s: int = 180
    prompt_version: str = "2026-11-19.1"

    # Data retention (master plan §25, DPDP Act 2023): delete lecture audio this many days after the
    # lecture ends. Transcripts and notes are kept. 0 keeps audio forever.
    audio_retention_days: int = Field(0, ge=0)

    # Live events
    live_stream_ttl_s: int = 24 * 3600

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

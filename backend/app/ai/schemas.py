"""Structured LLM outputs. Every response is validated against these models before storage."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Topic(_Out):
    title: str = Field(min_length=2, max_length=120)
    start_segment: int = Field(ge=0)
    end_segment: int = Field(ge=0)


class TopicSplit(_Out):
    topics: list[Topic] = Field(min_length=1, max_length=20)


class TermOut(_Out):
    term: str = Field(min_length=1, max_length=80)
    definition: str = Field(min_length=3, max_length=400)


class TopicNotes(_Out):
    heading: str = Field(min_length=2, max_length=160)
    body_markdown: str = Field(min_length=20, max_length=8000)
    key_terms: list[TermOut] = Field(default_factory=list, max_length=10)


class LectureSummary(_Out):
    overview: str = Field(min_length=40, max_length=2000)
    key_points: list[str] = Field(min_length=3, max_length=8)


class McqOut(_Out):
    prompt: str = Field(min_length=5, max_length=400)
    options: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=5, max_length=600)
    source_segment: int | None = None

    @model_validator(mode="after")
    def distinct_options(self) -> McqOut:
        if len({o.strip().lower() for o in self.options}) != 4:
            raise ValueError("MCQ options must be distinct")
        return self


class ShortAnswerOut(_Out):
    prompt: str = Field(min_length=5, max_length=400)
    model_answer: str = Field(min_length=10, max_length=1200)
    source_segment: int | None = None


class QuestionsOut(_Out):
    mcq: list[McqOut] = Field(min_length=3, max_length=10)
    short_answer: list[ShortAnswerOut] = Field(min_length=1, max_length=5)


class FlashcardOut(_Out):
    front: str = Field(min_length=3, max_length=200)
    back: str = Field(min_length=3, max_length=600)
    source_segment: int | None = None


class FlashcardsOut(_Out):
    cards: list[FlashcardOut] = Field(min_length=5, max_length=20)


class RevisionOut(_Out):
    points: list[str] = Field(min_length=5, max_length=15)
    takeaways: list[str] = Field(min_length=3, max_length=6)


class LiveKeyTerms(_Out):
    terms: list[TermOut] = Field(default_factory=list, max_length=8)


class QaAnswer(_Out):
    covered: bool
    answer: str = Field(max_length=2000)
    cited_segment_ids: list[str] = Field(default_factory=list, max_length=8)

"""GET /search: PostgreSQL `simple` full-text search plus substring (pg_trgm-indexed) matching,
because the built-in stemmers do not support Telugu. Results are grouped by lecture."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api import schemas
from app.api.deps import CurrentUser, Db
from app.api.errors import ApiError
from app.api.routes.lectures import _visibility
from app.api.text import escape_like, find_matches
from app.db.models import Lecture, TranscriptSegment

router = APIRouter(tags=["search"])
MAX_ROWS = 400
HITS_PER_LECTURE = 8


@router.get(
    "/search", response_model=schemas.SearchResponse, responses={422: {"model": schemas.ErrorResponse}}
)
async def search(
    user: CurrentUser, db: Db, q: Annotated[str, Query(max_length=200)], subject_id: uuid.UUID | None = None
) -> schemas.SearchResponse:
    query = q.strip()
    if len(query) < 2:
        raise ApiError(422, "query_too_short", "Type at least 2 characters.")
    tsquery = func.plainto_tsquery("simple", query)
    pattern = f"%{escape_like(query)}%"
    rank = func.ts_rank(TranscriptSegment.tsv, tsquery)
    stmt = (
        select(TranscriptSegment, Lecture)
        .join(Lecture, Lecture.id == TranscriptSegment.lecture_id)
        .where(_visibility(user))  # type: ignore[arg-type]
        .where(
            or_(TranscriptSegment.tsv.op("@@")(tsquery), TranscriptSegment.text.ilike(pattern, escape="\\"))
        )
        .order_by(rank.desc(), TranscriptSegment.start_ms)
        .limit(MAX_ROWS)
    )
    if subject_id is not None:
        stmt = stmt.where(Lecture.subject_id == subject_id)
    groups: dict[uuid.UUID, schemas.SearchGroup] = {}
    total = 0
    for segment, lecture in (await db.execute(stmt)).unique().all():
        highlights = find_matches(segment.text, query)
        if not highlights:  # matched individual words via FTS: highlight each word
            highlights = sorted(h for word in query.split() for h in find_matches(segment.text, word))
        total += 1
        group = groups.get(lecture.id)
        if group is None:
            group = schemas.SearchGroup(
                lecture=schemas.SearchLecture(
                    id=lecture.id,
                    title=lecture.title,
                    subject=schemas.SubjectRef.model_validate(lecture.subject) if lecture.subject else None,
                    started_at=lecture.started_at,
                ),
                hits=[],
            )
            groups[lecture.id] = group
        if len(group.hits) < HITS_PER_LECTURE:
            group.hits.append(
                schemas.SearchHit(
                    segment_id=str(segment.id),
                    start_ms=segment.start_ms,
                    text=segment.text,
                    language=segment.language,
                    highlights=[schemas.Highlight(start=s, end=e) for s, e in highlights],
                )
            )
    ordered = sorted(groups.values(), key=lambda g: len(g.hits), reverse=True)
    for group in ordered:
        group.hits.sort(key=lambda h: h.start_ms)
    return schemas.SearchResponse(query=query, total_hits=total, groups=ordered)

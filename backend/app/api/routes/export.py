"""GET /lectures/{id}/export?format=pdf|txt|md."""

from __future__ import annotations

import asyncio
import html
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.api import schemas
from app.api.deps import CurrentUser, Db, can_edit
from app.api.errors import ApiError
from app.api.lectures_view import visible_lecture
from app.db.models import ArtifactKind, Lecture, LectureArtifact, TranscriptSegment, User

router = APIRouter(tags=["export"])

PDF_CSS = """
@page { size: A4; margin: 18mm 16mm;
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 9pt; } }
body { font-family: 'Noto Sans', 'Noto Sans Telugu', 'Noto Sans Devanagari', sans-serif;
  font-size: 10.5pt; line-height: 1.55; color: #1b1e22; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin-top: 16pt; border-bottom: 1px solid #ccc; }
h3 { font-size: 11.5pt; } .meta { color: #555; margin-bottom: 12pt; }
table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 3pt 6pt; }
.seg { margin: 0 0 4pt; } .t { color: #555; font-family: monospace; margin-right: 6pt; }
"""


def _offset(ms: int) -> str:
    s = ms // 1000
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "lecture"


async def _material(
    db: Any, user: User, lecture: Lecture
) -> tuple[list[TranscriptSegment], dict[ArtifactKind, LectureArtifact]]:
    segments = list(
        (
            await db.execute(
                select(TranscriptSegment)
                .where(TranscriptSegment.lecture_id == lecture.id)
                .order_by(TranscriptSegment.start_ms)
            )
        ).scalars()
    )
    staff = can_edit(user, lecture)
    artifacts = {
        a.kind: a
        for a in (
            await db.execute(select(LectureArtifact).where(LectureArtifact.lecture_id == lecture.id))
        ).scalars()
        if a.status == "ready" and (staff or a.published_at is not None)
    }
    return segments, artifacts


def build_markdown(
    lecture: Lecture, segments: list[TranscriptSegment], artifacts: dict[ArtifactKind, LectureArtifact]
) -> str:
    lines = [f"# {lecture.title}", ""]
    meta = [
        m
        for m in (
            lecture.subject and f"{lecture.subject.code} · {lecture.subject.name}",
            lecture.lecturer and lecture.lecturer.name,
        )
        if m
    ]
    if meta:
        lines += [f"*{' · '.join(meta)}*", ""]
    if summary := artifacts.get(ArtifactKind.summary):
        lines += (
            ["## Summary", "", summary.content["overview"], ""]
            + [f"- {p}" for p in summary.content["key_points"]]
            + [""]
        )
    if notes := artifacts.get(ArtifactKind.notes):
        lines += ["## Notes", ""]
        for section in notes.content.get("sections", []):
            lines += [f"### {section['heading']}", "", section["body_markdown"], ""]
    if terms := artifacts.get(ArtifactKind.key_terms):
        lines += (
            ["## Key terms", ""]
            + [f"- **{t['term']}**: {t['definition']}" for t in terms.content.get("items", [])]
            + [""]
        )
    if revision := artifacts.get(ArtifactKind.revision):
        lines += (
            ["## Revision notes", ""]
            + [f"- {p}" for p in revision.content.get("points", [])]
            + ["", "**Takeaways**", ""]
            + [f"- {t}" for t in revision.content.get("takeaways", [])]
            + [""]
        )
    if cards := artifacts.get(ArtifactKind.flashcards):
        lines += ["## Flashcards", ""]
        for card in cards.content.get("cards", []):
            lines += [f"- **Q:** {card['front']}", f"  **A:** {card['back']}"]
        lines += [""]
    lines += ["## Transcript", ""] + [f"- **{_offset(s.start_ms)}** {s.text}" for s in segments]
    return "\n".join(lines) + "\n"


def build_pdf(markdown_text: str, title: str) -> bytes:
    try:
        from markdown_it import MarkdownIt
        from weasyprint import HTML
    except (ImportError, OSError) as exc:  # OSError: Pango/HarfBuzz system libraries missing
        raise ApiError(501, "export_unavailable", "PDF export is not installed on this server.") from exc
    # html=False: any raw HTML in lecturer-edited notes is shown as text, never rendered.
    body = MarkdownIt("commonmark", {"html": False}).enable("table").render(markdown_text)
    head = f"<meta charset='utf-8'><title>{html.escape(title)}</title><style>{PDF_CSS}</style>"
    document = f"<!doctype html><html><head>{head}</head><body>{body}</body></html>"
    pdf: bytes = HTML(string=document).write_pdf()
    return pdf


@router.get(
    "/lectures/{lecture_id}/export",
    responses={
        200: {
            "content": {"application/pdf": {}, "text/plain": {}, "text/markdown": {}},
            "description": "File download",
        },
        404: {"model": schemas.ErrorResponse},
        501: {"model": schemas.ErrorResponse},
    },
    response_class=Response,
)
async def export_lecture(
    lecture_id: uuid.UUID, user: CurrentUser, db: Db, format: Annotated[schemas.ExportFormat, Query()]
) -> Response:
    lecture = await visible_lecture(db, user, lecture_id)
    segments, artifacts = await _material(db, user, lecture)
    name = _slug(lecture.title)
    if format == "txt":
        text = "\n".join([lecture.title, ""] + [f"[{_offset(s.start_ms)}] {s.text}" for s in segments]) + "\n"
        content, media, ext = text.encode(), "text/plain; charset=utf-8", "txt"
    else:
        markdown_text = build_markdown(lecture, segments, artifacts)
        if format == "md":
            content, media, ext = markdown_text.encode(), "text/markdown; charset=utf-8", "md"
        else:
            content = await asyncio.to_thread(build_pdf, markdown_text, lecture.title)
            media, ext = "application/pdf", "pdf"
    return Response(
        content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}.{ext}"'}
    )

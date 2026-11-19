import { format, parseISO } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import type { Lecture, LecturePage, TranscriptPage } from '@/api/types';
import { getDb } from '../db';
import { ensureRun, scheduleAutoStart, syncLecture, transcribedSoFar } from '../live/simulator';
import { buildExport, chunkedStream } from './exportFile';
import { API, body, csrfFailure, error, json, latency, param, requireUser } from './util';

const LectureCreateBody = z.object({
  subject_id: z.string().min(1),
  title: z.string().trim().min(3, 'title must be at least 3 characters').max(160),
  language: z.enum(['en', 'te', 'hi']),
  device_id: z.string().min(1),
  consent_confirmed: z.literal(true),
});

const sortKey = (l: Lecture): number => Date.parse(l.started_at ?? l.created_at);
const localDate = (l: Lecture): string =>
  format(parseISO(l.started_at ?? l.created_at), 'yyyy-MM-dd');

function findLecture(id: string): Lecture | undefined {
  const lecture = getDb().lectures.find((l) => l.id === id);
  return lecture === undefined ? undefined : syncLecture(lecture);
}

export function segmentsFor(lecture: Lecture) {
  const run = lecture.status === 'recording' ? ensureRun(lecture) : null;
  const stored = getDb().transcripts.get(lecture.id) ?? { segments: [], gaps: [] };
  return run === null ? stored : { segments: transcribedSoFar(run), gaps: [] };
}

export const lectureHandlers = [
  http.get(`${API}/lectures`, async ({ request }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const url = new URL(request.url);
    const subjectId = url.searchParams.get('subject_id');
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const status = url.searchParams.get('status');
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('page_size') ?? '30') || 30),
    );
    const filtered = getDb()
      .lectures.map(syncLecture)
      .filter((l) => subjectId === null || l.subject?.id === subjectId)
      .filter((l) => status === null || l.status === status)
      .filter((l) => from === null || localDate(l) >= from)
      .filter((l) => to === null || localDate(l) <= to)
      .filter(
        (l) =>
          q === '' ||
          `${l.title} ${l.subject?.name ?? ''} ${l.subject?.code ?? ''} ${l.lecturer_name ?? ''}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => sortKey(b) - sortKey(a));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    return json<LecturePage>({ items, page, page_size: pageSize, total: filtered.length });
  }),

  http.post(`${API}/lectures`, async ({ request }) => {
    await latency(250, 600);
    const guard = requireUser('lecturer');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(request, LectureCreateBody);
    if ('invalid' in parsed) return parsed.invalid;
    const db = getDb();
    const subject = db.subjects.find((s) => s.id === parsed.data.subject_id);
    if (subject === undefined)
      return error(422, 'unknown_subject', 'Choose a subject from the list.');
    const device = db.devices.find((d) => d.id === parsed.data.device_id);
    if (!device?.assignedTo.includes(guard.user.id)) {
      return error(403, 'device_not_assigned', 'This device is not assigned to you.');
    }
    if (device.recording) {
      return error(409, 'device_busy', 'This device is already recording another lecture.');
    }
    const now = new Date().toISOString();
    const lecture: Lecture = {
      id: crypto.randomUUID(),
      title: parsed.data.title,
      subject: { id: subject.id, code: subject.code, name: subject.name },
      lecturer_id: guard.user.id,
      lecturer_name: guard.user.full_name,
      status: 'scheduled',
      language: parsed.data.language,
      languages_detected: [parsed.data.language],
      started_at: null,
      ended_at: null,
      duration_ms: 0,
      notes_ready: false,
      notes_published: false,
      device_id: device.id,
      consent_confirmed: true,
      created_at: now,
      paused: false,
      audio_available: true,
    };
    db.lectures.unshift(lecture);
    db.transcripts.set(lecture.id, { segments: [], gaps: [] });
    ensureRun(lecture);
    scheduleAutoStart(lecture.id);
    return json<Lecture>(lecture, 201);
  }),

  http.get(`${API}/lectures/:lecture_id`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const lecture = findLecture(param(params, 'lecture_id'));
    if (lecture === undefined)
      return error(404, 'lecture_not_found', 'This lecture does not exist.');
    return json<Lecture>(lecture);
  }),

  http.get(`${API}/lectures/:lecture_id/transcript`, async ({ params, request }) => {
    await latency(150, 450);
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const lecture = findLecture(param(params, 'lecture_id'));
    if (lecture === undefined)
      return error(404, 'lecture_not_found', 'This lecture does not exist.');
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get('cursor') ?? '0') || 0;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? '200') || 200));
    const { segments, gaps } = segmentsFor(lecture);
    const items = segments.slice(offset, offset + limit);
    const next = offset + limit < segments.length ? String(offset + limit) : null;
    return json<TranscriptPage>({ items, next_cursor: next, gaps });
  }),

  http.get(`${API}/lectures/:lecture_id/export`, async ({ params, request }) => {
    await latency(300, 800);
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const lecture = findLecture(param(params, 'lecture_id'));
    if (lecture === undefined)
      return error(404, 'lecture_not_found', 'This lecture does not exist.');
    const formatParam = new URL(request.url).searchParams.get('format');
    if (formatParam !== 'pdf' && formatParam !== 'txt' && formatParam !== 'md') {
      return error(422, 'invalid_format', 'format must be pdf, txt or md.');
    }
    const notes = getDb().notes.get(lecture.id) ?? null;
    const file = buildExport(formatParam, lecture, segmentsFor(lecture).segments, notes);
    return new HttpResponse(chunkedStream(file.bytes, 10, getDb().latency ? 140 : 0), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.bytes.length),
        'Content-Disposition': `attachment; filename="${file.filename}"`,
      },
    });
  }),
];

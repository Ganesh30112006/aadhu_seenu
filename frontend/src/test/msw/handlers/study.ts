import { http } from 'msw';
import { z } from 'zod';
import type {
  AskResponse,
  FlashcardSet,
  RevisionNotes,
  KeyTermList,
  Notes,
  QuestionSet,
  Summary,
  TranscriptSegment,
} from '@/api/types';
import { LECTURE_IDS } from '../../fixtures/lectures';
import { getDb } from '../db';
import { ensureRun, runFor } from '../live/simulator';
import { segmentsFor } from './lectures';
import { API, body, csrfFailure, error, json, latency, param, requireUser } from './util';

const NotesUpdateBody = z.object({
  version: z.number().int(),
  sections: z
    .array(
      z.object({
        id: z.string().nullable(),
        heading: z.string().trim().min(1, 'Every section needs a heading').max(160),
        body_markdown: z.string().max(20_000),
      }),
    )
    .min(1, 'Notes need at least one section'),
});

function lectureOr404(id: string) {
  return getDb().lectures.find((l) => l.id === id) ?? null;
}

const STOPWORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'with',
  'does',
  'that',
  'this',
  'from',
  'about',
  'there',
  'their',
  'have',
  'into',
  'than',
  'explain',
  'lecture',
  'between',
]);

/** Canned grounded answers for the fixture lecture (the real backend uses Amazon Bedrock). */
const ANSWERS: { keys: string[]; answer: string }[] = [
  {
    keys: ['convoy'],
    answer:
      'The convoy effect happens under FCFS: short processes wait behind one long CPU-bound process, so CPU and device utilisation drop.',
  },
  {
    keys: ['starvation', 'aging', 'ageing'],
    answer:
      'Starvation is when a low-priority process waits indefinitely. The lecture’s fix is aging: gradually raise the priority of processes that have waited a long time, for example by one every fifteen minutes.',
  },
  {
    keys: ['quantum', 'round', 'robin'],
    answer:
      'Round Robin gives each process one time quantum, then moves it to the back of the queue. Too small a quantum causes many context switches; too large behaves like FCFS. About 80% of CPU bursts should be shorter than the quantum.',
  },
  {
    keys: ['shortest', 'sjf', 'srtf', 'exponential', 'burst'],
    answer:
      'SJF runs the process with the shortest next CPU burst and is optimal for average waiting time. The next burst is predicted with exponential averaging: τ(n+1) = α·t(n) + (1 − α)·τ(n). SRTF is its preemptive version.',
  },
  {
    keys: ['waiting', 'turnaround', 'response'],
    answer:
      'Turnaround time is completion minus arrival; waiting time is turnaround minus burst; response time is the time until a process first gets the CPU.',
  },
];

function answerFor(question: string, segments: readonly TranscriptSegment[]): AskResponse {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const scored = segments
    .map((s) => ({ s, score: words.filter((w) => s.text.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.start_ms - b.s.start_ms)
    .slice(0, 3)
    .sort((a, b) => a.s.start_ms - b.s.start_ms);
  if (scored.length === 0) {
    return { answer: 'This is not covered in this lecture.', cited_segment_ids: [] };
  }
  const canned = ANSWERS.find((a) => a.keys.some((k) => words.includes(k)));
  return {
    answer: canned?.answer ?? `The lecture touches on this: “${scored[0]?.s.text ?? ''}”`,
    cited_segment_ids: scored.map(({ s }) => s.segment_id),
  };
}

export const studyHandlers = [
  http.get(`${API}/lectures/:lecture_id/notes`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const id = param(params, 'lecture_id');
    if (lectureOr404(id) === null)
      return error(404, 'lecture_not_found', 'This lecture does not exist.');
    const notes = getDb().notes.get(id);
    if (notes === undefined)
      return error(404, 'notes_not_ready', 'Notes have not been generated yet.');
    if (guard.user.role === 'student' && !notes.published) {
      return error(404, 'notes_not_published', 'The lecturer has not published these notes yet.');
    }
    return json<Notes>(notes);
  }),

  http.patch(`${API}/lectures/:lecture_id/notes`, async ({ params, request }) => {
    await latency(250, 600);
    const guard = requireUser('lecturer', 'admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const id = param(params, 'lecture_id');
    const current = getDb().notes.get(id);
    if (current === undefined)
      return error(404, 'notes_not_ready', 'Notes have not been generated yet.');
    const parsed = await body(request, NotesUpdateBody);
    if ('invalid' in parsed) return parsed.invalid;
    if (parsed.data.version !== current.version) {
      return error(409, 'version_conflict', 'These notes were changed elsewhere.');
    }
    const updated: Notes = {
      ...current,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
      sections: parsed.data.sections.map((s, index) => {
        const previous = current.sections.find((p) => p.id === s.id);
        return {
          id: s.id ?? `n-new-${String(Date.now())}-${String(index)}`,
          heading: s.heading,
          body_markdown: s.body_markdown,
          start_ms: previous?.start_ms ?? null,
        };
      }),
    };
    getDb().notes.set(id, updated);
    return json<Notes>(updated);
  }),

  http.post(`${API}/lectures/:lecture_id/notes/regenerate`, async ({ params, request }) => {
    await latency();
    const guard = requireUser('lecturer', 'admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const id = param(params, 'lecture_id');
    const current = getDb().notes.get(id);
    if (current === undefined)
      return error(404, 'notes_not_ready', 'Notes have not been generated yet.');
    const pending: Notes = {
      ...current,
      generation_status: 'pending',
      version: current.version + 1,
    };
    getDb().notes.set(id, pending);
    setTimeout(
      () => {
        const latest = getDb().notes.get(id);
        if (latest?.generation_status === 'pending') {
          getDb().notes.set(id, {
            ...latest,
            generation_status: 'ready',
            updated_at: new Date().toISOString(),
          });
        }
      },
      getDb().latency ? 4_000 : 0,
    );
    return json<Notes>(pending, 202);
  }),

  http.post(`${API}/lectures/:lecture_id/publish`, async ({ params, request }) => {
    await latency();
    const guard = requireUser('lecturer', 'admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const id = param(params, 'lecture_id');
    const current = getDb().notes.get(id);
    const lecture = lectureOr404(id);
    if (current === undefined || lecture === null)
      return error(404, 'notes_not_ready', 'Notes have not been generated yet.');
    if (current.generation_status !== 'ready')
      return error(409, 'notes_pending', 'Wait for regeneration to finish.');
    const published: Notes = { ...current, published: true };
    getDb().notes.set(id, published);
    lecture.notes_published = true;
    return json<Notes>(published);
  }),

  http.get(`${API}/lectures/:lecture_id/summary`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const summary = getDb().summaries.get(param(params, 'lecture_id'));
    if (summary === undefined)
      return error(404, 'summary_not_ready', 'The summary is not ready yet.');
    return json<Summary>(summary);
  }),

  http.get(`${API}/lectures/:lecture_id/key-terms`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const id = param(params, 'lecture_id');
    const lecture = lectureOr404(id);
    if (lecture === null) return error(404, 'lecture_not_found', 'This lecture does not exist.');
    const run = lecture.status === 'recording' ? (runFor(id) ?? ensureRun(lecture)) : null;
    if (run !== null) {
      const heard = new Set(segmentsFor(lecture).segments.map((s) => s.start_ms));
      // A live lecture follows the fixture script, so its terms come from the fixture lecture.
      const items = (getDb().keyTerms.get(LECTURE_IDS.scheduling) ?? []).filter(
        (t) => t.first_mentioned_ms !== null && heard.has(t.first_mentioned_ms),
      );
      return json<KeyTermList>({ items });
    }
    const terms = getDb().keyTerms.get(id);
    if (terms === undefined)
      return error(404, 'key_terms_not_ready', 'Key terms are not ready yet.');
    return json<KeyTermList>({ items: terms });
  }),

  http.get(`${API}/lectures/:lecture_id/questions`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const questions = getDb().questions.get(param(params, 'lecture_id'));
    if (questions === undefined)
      return error(404, 'questions_not_ready', 'Questions are not ready yet.');
    return json<QuestionSet>(questions);
  }),

  http.get(`${API}/lectures/:lecture_id/flashcards`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const cards = getDb().flashcards.get(param(params, 'lecture_id'));
    if (cards === undefined)
      return error(404, 'flashcards_not_ready', 'Flashcards are not ready yet.');
    return json<FlashcardSet>(cards);
  }),

  http.get(`${API}/lectures/:lecture_id/revision`, async ({ params }) => {
    await latency();
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const revision = getDb().revision.get(param(params, 'lecture_id'));
    if (revision === undefined)
      return error(404, 'revision_not_ready', 'Revision notes are not ready yet.');
    return json<RevisionNotes>(revision);
  }),

  http.post(`${API}/lectures/:lecture_id/ask`, async ({ params, request }) => {
    await latency(900, 1600);
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const lecture = lectureOr404(param(params, 'lecture_id'));
    if (lecture === null) return error(404, 'lecture_not_found', 'This lecture does not exist.');
    const parsed = await body(request, z.object({ question: z.string().trim().min(3).max(500) }));
    if ('invalid' in parsed) return parsed.invalid;
    return json<AskResponse>(answerFor(parsed.data.question, segmentsFor(lecture).segments));
  }),
];

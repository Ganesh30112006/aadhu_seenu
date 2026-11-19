import type {
  FlashcardSet,
  RevisionNotes,
  KeyTerm,
  Lecture,
  Notes,
  QuestionSet,
  Subject,
  Summary,
  TranscriptGap,
  TranscriptSegment,
} from '@/api/types';
import { buildLectures, LECTURE_IDS } from '../fixtures/lectures';
import {
  buildDevices,
  MOCK_SUBJECTS,
  MOCK_USERS,
  type MockDevice,
  type MockUser,
} from '../fixtures/people';
import {
  buildSchedulingFlashcards,
  buildSchedulingKeyTerms,
  buildSchedulingNotes,
  buildSchedulingQuestions,
  buildSchedulingRevision,
  buildSchedulingSummary,
  buildSemaphoreNotes,
} from '../fixtures/study';

/** In-memory backend state for MSW. Reset between tests; persisted session in mock mode. */
export interface MockDb {
  createdAt: number;
  users: MockUser[];
  sessionUserId: string | null;
  failedLogins: number;
  subjects: Subject[];
  devices: MockDevice[];
  lectures: Lecture[];
  transcripts: Map<string, { segments: TranscriptSegment[]; gaps: TranscriptGap[] }>;
  notes: Map<string, Notes>;
  summaries: Map<string, Summary>;
  keyTerms: Map<string, KeyTerm[]>;
  questions: Map<string, QuestionSet>;
  flashcards: Map<string, FlashcardSet>;
  revision: Map<string, RevisionNotes>;
  /** Simulated network latency for REST calls (off in unit tests). */
  latency: boolean;
}

const SESSION_KEY = 'smart-classroom-mock-session';

function readPersistedSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function persistSession(userId: string | null): void {
  try {
    if (userId === null) window.sessionStorage.removeItem(SESSION_KEY);
    else window.sessionStorage.setItem(SESSION_KEY, userId);
  } catch {
    // Storage unavailable (private mode): the mock session just won't survive a reload.
  }
}

function createDb(latency: boolean): MockDb {
  const now = Date.now();
  const { lectures, transcripts, sectionStarts } = buildLectures(now);
  const main = transcripts.get(LECTURE_IDS.scheduling)?.segments ?? [];
  const mainLecture = lectures.find((l) => l.id === LECTURE_IDS.scheduling);
  const generatedAt = mainLecture?.ended_at ?? new Date(now).toISOString();
  return {
    createdAt: now,
    users: MOCK_USERS.map((u) => ({ ...u })),
    sessionUserId: readPersistedSession(),
    failedLogins: 0,
    subjects: MOCK_SUBJECTS.map((s) => ({ ...s })),
    devices: buildDevices(now, LECTURE_IDS.schedulingLive),
    lectures,
    transcripts,
    notes: new Map([
      [LECTURE_IDS.scheduling, buildSchedulingNotes(sectionStarts, generatedAt)],
      [LECTURE_IDS.semaphores, buildSemaphoreNotes(new Date(now - 5 * 86_400_000).toISOString())],
    ]),
    summaries: new Map([[LECTURE_IDS.scheduling, buildSchedulingSummary(generatedAt)]]),
    keyTerms: new Map([[LECTURE_IDS.scheduling, buildSchedulingKeyTerms(main)]]),
    questions: new Map([[LECTURE_IDS.scheduling, buildSchedulingQuestions(main)]]),
    flashcards: new Map([[LECTURE_IDS.scheduling, buildSchedulingFlashcards(main)]]),
    revision: new Map([[LECTURE_IDS.scheduling, buildSchedulingRevision(generatedAt)]]),
    latency,
  };
}

let db: MockDb | null = null;
let latencyEnabled = true;

export function getDb(): MockDb {
  db ??= createDb(latencyEnabled);
  return db;
}

export function resetMockDb(): void {
  db = null;
  persistSession(null);
}

export function setMockLatency(enabled: boolean): void {
  latencyEnabled = enabled;
  if (db !== null) db.latency = enabled;
}

export function currentUser(): MockUser | null {
  const state = getDb();
  return state.users.find((u) => u.id === state.sessionUserId && u.active) ?? null;
}

/** Strips mock-only fields before a record leaves the mock server. */
export function publicUser({ password: _password, ...user }: MockUser) {
  return user;
}

export function publicDevice({ assignedTo: _assigned, ...device }: MockDevice) {
  return device;
}

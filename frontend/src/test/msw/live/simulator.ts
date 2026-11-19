import type { Lecture, TranscriptSegment } from '@/api/types';
import { LECTURE_IDS } from '../../fixtures/lectures';
import { OFFLINE_GAP } from '../../fixtures/transcript';
import { getDb } from '../db';
import { buildLiveEvents, lastEventAt, type LiveEvent } from './events';

/** Seconds after "Prepare lecture" at which the simulated lecturer presses the device button. */
export const AUTO_START_DELAY_MS = 3_000;

interface LiveRun {
  lectureId: string;
  events: LiveEvent[];
  segments: readonly TranscriptSegment[];
  durationMs: number;
  /** null until recording starts (lecture is "scheduled"). */
  baseWall: number | null;
  baseElapsed: number;
  speed: number;
}

const runs = new Map<string, LiveRun>();
const autoStartTimers = new Set<ReturnType<typeof setTimeout>>();
const dropListeners = new Set<(lectureId: string) => void>();

function scriptFor(
  lecture: Lecture,
  withGap: boolean,
): Omit<LiveRun, 'baseWall' | 'baseElapsed' | 'speed'> {
  const db = getDb();
  const segments = db.transcripts.get(LECTURE_IDS.scheduling)?.segments ?? [];
  const keyTerms = db.keyTerms.get(LECTURE_IDS.scheduling) ?? [];
  const durationMs = segments.at(-1)?.end_ms ?? 0;
  const events = [
    {
      at: -1,
      seq: 0,
      body: { type: 'lecture.status', status: 'scheduled', duration_ms: 0 },
    },
    ...buildLiveEvents({
      lectureId: lecture.id,
      deviceId: lecture.device_id ?? 'unknown-device',
      segments,
      keyTerms,
      gap: withGap ? OFFLINE_GAP : null,
      durationMs: durationMs + 10_000,
    }),
  ].map((event, index) => ({ ...event, seq: index + 1 }));
  return { lectureId: lecture.id, events, segments, durationMs: durationMs + 10_000 };
}

export function elapsedOf(run: LiveRun, now = Date.now()): number {
  if (run.baseWall === null) return -1;
  return run.baseElapsed + (now - run.baseWall) * run.speed;
}

/** Returns the run for a lecture, creating it for scheduled/recording lectures. */
export function ensureRun(lecture: Lecture): LiveRun | null {
  const existing = runs.get(lecture.id);
  if (existing !== undefined) return existing;
  if (lecture.status !== 'recording' && lecture.status !== 'scheduled') {
    return null;
  }
  const started =
    lecture.status === 'scheduled' || lecture.started_at === null
      ? null
      : Date.parse(lecture.started_at);
  const run: LiveRun = {
    ...scriptFor(lecture, lecture.id === LECTURE_IDS.schedulingLive),
    baseWall: started === null ? null : Date.now(),
    baseElapsed: started === null ? 0 : Date.now() - started,
    speed: 1,
  };
  runs.set(lecture.id, run);
  return run;
}

export function startRecording(lectureId: string): void {
  const db = getDb();
  const lecture = db.lectures.find((l) => l.id === lectureId);
  if (lecture?.status !== 'scheduled') return;
  const now = Date.now();
  lecture.status = 'recording';
  lecture.started_at = new Date(now).toISOString();
  const device = db.devices.find((d) => d.id === lecture.device_id);
  if (device !== undefined) {
    device.recording = true;
    device.current_lecture_id = lecture.id;
  }
  const run = ensureRun(lecture);
  if (run !== null) {
    run.baseWall = now;
    run.baseElapsed = 0;
  }
}

/** Simulates the lecturer pressing the record button on the device shortly after preparing. */
export function scheduleAutoStart(lectureId: string): void {
  const timer = setTimeout(() => {
    autoStartTimers.delete(timer);
    startRecording(lectureId);
  }, AUTO_START_DELAY_MS);
  autoStartTimers.add(timer);
}

/** Events that are due (by simulated time) and newer than `afterSeq`. */
export function dueEvents(run: LiveRun, afterSeq: number, now = Date.now()): LiveEvent[] {
  const elapsed = elapsedOf(run, now);
  return run.events.filter((event) => event.seq > afterSeq && event.at <= elapsed);
}

export function isFinished(run: LiveRun, now = Date.now()): boolean {
  return elapsedOf(run, now) > lastEventAt(run.events);
}

/** Keeps REST state (status, duration, device) consistent with simulated time. */
export function syncLecture(lecture: Lecture, now = Date.now()): Lecture {
  const run = runs.get(lecture.id);
  if (run === undefined || run.baseWall === null) return lecture;
  const elapsed = elapsedOf(run, now);
  if (elapsed < run.durationMs) {
    lecture.status = 'recording';
    lecture.duration_ms = Math.max(0, Math.round(elapsed));
  } else if (elapsed < run.durationMs + 20_000) {
    lecture.status = 'processing';
    lecture.duration_ms = run.durationMs;
  } else if (lecture.status !== 'completed') {
    completeLecture(lecture, run);
  }
  return lecture;
}

function completeLecture(lecture: Lecture, run: LiveRun): void {
  const db = getDb();
  lecture.status = 'completed';
  lecture.duration_ms = run.durationMs;
  lecture.ended_at = new Date().toISOString();
  lecture.notes_ready = true;
  lecture.notes_published = true;
  // Section B reuses the fixture lecture's study material (same script).
  const source = LECTURE_IDS.scheduling;
  db.transcripts.set(lecture.id, { segments: [...run.segments], gaps: [] });
  const notes = db.notes.get(source);
  if (notes !== undefined) db.notes.set(lecture.id, { ...notes, lecture_id: lecture.id });
  const summary = db.summaries.get(source);
  if (summary !== undefined) db.summaries.set(lecture.id, { ...summary, lecture_id: lecture.id });
  db.keyTerms.set(lecture.id, db.keyTerms.get(source) ?? []);
  const questions = db.questions.get(source);
  if (questions !== undefined)
    db.questions.set(lecture.id, { ...questions, lecture_id: lecture.id });
  const device = db.devices.find((d) => d.id === lecture.device_id);
  if (device !== undefined) {
    device.recording = false;
    device.current_lecture_id = null;
  }
}

/** Final segments already transcribed at the current simulated time (REST view of a live lecture). */
export function transcribedSoFar(run: LiveRun, now = Date.now()): TranscriptSegment[] {
  const elapsed = elapsedOf(run, now);
  const backfilled = run.events.some(
    (e) => e.body.type === 'transcript.backfill' && e.at <= elapsed,
  );
  return run.segments.filter(
    (s) => s.end_ms + 700 <= elapsed && (s.source === 'live' || backfilled),
  );
}

/** The device fields reported by the most recent due `device.status` event, if a run uses it. */
export function deviceStatusNow(deviceId: string, now = Date.now()): Record<string, unknown> {
  for (const run of runs.values()) {
    const elapsed = elapsedOf(run, now);
    let latest: Record<string, unknown> | null = null;
    for (const event of run.events) {
      if (event.at > elapsed) break;
      if (event.body.type === 'device.status' && event.body.device_id === deviceId)
        latest = event.body;
    }
    if (latest !== null) {
      const { type: _type, device_id: _id, ...fields } = latest;
      return {
        ...fields,
        last_seen_at: fields.online === true ? new Date(now).toISOString() : null,
      };
    }
  }
  return {};
}

/* ── Test / demo controls ─────────────────────────────────────────────────────────────── */

export function runFor(lectureId: string): LiveRun | undefined {
  return runs.get(lectureId);
}

export function setSpeed(lectureId: string, speed: number): void {
  const run = runs.get(lectureId);
  if (run === undefined || run.baseWall === null) return;
  const now = Date.now();
  run.baseElapsed = elapsedOf(run, now);
  run.baseWall = now;
  run.speed = speed;
}

/** Jumps simulated time forward (never backwards: sequence numbers must stay monotonic). */
export function seek(lectureId: string, elapsedMs: number): void {
  const run = runs.get(lectureId);
  if (run === undefined || run.baseWall === null) return;
  const now = Date.now();
  run.baseElapsed = Math.max(elapsedOf(run, now), elapsedMs);
  run.baseWall = now;
}

export function onDrop(listener: (lectureId: string) => void): () => void {
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

/** Closes every open socket for the lecture with a retryable code, like a server restart. */
export function dropConnections(lectureId: string): void {
  for (const listener of dropListeners) listener(lectureId);
}

export function resetSimulator(): void {
  runs.clear();
  for (const timer of autoStartTimers) clearTimeout(timer);
  autoStartTimers.clear();
}

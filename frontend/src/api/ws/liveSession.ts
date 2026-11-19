import {
  applyBackfill,
  EMPTY_TIMELINE,
  upsertGap,
  upsertSegment,
  type DisplaySegment,
  type Timeline,
} from '@/lib/transcript/timeline';
import type { LanguageCode } from '@/lib/lang';
import type {
  DeviceStatus,
  FinalSegment,
  LectureStatusValue,
  LiveKeyTerm,
  NotesKindValue,
  SequencedServerMessage,
} from './messages';

/** Everything the Live Lecture screen knows about the lecture, derived only from WS messages. */
export interface LiveSession {
  timeline: Timeline;
  lectureStatus: LectureStatusValue | null;
  /** Capture paused on the device (lecture status stays `recording`). */
  paused: boolean;
  /** duration_ms from the last lecture.status, and the client time it was received. */
  durationMs: number;
  durationReceivedAt: number | null;
  device: DeviceStatus | null;
  keyTerms: ReadonlyMap<string, LiveKeyTerm>;
  /** Language of the most recent live segment (header indicator). */
  latestLanguage: LanguageCode | null;
  /** Most recent live final segment, for the opt-in screen-reader announcer. */
  latestFinal: DisplaySegment | null;
  notesReady: readonly NotesKindValue[];
  serverError: { code: string; message: string } | null;
}

export const EMPTY_SESSION: LiveSession = {
  timeline: EMPTY_TIMELINE,
  lectureStatus: null,
  paused: false,
  durationMs: 0,
  durationReceivedAt: null,
  device: null,
  keyTerms: new Map(),
  latestLanguage: null,
  latestFinal: null,
  notesReady: [],
  serverError: null,
};

function toDisplay(segment: FinalSegment, source: 'live' | 'backfill'): DisplaySegment {
  return { ...segment, source, state: 'final' };
}

/** Pure reducer: applies one validated, already de-duplicated (by seq) message. */
export function applyMessage(
  session: LiveSession,
  message: SequencedServerMessage,
  receivedAt: number,
): LiveSession {
  switch (message.type) {
    case 'transcript.partial': {
      const segment: DisplaySegment = {
        segment_id: message.segment_id,
        start_ms: message.start_ms,
        end_ms: message.end_ms,
        text: message.text,
        language: message.language,
        transliteration: message.transliteration,
        confidence: null,
        source: 'live',
        edited: false,
        state: 'partial',
      };
      const timeline = upsertSegment(session.timeline, segment);
      if (timeline === session.timeline) return session;
      return { ...session, timeline, latestLanguage: message.language };
    }
    case 'transcript.final': {
      const { seq: _seq, server_ts: _ts, type: _type, ...fields } = message;
      const segment = toDisplay(fields, 'live');
      const timeline = upsertSegment(session.timeline, segment);
      if (timeline === session.timeline) return session;
      return { ...session, timeline, latestLanguage: message.language, latestFinal: segment };
    }
    case 'transcript.gap': {
      const timeline = upsertGap(session.timeline, {
        gap_id: message.gap_id,
        start_ms: message.gap.start_ms,
        end_ms: message.gap.end_ms,
        state: 'syncing',
      });
      return timeline === session.timeline ? session : { ...session, timeline };
    }
    case 'transcript.backfill': {
      const segments = message.segments.map((s) => toDisplay(s, 'backfill'));
      const timeline = applyBackfill(session.timeline, segments, message.gap, message.gap_id);
      return timeline === session.timeline ? session : { ...session, timeline };
    }
    case 'lecture.status':
      return {
        ...session,
        lectureStatus: message.status,
        paused: message.status === 'recording' ? (message.paused ?? session.paused) : false,
        durationMs: message.duration_ms,
        durationReceivedAt: receivedAt,
      };
    case 'device.status':
      return { ...session, device: message };
    case 'key_terms.update': {
      if (message.terms.length === 0) return session;
      const keyTerms = new Map(session.keyTerms);
      for (const term of message.terms) keyTerms.set(term.id, term);
      return { ...session, keyTerms };
    }
    case 'notes.ready':
      return {
        ...session,
        notesReady: [...new Set([...session.notesReady, ...message.kinds])],
      };
    case 'error':
      return { ...session, serverError: { code: message.code, message: message.message } };
  }
}

/** Elapsed recording time at `now`, advancing locally only while recording (not paused). */
export function elapsedMs(session: LiveSession, now: number): number {
  if (
    session.lectureStatus !== 'recording' ||
    session.paused ||
    session.durationReceivedAt === null
  ) {
    return session.durationMs;
  }
  return session.durationMs + Math.max(0, now - session.durationReceivedAt);
}

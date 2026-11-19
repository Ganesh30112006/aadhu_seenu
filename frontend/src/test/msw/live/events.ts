import type { KeyTerm, TranscriptSegment } from '@/api/types';

/*
 * Pure event log for a simulated live lecture. Times are offsets from the lecture start.
 * The device loses Wi-Fi during `gap`: transcription pauses, `transcript.gap` is announced,
 * the buffer fills, and after reconnecting the buffered audio arrives as `transcript.backfill`.
 */

export interface LiveEvent {
  at: number;
  seq: number;
  /** Message body without seq/server_ts (added at send time). */
  body: Record<string, unknown> & { type: string };
}

export interface LiveScriptOptions {
  lectureId: string;
  deviceId: string;
  segments: readonly TranscriptSegment[];
  keyTerms: readonly KeyTerm[];
  gap: { gap_id: string; start_ms: number; end_ms: number } | null;
  durationMs: number;
}

const FINAL_DELAY_MS = 700;
const DEVICE_HEARTBEAT_MS = 20_000;
const STATUS_INTERVAL_MS = 60_000;
const BACKFILL_DELAY_MS = 9_000;

function partialText(text: string): string {
  const words = text.split(/\s+/);
  return words.slice(0, Math.max(1, Math.ceil(words.length * 0.6))).join(' ');
}

export function buildLiveEvents(options: LiveScriptOptions): LiveEvent[] {
  const { segments, gap, durationMs, deviceId } = options;
  const raw: Omit<LiveEvent, 'seq'>[] = [];
  const inGap = (ms: number): boolean => gap !== null && ms >= gap.start_ms && ms < gap.end_ms;

  const device = (at: number, overrides: Record<string, unknown> = {}): void => {
    raw.push({
      at,
      body: {
        type: 'device.status',
        device_id: deviceId,
        online: true,
        wifi_rssi: -62 - Math.round((at / 7_000) % 9),
        psram_buffer_pct: 0,
        flash_buffer_pct: 0,
        recording: true,
        last_seen_at: null,
        ...overrides,
      },
    });
  };

  // Lecture status: at start and every minute (duration updates).
  for (let at = 0; at < durationMs; at += STATUS_INTERVAL_MS) {
    raw.push({ at, body: { type: 'lecture.status', status: 'recording', duration_ms: at } });
  }
  // Device heartbeat while online.
  for (let at = 0; at < durationMs; at += DEVICE_HEARTBEAT_MS) {
    if (!inGap(at) && !(gap !== null && at >= gap.end_ms && at < gap.end_ms + BACKFILL_DELAY_MS)) {
      device(at);
    }
  }

  // Transcript: partial mid-way through each segment, final shortly after it ends.
  const termsBySegment = new Map<number, KeyTerm[]>();
  for (const term of options.keyTerms) {
    if (term.first_mentioned_ms === null) continue;
    const list = termsBySegment.get(term.first_mentioned_ms) ?? [];
    list.push(term);
    termsBySegment.set(term.first_mentioned_ms, list);
  }
  for (const segment of segments) {
    if (inGap(segment.start_ms)) continue;
    const { source: _source, confidence, ...fields } = segment;
    const midpoint = segment.start_ms + Math.round((segment.end_ms - segment.start_ms) * 0.45);
    raw.push({
      at: midpoint,
      body: { type: 'transcript.partial', ...fields, text: partialText(segment.text) },
    });
    const finalAt = segment.end_ms + FINAL_DELAY_MS;
    raw.push({ at: finalAt, body: { type: 'transcript.final', ...fields, confidence } });
    const terms = termsBySegment.get(segment.start_ms);
    if (terms !== undefined)
      raw.push({ at: finalAt + 1, body: { type: 'key_terms.update', terms } });
  }

  if (gap !== null) {
    const buffered = segments.filter((s) => inGap(s.start_ms));
    const seconds = (gap.end_ms - gap.start_ms) / 1000;
    raw.push({
      at: gap.start_ms,
      body: {
        type: 'transcript.gap',
        gap_id: gap.gap_id,
        gap: { start_ms: gap.start_ms, end_ms: null },
      },
    });
    // While offline the server only knows the last time it heard from the device.
    for (let t = 0; t <= seconds; t += 20) {
      device(gap.start_ms + t * 1000 + 1, {
        online: false,
        wifi_rssi: null,
        recording: true,
        psram_buffer_pct: Math.min(100, Math.round((t / 128) * 100)),
        flash_buffer_pct: Math.max(0, Math.round(((t - 102) / 632) * 100)),
      });
    }
    raw.push({
      at: gap.end_ms,
      body: {
        type: 'transcript.gap',
        gap_id: gap.gap_id,
        gap: { start_ms: gap.start_ms, end_ms: gap.end_ms },
      },
    });
    device(gap.end_ms + 1, { psram_buffer_pct: Math.min(100, Math.round((seconds / 128) * 100)) });
    device(gap.end_ms + BACKFILL_DELAY_MS / 2, { psram_buffer_pct: 40 });
    raw.push({
      at: gap.end_ms + BACKFILL_DELAY_MS,
      body: {
        type: 'transcript.backfill',
        gap_id: gap.gap_id,
        gap: { start_ms: gap.start_ms, end_ms: gap.end_ms },
        segments: buffered.map(({ source: _source, ...rest }) => rest),
      },
    });
    const lateTerms = buffered.flatMap((s) => termsBySegment.get(s.start_ms) ?? []);
    if (lateTerms.length > 0) {
      raw.push({
        at: gap.end_ms + BACKFILL_DELAY_MS + 1,
        body: { type: 'key_terms.update', terms: lateTerms },
      });
    }
    device(gap.end_ms + BACKFILL_DELAY_MS + 1, { psram_buffer_pct: 0 });
  }

  // End of lecture: processing → completed → notes ready.
  raw.push({
    at: durationMs,
    body: { type: 'lecture.status', status: 'processing', duration_ms: durationMs },
  });
  device(durationMs + 1, { recording: false });
  raw.push({
    at: durationMs + 20_000,
    body: { type: 'lecture.status', status: 'completed', duration_ms: durationMs },
  });
  raw.push({
    at: durationMs + 25_000,
    body: { type: 'notes.ready', kinds: ['summary', 'notes', 'key_terms', 'questions'] },
  });

  return raw
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.at - b.event.at || a.index - b.index)
    .map(({ event }, index) => ({ ...event, seq: index + 1 }));
}

/** The time after which nothing more is sent and the server closes the socket. */
export function lastEventAt(events: readonly LiveEvent[]): number {
  return events.at(-1)?.at ?? 0;
}

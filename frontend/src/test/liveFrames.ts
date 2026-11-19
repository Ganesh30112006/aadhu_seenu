/** Builders for live WebSocket frames used by unit tests and the MSW live simulator. */
type Lang = 'en' | 'te' | 'hi';

export const frames = {
  partial: (seq: number, id: string, startMs: number, text: string, language: Lang = 'en') => ({
    type: 'transcript.partial',
    seq,
    server_ts: Date.now(),
    segment_id: id,
    start_ms: startMs,
    end_ms: startMs + 4000,
    text,
    language,
  }),
  final: (seq: number, id: string, startMs: number, text: string, language: Lang = 'en') => ({
    type: 'transcript.final',
    seq,
    server_ts: Date.now(),
    segment_id: id,
    start_ms: startMs,
    end_ms: startMs + 4000,
    text,
    language,
    confidence: 0.93,
    transliteration: null,
  }),
  gap: (seq: number, gapId: string, startMs: number, endMs: number | null) => ({
    type: 'transcript.gap',
    seq,
    server_ts: Date.now(),
    gap_id: gapId,
    gap: { start_ms: startMs, end_ms: endMs },
  }),
  backfill: (
    seq: number,
    gapId: string | null,
    range: { start_ms: number; end_ms: number },
    segments: { id: string; startMs: number; text: string }[],
  ) => ({
    type: 'transcript.backfill',
    seq,
    server_ts: Date.now(),
    gap_id: gapId,
    gap: range,
    segments: segments.map((s) => ({
      segment_id: s.id,
      start_ms: s.startMs,
      end_ms: s.startMs + 4000,
      text: s.text,
      language: 'en',
      confidence: 0.9,
      transliteration: null,
    })),
  }),
  status: (
    seq: number,
    status: 'scheduled' | 'recording' | 'paused' | 'processing' | 'completed' | 'failed',
    durationMs: number,
  ) => ({ type: 'lecture.status', seq, server_ts: Date.now(), status, duration_ms: durationMs }),
  device: (
    seq: number,
    overrides: Partial<{
      online: boolean;
      psram_buffer_pct: number;
      flash_buffer_pct: number;
    }> = {},
  ) => ({
    type: 'device.status',
    seq,
    server_ts: Date.now(),
    device_id: 'device-1',
    online: true,
    wifi_rssi: -58,
    psram_buffer_pct: 4,
    flash_buffer_pct: 0,
    recording: true,
    last_seen_at: new Date().toISOString(),
    ...overrides,
  }),
  keyTerms: (seq: number, terms: { id: string; term: string; definition: string }[]) => ({
    type: 'key_terms.update',
    seq,
    server_ts: Date.now(),
    terms: terms.map((t) => ({ ...t, language: 'en', first_mentioned_ms: 1000 })),
  }),
  notesReady: (seq: number) => ({
    type: 'notes.ready',
    seq,
    server_ts: Date.now(),
    kinds: ['summary', 'notes', 'key_terms', 'questions'],
  }),
  error: (seq: number, code: string, message = 'error') => ({
    type: 'error',
    seq,
    server_ts: Date.now(),
    code,
    message,
  }),
};

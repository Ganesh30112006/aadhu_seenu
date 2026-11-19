import { z } from 'zod';

/*
 * Live lecture WebSocket protocol: wss://<host>/ws/lectures/{lecture_id}/live
 * Every server frame is validated here; invalid frames are logged and dropped.
 * Extensions agreed after the design review (see CONTRACT_ASSUMPTIONS.md):
 *   - `server_ts` (epoch ms at send time) on every frame, optional for compatibility
 *   - `transcript.gap` announces a gap while audio is still buffered on the device
 *   - `key_terms.update` streams key terms during the lecture
 *   - `ping` / `pong` heartbeat for liveness and clock-offset estimation
 * Master-plan additions (all optional, so older servers stay valid):
 *   - `edited` on finals (a lecturer correction re-sends the final with the same segment_id)
 *   - `paused` on lecture.status; monitoring fields on device.status
 */

const Language = z.enum(['en', 'te', 'hi']);
const Ms = z.number().int().nonnegative();
const Seq = z.number().int().nonnegative();
const ServerTs = z.number().optional();

const SegmentFields = {
  segment_id: z.string().min(1),
  start_ms: Ms,
  end_ms: Ms,
  text: z.string(),
  language: Language,
  transliteration: z.string().nullable().default(null),
};

export const FinalSegmentSchema = z.object({
  ...SegmentFields,
  confidence: z.number().min(0).max(1).nullable().default(null),
  edited: z.boolean().default(false),
});

const Base = { seq: Seq, server_ts: ServerTs };

export const TranscriptPartialMessage = z.object({
  ...Base,
  type: z.literal('transcript.partial'),
  ...SegmentFields,
});

export const TranscriptFinalMessage = z.object({
  ...Base,
  type: z.literal('transcript.final'),
  ...FinalSegmentSchema.shape,
});

export const TranscriptBackfillMessage = z.object({
  ...Base,
  type: z.literal('transcript.backfill'),
  gap_id: z.string().nullable().default(null),
  segments: z.array(FinalSegmentSchema),
  gap: z.object({ start_ms: Ms, end_ms: Ms }),
});

export const TranscriptGapMessage = z.object({
  ...Base,
  type: z.literal('transcript.gap'),
  gap_id: z.string().min(1),
  /** end_ms is null while the device is still offline. */
  gap: z.object({ start_ms: Ms, end_ms: Ms.nullable() }),
});

export const LectureStatusSchema = z.enum([
  'scheduled',
  'recording',
  'processing',
  'completed',
  'failed',
]);

export const LectureStatusMessage = z.object({
  ...Base,
  type: z.literal('lecture.status'),
  status: LectureStatusSchema,
  duration_ms: Ms,
  /** Absent on periodic duration updates: the previous pause state still holds. */
  paused: z.boolean().optional(),
});

export const DeviceStatusMessage = z.object({
  ...Base,
  type: z.literal('device.status'),
  device_id: z.string().min(1),
  online: z.boolean(),
  wifi_rssi: z.number().int().nullable(),
  psram_buffer_pct: z.number().min(0).max(100),
  flash_buffer_pct: z.number().min(0).max(100),
  recording: z.boolean(),
  last_seen_at: z.string().nullable(),
  paused: z.boolean().default(false),
  /** Microphone level over the last second (dBFS, -120..0); null when unknown. */
  level_dbfs: z.number().min(-120).max(0).nullable().default(null),
  /** false after 60 s of silence while recording; null when unknown. */
  mic_ok: z.boolean().nullable().default(null),
  /** Chunks still on the device, not yet acknowledged (sync progress). */
  pending_chunks: z.number().int().nonnegative().default(0),
  /** When the server last stored audio from the device. */
  last_audio_at: z.string().nullable().default(null),
});

export const NotesKind = z.enum([
  'summary',
  'notes',
  'key_terms',
  'questions',
  'flashcards',
  'revision',
]);

export const NotesReadyMessage = z.object({
  ...Base,
  type: z.literal('notes.ready'),
  kinds: z.array(NotesKind),
});

export const KeyTermSchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  definition: z.string(),
  language: Language,
  first_mentioned_ms: Ms.nullable(),
});

export const KeyTermsUpdateMessage = z.object({
  ...Base,
  type: z.literal('key_terms.update'),
  terms: z.array(KeyTermSchema),
});

export const ErrorMessage = z.object({
  ...Base,
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

/** Sequenced messages: subject to `last_seq` resume and de-duplication. */
export const SequencedMessage = z.discriminatedUnion('type', [
  TranscriptPartialMessage,
  TranscriptFinalMessage,
  TranscriptBackfillMessage,
  TranscriptGapMessage,
  LectureStatusMessage,
  DeviceStatusMessage,
  NotesReadyMessage,
  KeyTermsUpdateMessage,
  ErrorMessage,
]);

/** Control frame, not sequenced. */
export const PongMessage = z.object({
  type: z.literal('pong'),
  client_ts: z.number(),
  server_ts: z.number(),
});

export const ServerMessage = z.union([SequencedMessage, PongMessage]);

export type FinalSegment = z.infer<typeof FinalSegmentSchema>;
export type SequencedServerMessage = z.infer<typeof SequencedMessage>;
export type ServerMessageType = z.infer<typeof ServerMessage>;
export type DeviceStatus = z.infer<typeof DeviceStatusMessage>;
export type LiveKeyTerm = z.infer<typeof KeyTermSchema>;
export type NotesKindValue = z.infer<typeof NotesKind>;
export type LectureStatusValue = z.infer<typeof LectureStatusSchema>;

/* Client → server */
export interface SubscribeFrame {
  type: 'subscribe';
  lecture_id: string;
  last_seq: number;
}
export interface PingFrame {
  type: 'ping';
  client_ts: number;
}
/** Latency stage 6: the client rendered the event (contracts/PROTOCOL.md §3). */
export interface RenderAckFrame {
  type: 'render.ack';
  seq: number;
  rendered_unix_ms: number;
}
export type ClientFrame = SubscribeFrame | PingFrame | RenderAckFrame;

/** Close codes (see CONTRACT_ASSUMPTIONS.md). Anything else is treated as retryable. */
export const CloseCode = {
  normal: 1000,
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
} as const;

/** Parses one raw frame. Returns null (never throws) for malformed JSON or invalid shapes. */
export function parseServerFrame(
  raw: unknown,
): { ok: true; message: ServerMessageType } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'non-text frame' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed JSON' };
  }
  const result = ServerMessage.safeParse(json);
  if (!result.success) return { ok: false, reason: z.prettifyError(result.error) };
  return { ok: true, message: result.data };
}

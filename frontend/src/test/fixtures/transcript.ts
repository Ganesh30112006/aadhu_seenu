import type { TranscriptSegment } from '@/api/types';
import { buildLectureScript, type ScriptLine } from './lectureScript';

/** Deterministic PRNG (mulberry32) so fixtures are identical on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const LECTURE_LENGTH_MS = 3_000_000; // 50 minutes
const WORDS_PER_SECOND = 2.4;

/** The device lost Wi-Fi from 10:32 to 13:32; that audio was uploaded and transcribed late. */
export const OFFLINE_GAP = { gap_id: 'gap-0001', start_ms: 632_000, end_ms: 812_000 } as const;

const wordCount = (text: string): number => text.split(/\s+/).length;

/**
 * Splits English lines into sentences, and long sentences at clause commas, the way a
 * speech-to-text engine segments continuous speech.
 */
function segmentLine(line: ScriptLine): ScriptLine[] {
  if (line.language !== 'en') return [line];
  return line.text
    .split(/(?<=[.?!]) (?=[A-Z])/)
    .flatMap((sentence) => splitClauses(sentence))
    .map((text) => ({ ...line, text }));
}

function splitClauses(sentence: string): string[] {
  if (wordCount(sentence) < 14) return [sentence];
  const parts = sentence.split(/(?<=,) /);
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current === '' ? part : `${current} ${part}`;
    if (current !== '' && wordCount(current) >= 4 && wordCount(part) >= 3) {
      chunks.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

export interface FixtureTranscript {
  segments: TranscriptSegment[];
  /** start_ms of the first segment of each script section, keyed by section id. */
  sectionStarts: Record<string, number>;
  durationMs: number;
}

export function buildTranscript(seed = 501): FixtureTranscript {
  const random = seededRandom(seed);
  const sections = buildLectureScript();
  const raw: { line: ScriptLine; durationMs: number; pauseMs: number; section: string }[] = [];
  for (const section of sections) {
    for (const line of section.lines.flatMap(segmentLine)) {
      const words = line.text.split(/\s+/).length;
      raw.push({
        line,
        durationMs: Math.max(1800, (words / WORDS_PER_SECOND) * 1000),
        pauseMs: 250 + random() * 900,
        section: section.id,
      });
    }
  }
  const naturalLength = raw.reduce((sum, r) => sum + r.durationMs + r.pauseMs, 0);
  const scale = (LECTURE_LENGTH_MS - 20_000) / naturalLength;

  const segments: TranscriptSegment[] = [];
  const sectionStarts: Record<string, number> = {};
  let cursor = 4_000;
  raw.forEach((r, index) => {
    const start = Math.round(cursor);
    const end = Math.round(cursor + r.durationMs * scale);
    cursor += (r.durationMs + r.pauseMs) * scale;
    sectionStarts[r.section] ??= start;
    const indic = r.line.language !== 'en';
    segments.push({
      segment_id: `seg-${String(index + 1).padStart(4, '0')}`,
      start_ms: start,
      end_ms: end,
      text: r.line.text,
      language: r.line.language,
      transliteration: r.line.transliteration,
      confidence: Math.round((indic ? 0.72 + random() * 0.18 : 0.86 + random() * 0.12) * 100) / 100,
      source: start >= OFFLINE_GAP.start_ms && start < OFFLINE_GAP.end_ms ? 'backfill' : 'live',
      edited: false,
    });
  });
  return { segments, sectionStarts, durationMs: LECTURE_LENGTH_MS };
}

/** First segment whose text mentions `term` (case-insensitive), for key-term timestamps. */
export function firstMention(segments: readonly TranscriptSegment[], term: string): number | null {
  const needle = term.toLowerCase();
  return segments.find((s) => s.text.toLowerCase().includes(needle))?.start_ms ?? null;
}

import type { TranscriptGap, TranscriptSegment } from '@/api/types';
import { insertSorted } from '../sortedInsert';

/*
 * Transcript timeline shared by the Live Lecture and Lecture Detail screens.
 * Invariants:
 *  - one entry per segment_id (de-duplicated), a `final` is never downgraded by a `partial`;
 *  - items are ordered by start_ms, never by arrival, so late backfill lands in place;
 *  - every function is pure and returns the same object when nothing changed.
 */

export type SegmentState = 'partial' | 'final';

export interface DisplaySegment extends TranscriptSegment {
  state: SegmentState;
}

/** "syncing": audio is still on the device. "missing": the lecture ended without it. */
export type GapState = 'syncing' | 'missing';

export interface DisplayGap {
  gap_id: string;
  start_ms: number;
  end_ms: number | null;
  state: GapState;
}

export type TimelineItem =
  | { kind: 'gap'; key: string; start_ms: number; gap: DisplayGap }
  | { kind: 'segment'; key: string; start_ms: number; segment: DisplaySegment };

export interface Timeline {
  segments: ReadonlyMap<string, DisplaySegment>;
  gaps: ReadonlyMap<string, DisplayGap>;
  items: readonly TimelineItem[];
}

export const EMPTY_TIMELINE: Timeline = { segments: new Map(), gaps: new Map(), items: [] };

const segmentKey = (id: string): string => `seg:${id}`;
const gapKey = (id: string): string => `gap:${id}`;

/** start_ms, then gaps before segments that start at the same moment, then key. */
export function compareItems(a: TimelineItem, b: TimelineItem): number {
  if (a.start_ms !== b.start_ms) return a.start_ms - b.start_ms;
  if (a.kind !== b.kind) return a.kind === 'gap' ? -1 : 1;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

function segmentItem(segment: DisplaySegment): TimelineItem {
  return {
    kind: 'segment',
    key: segmentKey(segment.segment_id),
    start_ms: segment.start_ms,
    segment,
  };
}

function gapItem(gap: DisplayGap): TimelineItem {
  return { kind: 'gap', key: gapKey(gap.gap_id), start_ms: gap.start_ms, gap };
}

function replaceOrMove(
  items: readonly TimelineItem[],
  key: string,
  next: TimelineItem,
  moved: boolean,
): TimelineItem[] {
  if (!moved) {
    const index = items.findIndex((item) => item.key === key);
    if (index !== -1) return items.map((item, i) => (i === index ? next : item));
  }
  return insertSorted(
    items.filter((item) => item.key !== key),
    next,
    compareItems,
  );
}

function sameSegment(a: DisplaySegment, b: DisplaySegment): boolean {
  return (
    a.state === b.state &&
    a.text === b.text &&
    a.start_ms === b.start_ms &&
    a.end_ms === b.end_ms &&
    a.language === b.language &&
    a.transliteration === b.transliteration &&
    a.confidence === b.confidence
  );
}

/** Adds or updates a segment. A late `partial` never replaces a `final`. */
export function upsertSegment(timeline: Timeline, segment: DisplaySegment): Timeline {
  const existing = timeline.segments.get(segment.segment_id);
  if (existing !== undefined) {
    if (existing.state === 'final' && segment.state === 'partial') return timeline;
    if (sameSegment(existing, segment)) return timeline;
  }
  const segments = new Map(timeline.segments).set(segment.segment_id, segment);
  const item = segmentItem(segment);
  const items =
    existing === undefined
      ? insertSorted(timeline.items, item, compareItems)
      : replaceOrMove(timeline.items, item.key, item, existing.start_ms !== segment.start_ms);
  return { ...timeline, segments, items };
}

/** Adds or updates a gap by gap_id. */
export function upsertGap(timeline: Timeline, gap: DisplayGap): Timeline {
  const existing = timeline.gaps.get(gap.gap_id);
  if (
    existing?.start_ms === gap.start_ms &&
    existing.end_ms === gap.end_ms &&
    existing.state === gap.state
  ) {
    return timeline;
  }
  const gaps = new Map(timeline.gaps).set(gap.gap_id, gap);
  const item = gapItem(gap);
  const items =
    existing === undefined
      ? insertSorted(timeline.items, item, compareItems)
      : replaceOrMove(timeline.items, item.key, item, existing.start_ms !== gap.start_ms);
  return { ...timeline, gaps, items };
}

function overlaps(gap: DisplayGap, range: { start_ms: number; end_ms: number }): boolean {
  const gapEnd = gap.end_ms ?? Number.POSITIVE_INFINITY;
  return gap.start_ms <= range.end_ms && range.start_ms <= gapEnd;
}

/**
 * Applies late-synced audio: inserts the segments (as finals, de-duplicated) and removes the gap
 * they fill, matched by gap_id or, when the server sends none, by overlapping time range.
 */
export function applyBackfill(
  timeline: Timeline,
  segments: readonly DisplaySegment[],
  range: { start_ms: number; end_ms: number },
  gapId: string | null,
): Timeline {
  let next = timeline;
  for (const segment of segments) next = upsertSegment(next, segment);
  const filled = [...next.gaps.values()].filter(
    (gap) => gap.gap_id === gapId || overlaps(gap, range),
  );
  if (filled.length === 0) return next;
  const filledIds = new Set(filled.map((gap) => gap.gap_id));
  const gaps = new Map([...next.gaps].filter(([id]) => !filledIds.has(id)));
  const items = next.items.filter((item) => item.kind !== 'gap' || !filledIds.has(item.gap.gap_id));
  return { ...next, gaps, items };
}

/** Builds a timeline from REST data (completed lectures): all segments final, gaps missing. */
export function buildTimeline(
  segments: readonly TranscriptSegment[],
  gaps: readonly TranscriptGap[],
): Timeline {
  const segmentMap = new Map<string, DisplaySegment>();
  for (const segment of segments) {
    segmentMap.set(segment.segment_id, { ...segment, state: 'final' });
  }
  const gapMap = new Map<string, DisplayGap>();
  for (const gap of gaps) gapMap.set(gap.gap_id, { ...gap, state: 'missing' });
  const items: TimelineItem[] = [
    ...[...segmentMap.values()].map(segmentItem),
    ...[...gapMap.values()].map(gapItem),
  ].sort(compareItems);
  return { segments: segmentMap, gaps: gapMap, items };
}

import { describe, expect, it } from 'vitest';
import {
  applyBackfill,
  buildTimeline,
  EMPTY_TIMELINE,
  upsertGap,
  upsertSegment,
  type DisplaySegment,
  type Timeline,
} from './timeline';

const seg = (
  id: string,
  startMs: number,
  state: 'partial' | 'final' = 'final',
  text = `text ${id}`,
): DisplaySegment => ({
  segment_id: id,
  start_ms: startMs,
  end_ms: startMs + 3000,
  text,
  language: 'en',
  transliteration: null,
  confidence: state === 'final' ? 0.9 : null,
  source: 'live',
  edited: false,
  state,
});

const keys = (timeline: Timeline): string[] => timeline.items.map((item) => item.key);

describe('timeline ordering', () => {
  it('orders by start_ms regardless of arrival order', () => {
    let t = EMPTY_TIMELINE;
    t = upsertSegment(t, seg('c', 9000));
    t = upsertSegment(t, seg('a', 1000));
    t = upsertSegment(t, seg('b', 5000));
    expect(keys(t)).toEqual(['seg:a', 'seg:b', 'seg:c']);
  });

  it('breaks start_ms ties deterministically: gaps first, then by key', () => {
    let t = EMPTY_TIMELINE;
    t = upsertSegment(t, seg('z', 1000));
    t = upsertSegment(t, seg('y', 1000));
    t = upsertGap(t, { gap_id: 'g', start_ms: 1000, end_ms: null, state: 'syncing' });
    expect(keys(t)).toEqual(['gap:g', 'seg:y', 'seg:z']);
  });
});

describe('de-duplication and partial → final', () => {
  it('keeps a single entry per segment_id', () => {
    let t = EMPTY_TIMELINE;
    t = upsertSegment(t, seg('a', 1000, 'partial', 'Process sched'));
    t = upsertSegment(t, seg('a', 1000, 'partial', 'Process scheduling dec'));
    t = upsertSegment(t, seg('a', 1000, 'final', 'Process scheduling decides'));
    expect(t.items).toHaveLength(1);
    expect(t.segments.get('a')).toMatchObject({
      state: 'final',
      text: 'Process scheduling decides',
    });
  });

  it('ignores a late partial after the final', () => {
    let t = upsertSegment(EMPTY_TIMELINE, seg('a', 1000, 'final', 'final text'));
    const before = t;
    t = upsertSegment(t, seg('a', 1000, 'partial', 'stale partial'));
    expect(t).toBe(before);
    expect(t.segments.get('a')?.text).toBe('final text');
  });

  it('returns the same object for an identical duplicate', () => {
    const t = upsertSegment(EMPTY_TIMELINE, seg('a', 1000));
    expect(upsertSegment(t, seg('a', 1000))).toBe(t);
  });

  it('moves a segment when its final start_ms differs from the partial', () => {
    let t = EMPTY_TIMELINE;
    t = upsertSegment(t, seg('a', 1000));
    t = upsertSegment(t, seg('b', 5000, 'partial'));
    t = upsertSegment(t, { ...seg('b', 500), state: 'final' });
    expect(keys(t)).toEqual(['seg:b', 'seg:a']);
    expect(t.items).toHaveLength(2);
  });
});

describe('backfill', () => {
  const base = (): Timeline => {
    let t = EMPTY_TIMELINE;
    t = upsertSegment(t, seg('s1', 0));
    t = upsertSegment(t, seg('s2', 4000));
    t = upsertGap(t, { gap_id: 'g1', start_ms: 8000, end_ms: null, state: 'syncing' });
    t = upsertSegment(t, seg('s5', 20_000));
    return t;
  };

  it('inserts late segments in place and removes the filled gap by gap_id', () => {
    const t = applyBackfill(
      base(),
      [seg('s3', 8000), seg('s4', 12_000)],
      { start_ms: 8000, end_ms: 16_000 },
      'g1',
    );
    expect(keys(t)).toEqual(['seg:s1', 'seg:s2', 'seg:s3', 'seg:s4', 'seg:s5']);
    expect(t.gaps.size).toBe(0);
  });

  it('matches the gap by overlapping range when gap_id is missing', () => {
    const t = applyBackfill(base(), [seg('s3', 8000)], { start_ms: 8000, end_ms: 16_000 }, null);
    expect(t.gaps.size).toBe(0);
    expect(keys(t)).toEqual(['seg:s1', 'seg:s2', 'seg:s3', 'seg:s5']);
  });

  it('does not duplicate segments already received live', () => {
    const t = applyBackfill(
      base(),
      [seg('s2', 4000), seg('s3', 8000)],
      { start_ms: 4000, end_ms: 12_000 },
      'g1',
    );
    expect(keys(t).filter((k) => k === 'seg:s2')).toHaveLength(1);
  });

  it('keeps unrelated gaps', () => {
    let t = base();
    t = upsertGap(t, { gap_id: 'g2', start_ms: 30_000, end_ms: 35_000, state: 'syncing' });
    t = applyBackfill(t, [seg('s3', 8000)], { start_ms: 8000, end_ms: 16_000 }, 'g1');
    expect([...t.gaps.keys()]).toEqual(['g2']);
  });

  it('updates a gap end in place when the device reconnects', () => {
    let t = base();
    t = upsertGap(t, { gap_id: 'g1', start_ms: 8000, end_ms: 16_000, state: 'syncing' });
    expect(t.gaps.get('g1')?.end_ms).toBe(16_000);
    expect(t.items.filter((i) => i.kind === 'gap')).toHaveLength(1);
  });
});

describe('buildTimeline', () => {
  it('builds a sorted, de-duplicated timeline from REST pages with missing gaps', () => {
    const t = buildTimeline(
      [seg('b', 5000), seg('a', 1000), seg('a', 1000)],
      [{ gap_id: 'g', start_ms: 3000, end_ms: 4000 }],
    );
    expect(keys(t)).toEqual(['seg:a', 'gap:g', 'seg:b']);
    expect(t.gaps.get('g')?.state).toBe('missing');
    expect(t.segments.get('a')?.state).toBe('final');
  });
});

import { describe, expect, it } from 'vitest';
import { codePointRangesToUtf16, findMatches, normalizeRanges, splitByRanges } from './highlight';
import { safeRedirectPath } from './safeRedirect';
import { insertSorted, lastIndexAtOrBefore, lowerBound } from './sortedInsert';
import { durationParts, formatOffset, toIsoDuration } from './time';

describe('formatOffset', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [754_000, '12:34'],
    [3_725_000, '1:02:05'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatOffset(ms)).toBe(expected);
  });

  it('builds ISO durations and rounded parts', () => {
    expect(toIsoDuration(754_000)).toBe('PT12M34S');
    expect(toIsoDuration(3_725_000)).toBe('PT1H2M5S');
    expect(durationParts(3_000_000)).toEqual({ hours: 0, minutes: 50 });
    expect(durationParts(3_930_000)).toEqual({ hours: 1, minutes: 6 });
  });
});

describe('highlight', () => {
  it('finds case-insensitive matches in Latin text', () => {
    expect(findMatches('Round Robin uses a round quantum', 'round')).toEqual([
      { start: 0, end: 5 },
      { start: 19, end: 24 },
    ]);
  });

  it('finds matches in Telugu and Hindi text', () => {
    const telugu = 'ఇప్పుడు షెడ్యూలింగ్ గురించి చూద్దాం';
    const ranges = findMatches(telugu, 'షెడ్యూలింగ్');
    expect(ranges).toHaveLength(1);
    const [range] = ranges;
    expect(range && telugu.slice(range.start, range.end)).toBe('షెడ్యూలింగ్');
    expect(findMatches('यह प्रोसेस शेड्यूलिंग है', 'शेड्यूलिंग')).toHaveLength(1);
  });

  it('treats regex characters in the query literally and ignores blank queries', () => {
    expect(findMatches('cost (n+1) and n+1', 'n+1')).toHaveLength(2);
    expect(findMatches('anything', '   ')).toEqual([]);
  });

  it('matches across varying whitespace', () => {
    expect(findMatches('context   switch', 'context switch')).toEqual([{ start: 0, end: 16 }]);
  });

  it('converts code-point offsets to UTF-16 offsets', () => {
    const text = '😀 deadlock';
    // In code points, "deadlock" starts at 2; in UTF-16 it starts at 3.
    expect(codePointRangesToUtf16(text, [{ start: 2, end: 10 }])).toEqual([{ start: 3, end: 11 }]);
    expect(codePointRangesToUtf16('abc', [{ start: 1, end: 99 }])).toEqual([{ start: 1, end: 3 }]);
  });

  it('merges overlapping ranges and splits text', () => {
    expect(
      normalizeRanges([
        { start: 4, end: 6 },
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
    expect(splitByRanges('abcdef', [{ start: 1, end: 3 }])).toEqual([
      { text: 'a', highlighted: false },
      { text: 'bc', highlighted: true },
      { text: 'def', highlighted: false },
    ]);
    expect(splitByRanges('abc', [])).toEqual([{ text: 'abc', highlighted: false }]);
  });
});

describe('sorted helpers', () => {
  const cmp = (a: number, b: number): number => a - b;
  it('inserts in order', () => {
    expect(insertSorted([1, 3, 5], 4, cmp)).toEqual([1, 3, 4, 5]);
    expect(insertSorted([], 1, cmp)).toEqual([1]);
    expect(lowerBound([1, 3, 3, 5], 3, cmp)).toBe(1);
  });
  it('finds the row containing a timestamp', () => {
    const rows = [0, 4000, 8000, 12_000];
    expect(lastIndexAtOrBefore(rows, 9000, (r) => r)).toBe(2);
    expect(lastIndexAtOrBefore(rows, 0, (r) => r)).toBe(0);
    expect(lastIndexAtOrBefore(rows, -1, (r) => r)).toBe(-1);
    expect(lastIndexAtOrBefore(rows, 99_999, (r) => r)).toBe(3);
  });
});

describe('safeRedirectPath', () => {
  it.each([
    ['/lectures?subject=1', '/lectures?subject=1'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login?next=/x', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirectPath(input, '/')).toBe(expected);
  });
});

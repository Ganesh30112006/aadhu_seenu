/** Half-open range [start, end) in UTF-16 code units (JavaScript string indices). */
export interface TextRange {
  start: number;
  end: number;
}

export interface TextPart {
  text: string;
  highlighted: boolean;
}

/**
 * The search API returns Unicode code-point offsets (Python string indices). JavaScript strings
 * index UTF-16 code units, which differ for characters outside the BMP (emoji, some symbols).
 * Converts code-point ranges to UTF-16 ranges; out-of-range values are clamped.
 */
export function codePointRangesToUtf16(text: string, ranges: readonly TextRange[]): TextRange[] {
  if (ranges.length === 0) return [];
  const offsets: number[] = [0];
  let unit = 0;
  for (const char of text) {
    unit += char.length;
    offsets.push(unit);
  }
  const lastIndex = offsets.length - 1;
  const at = (codePoint: number): number =>
    offsets[Math.min(Math.max(codePoint, 0), lastIndex)] ?? unit;
  return ranges.map((r) => ({ start: at(r.start), end: at(r.end) }));
}

/** Sorts ranges, drops empty ones and merges overlaps so they can be rendered sequentially. */
export function normalizeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** Splits text into plain and highlighted parts. Ranges are UTF-16 indices. */
export function splitByRanges(text: string, ranges: readonly TextRange[]): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const { start, end } of normalizeRanges(ranges)) {
    const s = Math.min(start, text.length);
    const e = Math.min(end, text.length);
    if (s > cursor) parts.push({ text: text.slice(cursor, s), highlighted: false });
    if (e > s) parts.push({ text: text.slice(s, e), highlighted: true });
    cursor = Math.max(cursor, e);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds every case-insensitive occurrence of `query` in `text` (UTF-16 ranges).
 * Works for Telugu and Devanagari as well as Latin script. Whitespace in the query matches
 * any run of whitespace in the text.
 */
export function findMatches(text: string, query: string): TextRange[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const pattern = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
  const regex = new RegExp(pattern, 'giu');
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

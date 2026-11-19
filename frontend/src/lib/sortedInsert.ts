/**
 * Index of the first element for which `compare(element, target) >= 0` (lower bound).
 * `items` must already be sorted by `compare`.
 */
export function lowerBound<T>(
  items: readonly T[],
  target: T,
  compare: (a: T, b: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const item = items[mid];
    if (item !== undefined && compare(item, target) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Returns a new array with `item` inserted in sorted position (O(log n) search). */
export function insertSorted<T>(
  items: readonly T[],
  item: T,
  compare: (a: T, b: T) => number,
): T[] {
  const index = lowerBound(items, item, compare);
  return [...items.slice(0, index), item, ...items.slice(index)];
}

/**
 * Index of the last item whose key is <= `key`, or -1 if none.
 * Used to map a timestamp (?t=) to the transcript row that contains it.
 */
export function lastIndexAtOrBefore<T>(
  items: readonly T[],
  key: number,
  getKey: (item: T) => number,
): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const item = items[mid];
    if (item === undefined) break;
    if (getKey(item) <= key) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

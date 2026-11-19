import { addMilliseconds, format, parseISO } from 'date-fns';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Formats an offset from lecture start: 754000 → "12:34", 3_725_000 → "1:02:05".
 * Negative and non-finite values are clamped to "0:00".
 */
export function formatOffset(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Machine-readable ISO 8601 duration for <time datetime>, e.g. "PT12M34S". */
export function toIsoDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}${s}S`;
}

/** Splits a duration into whole hours and minutes (rounded to the nearest minute). */
export function durationParts(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** Wall-clock time of an offset, e.g. "10:32 AM". Returns null when the lecture never started. */
export function wallClockAt(startedAtIso: string | null, offsetMs: number): string | null {
  if (startedAtIso === null) return null;
  return format(addMilliseconds(parseISO(startedAtIso), offsetMs), 'h:mm a');
}

/** "19 Nov 2026" */
export function formatDate(iso: string): string {
  return format(parseISO(iso), 'd MMM yyyy');
}

/** "19 Nov 2026, 10:05 AM" */
export function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'd MMM yyyy, h:mm a');
}

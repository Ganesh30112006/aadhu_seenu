export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;

/**
 * Exponential backoff with "full jitter": a uniformly random delay in
 * [0, min(cap, base · 2^attempt)). Spreads reconnects from a whole classroom of phones
 * after a server restart instead of having them all retry in lock-step.
 *
 * @param attempt 0 for the first retry
 * @param random  injected for deterministic tests; must return [0, 1)
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 30));
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** safeAttempt);
  return Math.floor(random() * ceiling);
}

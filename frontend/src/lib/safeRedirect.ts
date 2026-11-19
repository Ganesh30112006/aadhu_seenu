/**
 * Returns `next` only if it is a same-origin path ("/lectures?x=1"), otherwise `fallback`.
 * Prevents open redirects through `/login?next=https://evil.example`.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  if (next === null || next === undefined || next === '') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next.startsWith('/login')) return fallback;
  return next;
}

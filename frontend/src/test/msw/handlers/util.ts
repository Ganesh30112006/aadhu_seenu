import { delay, HttpResponse, type JsonBodyType } from 'msw';
import type { ZodType } from 'zod';
import type { ErrorResponse } from '@/api/types';
import { env } from '@/lib/env';
import { readCookie } from '@/api/client';
import { currentUser, getDb } from '../db';
import type { MockUser } from '../../fixtures/people';

export const API = env.apiBaseUrl;
export const CSRF_TOKEN = 'mock-csrf-token-7f3a';

/** Typed JSON response: the body must match the generated API type. */
export function json<T extends JsonBodyType>(body: T, status = 200): HttpResponse<T> {
  return HttpResponse.json<T>(body, { status });
}

export function error(status: number, code: string, message: string): Response {
  return HttpResponse.json<ErrorResponse>({ code, message }, { status });
}

/** Realistic latency in the browser demo; instant in unit tests. */
export async function latency(min = 120, max = 420): Promise<void> {
  if (getDb().latency) await delay(min + Math.random() * (max - min));
}

export function param(
  params: Record<string, string | readonly string[] | undefined>,
  name: string,
): string {
  const value = params[name];
  return typeof value === 'string' ? value : '';
}

type Guard = { user: MockUser; denied?: never } | { user?: never; denied: Response };

/** Requires a session (401) and, optionally, one of the roles (403). */
export function requireUser(...roles: MockUser['role'][]): Guard {
  const user = currentUser();
  if (user === null) return { denied: error(401, 'not_authenticated', 'Sign in to continue.') };
  if (roles.length > 0 && !roles.includes(user.role)) {
    return { denied: error(403, 'forbidden', 'You do not have permission to do this.') };
  }
  return { user };
}

/** Double-submit CSRF check, as the real backend does on mutating requests. */
export function csrfFailure(request: Request): Response | null {
  const header = request.headers.get('X-CSRF-Token');
  if (header === null || header !== readCookie('csrftoken')) {
    return error(403, 'csrf_failed', 'Security token missing. Reload the page and try again.');
  }
  return null;
}

export function setCsrfCookie(): void {
  document.cookie = `csrftoken=${CSRF_TOKEN}; path=/; SameSite=Lax`;
}

/** Parses a JSON body with Zod, returning a FastAPI-style 422 on failure. */
export async function body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { invalid: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { invalid: error(422, 'invalid_body', 'Request body must be JSON.') };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      invalid: error(422, 'validation_error', result.error.issues.map((i) => i.message).join('; ')),
    };
  }
  return { data: result.data };
}

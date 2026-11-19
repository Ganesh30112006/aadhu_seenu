import createClient, { type Middleware } from 'openapi-fetch';
import { env } from '@/lib/env';
import { ApiError } from './errors';
import type { paths } from './generated/schema';

const CSRF_COOKIE = 'csrftoken';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Double-submit CSRF: echo the readable csrftoken cookie on every mutating request. */
const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (SAFE_METHODS.has(request.method)) return undefined;
    const token = readCookie(CSRF_COOKIE);
    if (token !== null) request.headers.set(CSRF_HEADER, token);
    return request;
  },
};

/** Typed REST client. Session auth uses the httpOnly cookie, so credentials are always sent. */
export const api = createClient<paths>({
  baseUrl: env.apiBaseUrl,
  credentials: 'include',
  headers: { Accept: 'application/json' },
  // Resolve fetch per call, not at import: request interceptors (MSW in tests) patch it later.
  fetch: (input) => globalThis.fetch(input),
});
api.use(csrfMiddleware);

interface ApiSuccess<D> {
  data: D;
  error?: never;
  response: Response;
}
type ApiResult<D, E> = ApiSuccess<D> | { data?: never; error: E; response: Response };

function isSuccess<D, E>(result: ApiResult<D, E>): result is ApiSuccess<D> {
  return result.response.ok && result.error === undefined;
}

/**
 * Awaits an openapi-fetch call and returns its data, or throws an ApiError.
 * Network failures (fetch rejects) become ApiError of kind "network".
 */
export async function request<D, E>(call: Promise<ApiResult<D, E>>): Promise<D> {
  let result: ApiResult<D, E>;
  try {
    result = await call;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw ApiError.network(cause);
  }
  if (!isSuccess(result)) {
    throw ApiError.fromResponse(result.response, result.error);
  }
  return result.data;
}

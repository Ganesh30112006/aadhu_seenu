/*
 * Error bodies are untrusted: accept the documented {code, message} and FastAPI's default `detail`.
 * Parsed with type guards (not Zod) because this module is part of the initial bundle.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describe(body: unknown): { code?: string; message?: string } {
  if (!isRecord(body)) return {};
  if (typeof body.code === 'string' && typeof body.message === 'string') {
    return { code: body.code, message: body.message };
  }
  if (typeof body.detail === 'string') return { message: body.detail };
  if (Array.isArray(body.detail)) {
    const messages = body.detail.flatMap((d: unknown) =>
      isRecord(d) && typeof d.msg === 'string' ? [d.msg] : [],
    );
    if (messages.length > 0) return { message: messages.join('; ') };
  }
  return {};
}

export type ApiErrorKind = 'network' | 'http';

/** Every failed request becomes an ApiError, so UI code handles one error type. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isNetwork(): boolean {
    return this.kind === 'network';
  }
  /** 4xx errors will not succeed on retry; network and 5xx errors might. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.status >= 500;
  }

  static fromResponse(response: Response, body: unknown): ApiError {
    const parsed = describe(body);
    const code = parsed.code ?? `http_${String(response.status)}`;
    const message = parsed.message ?? (response.statusText || 'Request failed');
    return new ApiError('http', response.status, code, message);
  }

  static network(cause: unknown): ApiError {
    const error = new ApiError('network', 0, 'network_error', 'Network request failed');
    error.cause = cause;
    return error;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

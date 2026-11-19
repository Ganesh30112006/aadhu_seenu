/*
 * Runtime configuration from Vite env. Validated by hand (not Zod) because this module is part of
 * the initial bundle and the checks are trivial.
 */
function readString(name: 'VITE_API_BASE_URL' | 'VITE_WS_BASE_URL'): string | undefined {
  const value: unknown = import.meta.env[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string')
    throw new Error(`Invalid environment configuration: ${name} must be a string`);
  return value;
}

const origin = window.location.origin;

function defaultWsBase(): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

export const env = {
  /** Absolute API base without trailing slash, e.g. "https://classroom.example.edu/api". */
  apiBaseUrl: new URL(readString('VITE_API_BASE_URL') ?? '/api', origin)
    .toString()
    .replace(/\/$/, ''),
  /** Absolute WebSocket origin, e.g. "wss://classroom.example.edu". */
  wsBaseUrl: (readString('VITE_WS_BASE_URL') ?? defaultWsBase()).replace(/\/$/, ''),
} as const;

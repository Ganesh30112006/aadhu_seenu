/**
 * The only place allowed to touch `console`. In production builds logging is a no-op, so
 * invalid WebSocket frames or recoverable errors never spam the user's console.
 */
export interface Logger {
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test';

export const logger: Logger = {
  warn(message, details) {
    // eslint-disable-next-line no-console -- central logger, dev builds only
    if (enabled) console.warn(`[smart-classroom] ${message}`, details ?? '');
  },
  error(message, details) {
    // eslint-disable-next-line no-console -- central logger, dev builds only
    if (enabled) console.error(`[smart-classroom] ${message}`, details ?? '');
  },
};

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { LiveSocketManager, type LiveSocketDeps } from './LiveSocketManager';

/** Real browser implementations of the manager's dependencies. */
export function browserDeps(): LiveSocketDeps {
  return {
    createSocket: (url) => new WebSocket(url),
    buildUrl: (lectureId) => `${env.wsBaseUrl}/ws/lectures/${encodeURIComponent(lectureId)}/live`,
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle);
    },
    scheduleFlush: (callback) => {
      if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          callback();
        });
      } else {
        setTimeout(callback, 16);
      }
    },
    visibility: {
      isVisible: () => document.visibilityState === 'visible',
      subscribe: (listener) => {
        const handler = (): void => {
          listener(document.visibilityState === 'visible');
        };
        document.addEventListener('visibilitychange', handler);
        return () => {
          document.removeEventListener('visibilitychange', handler);
        };
      },
    },
    network: {
      isOnline: () => navigator.onLine,
      subscribe: (listener) => {
        const online = (): void => {
          listener(true);
        };
        const offline = (): void => {
          listener(false);
        };
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        return () => {
          window.removeEventListener('online', online);
          window.removeEventListener('offline', offline);
        };
      },
    },
    logger,
  };
}

/** The single app-wide live connection manager. */
export const liveSocketManager = new LiveSocketManager(browserDeps());

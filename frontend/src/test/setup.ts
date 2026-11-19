import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import '@/app/i18n';
import { resetMockDb } from './msw/db';
import { server } from './msw/node';

// findBy*/waitFor default to 1 s, which is too short when the whole suite runs in parallel on a
// loaded machine (lazy routes + MSW). Real failures still fail; slow passes no longer flake.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout, so no ResizeObserver. A no-op is enough: the window virtualiser sizes rows
// from window.innerHeight and the estimates.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {
      /* nothing to observe without layout */
    }
    unobserve(): void {
      /* nothing to observe without layout */
    }
    disconnect(): void {
      /* nothing to observe without layout */
    }
  };
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDb();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-transcript-size');
});

afterAll(() => {
  server.close();
});

import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from '@/api/queryClient';
import type { LiveSocketManager } from '@/api/ws/LiveSocketManager';
import { AppProviders } from '@/app/AppProviders';
import { createRoutes } from '@/app/router';
import { LiveSocketContext } from '@/features/live-lecture/live';
import { getDb, persistSession, setMockLatency } from './msw/db';
import { USER_IDS } from './fixtures/people';

export type SignedInAs = keyof typeof USER_IDS | null;

export interface RenderAppResult extends RenderResult {
  user: UserEvent;
  router: ReturnType<typeof createMemoryRouter>;
}

/**
 * Renders the real route tree at `path` against the MSW mock API, signed in as a fixture user
 * (or signed out with `as: null`). Mock latency is off. Pass `live` to replace the browser
 * WebSocket manager with one built on the fake socket environment.
 */
export function renderApp(
  path: string,
  { as = 'priya', live }: { as?: SignedInAs; live?: LiveSocketManager } = {},
): RenderAppResult {
  setMockLatency(false);
  const userId = as === null ? null : USER_IDS[as];
  getDb().sessionUserId = userId;
  persistSession(userId);

  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  const router = createMemoryRouter(createRoutes(queryClient), { initialEntries: [path] });
  const app = (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  const result = render(
    live === undefined ? app : <LiveSocketContext value={live}>{app}</LiveSocketContext>,
  );
  return { ...result, user: userEvent.setup(), router };
}

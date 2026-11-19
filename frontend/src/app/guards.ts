import type { QueryClient } from '@tanstack/react-query';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import type { Role, User } from '@/api/types';
import { meQueryOptions } from '@/features/auth/api';
import { safeRedirectPath } from '@/lib/safeRedirect';
import { paths } from './paths';

/** Cached session if present, otherwise fetched once (replacement for ensureQueryData). */
function loadMe(queryClient: QueryClient) {
  return queryClient.query({ ...meQueryOptions, staleTime: 'static' });
}

/** Where each role lands after signing in. */
export function homeFor(user: User): string {
  return user.role === 'admin' ? paths.devices() : paths.home();
}

/** Route loader: requires a session, otherwise redirects to /login?next=<current URL>. */
export function requireAuth(queryClient: QueryClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<null> => {
    const user = await loadMe(queryClient);
    if (user === null) {
      const url = new URL(request.url);
      throw redirect(paths.login(`${url.pathname}${url.search}`));
    }
    return null;
  };
}

/**
 * Route loader: requires one of the roles (403 otherwise). UI convenience only:
 * the backend enforces permissions on every request.
 */
export function requireRole(queryClient: QueryClient, roles: readonly Role[]) {
  return async (): Promise<null> => {
    const user = await loadMe(queryClient);
    if (user !== null && !roles.includes(user.role)) {
      throw new Response(null, { status: 403, statusText: 'Forbidden' });
    }
    return null;
  };
}

/** /login loader: already signed in → go where `next` points (if safe) or to the role's home. */
export function redirectIfAuthenticated(queryClient: QueryClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<null> => {
    const user = await loadMe(queryClient);
    if (user !== null) {
      const next = new URL(request.url).searchParams.get('next');
      throw redirect(safeRedirectPath(next, homeFor(user)));
    }
    return null;
  };
}

import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import type { User } from '@/api/types';
import { currentUser, getDb, persistSession, publicUser } from '../db';
import { API, body, csrfFailure, error, json, latency, setCsrfCookie } from './util';

const MAX_FAILED_LOGINS = 5;

export const authHandlers = [
  http.post(`${API}/auth/login`, async ({ request }) => {
    await latency(300, 700);
    const parsed = await body(request, z.object({ email: z.string(), password: z.string() }));
    if ('invalid' in parsed) return parsed.invalid;
    const db = getDb();
    if (db.failedLogins >= MAX_FAILED_LOGINS) {
      return error(429, 'too_many_attempts', 'Too many failed sign-in attempts.');
    }
    const user = db.users.find(
      (u) =>
        u.email.toLowerCase() === parsed.data.email.trim().toLowerCase() &&
        u.password === parsed.data.password,
    );
    if (user === undefined) {
      db.failedLogins += 1;
      return error(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    if (!user.active) return error(401, 'account_disabled', 'This account has been disabled.');
    db.failedLogins = 0;
    db.sessionUserId = user.id;
    persistSession(user.id);
    setCsrfCookie();
    return json<User>(publicUser(user));
  }),

  http.post(`${API}/auth/logout`, async () => {
    await latency();
    getDb().sessionUserId = null;
    persistSession(null);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/auth/me`, async () => {
    await latency(80, 200);
    const user = currentUser();
    if (user === null) return error(401, 'not_authenticated', 'Sign in to continue.');
    setCsrfCookie();
    return json<User>(publicUser(user));
  }),

  http.patch(`${API}/auth/me`, async ({ request }) => {
    await latency();
    const user = currentUser();
    if (user === null) return error(401, 'not_authenticated', 'Sign in to continue.');
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(request, z.object({ full_name: z.string().trim().min(1).max(120) }));
    if ('invalid' in parsed) return parsed.invalid;
    user.full_name = parsed.data.full_name;
    return json<User>(publicUser(user));
  }),

  http.post(`${API}/auth/password`, async ({ request }) => {
    await latency();
    const user = currentUser();
    if (user === null) return error(401, 'not_authenticated', 'Sign in to continue.');
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(
      request,
      z.object({ current_password: z.string(), new_password: z.string().min(8).max(200) }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    if (parsed.data.current_password !== user.password) {
      return error(400, 'wrong_password', 'The current password is incorrect.');
    }
    user.password = parsed.data.new_password;
    return new HttpResponse(null, { status: 204 });
  }),
];

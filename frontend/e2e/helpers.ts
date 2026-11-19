import { expect, type Page } from '@playwright/test';

/** Demo accounts from src/test/fixtures/people.ts (mock mode only). */
export const USERS = {
  lecturer: { email: 'priya.raghavan@college.example', password: 'lecturer-demo' },
  student: { email: 'arjun.kumar@college.example', password: 'student-demo' },
  admin: { email: 'meena.iyer@college.example', password: 'admin-demo' },
} as const;
export type Role = keyof typeof USERS;

/** Fixture ids from src/test/fixtures (kept literal: e2e does not import app code). */
export const IDS = {
  scheduling: 'c1a5e0de-7f3a-4b2c-9d10-000000000001',
  schedulingLive: 'c1a5e0de-7f3a-4b2c-9d10-000000000002',
  subjectOs: '5d0e7c1a-2b3c-4d5e-9f60-000000000501',
  room204: '9a8b7c6d-5e4f-4a3b-8c2d-000000000204',
} as const;

/** Signs in through the real form, then lands on `next`. */
export async function signIn(page: Page, role: Role, next = '/'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(USERS[role].email);
  await page.getByLabel('Password', { exact: true }).fill(USERS[role].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Drives the simulated live lecture (mock mode). */
export const mockLive = {
  async seek(page: Page, lectureId: string, elapsedMs: number): Promise<void> {
    await page.waitForFunction(() => window.__mockLive !== undefined);
    await page.evaluate(([id, ms]) => window.__mockLive?.seek(id, ms), [
      lectureId,
      elapsedMs,
    ] as const);
  },
  async setSpeed(page: Page, lectureId: string, speed: number): Promise<void> {
    await page.waitForFunction(() => window.__mockLive !== undefined);
    await page.evaluate(([id, s]) => window.__mockLive?.setSpeed(id, s), [
      lectureId,
      speed,
    ] as const);
  },
  async drop(page: Page, lectureId: string): Promise<void> {
    await page.evaluate((id) => window.__mockLive?.drop(id), lectureId);
  },
};

/** Segment ids currently rendered in a transcript list. */
export async function renderedSegmentIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-segment-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-segment-id') ?? ''));
}

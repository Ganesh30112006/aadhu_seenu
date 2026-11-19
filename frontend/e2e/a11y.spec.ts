import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { IDS, signIn, type Role } from './helpers';

const lecture = (tab: string) => `/lectures/${IDS.scheduling}/${tab}`;

const ROUTES: Record<Role, string[]> = {
  lecturer: [
    '/',
    '/lectures',
    lecture('transcript'),
    lecture('notes'),
    lecture('summary'),
    lecture('revision'),
    lecture('key-terms'),
    lecture('flashcards'),
    lecture('questions'),
    lecture('ask'),
    `/lectures/${IDS.schedulingLive}/live`,
    '/search?q=quantum',
    '/devices',
    '/settings',
  ],
  student: [
    '/',
    '/lectures',
    lecture('transcript'),
    lecture('flashcards'),
    lecture('questions'),
    '/search',
    '/settings',
  ],
  admin: [
    '/',
    '/admin/users',
    '/admin/subjects',
    '/devices',
    `/devices/${IDS.room204}`,
    '/settings',
  ],
};

async function expectNoViolations(page: Page): Promise<void> {
  // Wait for data to load: no skeletons / busy regions left.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test('login page has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectNoViolations(page);
});

const ROLES: readonly Role[] = ['lecturer', 'student', 'admin'];

for (const role of ROLES) {
  for (const route of ROUTES[role]) {
    test(`${role}: ${route} has no WCAG A/AA violations`, async ({ page }) => {
      await signIn(page, role, route);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expectNoViolations(page);
    });
  }
}

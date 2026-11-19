import { expect, test } from '@playwright/test';
import { IDS, signIn } from './helpers';

/** Refreshes docs/screenshots (run with `npm run e2e:screenshots`). */
const SHOTS = [
  { name: 'home-lecturer', role: 'lecturer', path: '/' },
  { name: 'library', role: 'student', path: '/lectures' },
  { name: 'transcript', role: 'student', path: `/lectures/${IDS.scheduling}/transcript` },
  { name: 'notes', role: 'student', path: `/lectures/${IDS.scheduling}/notes` },
  { name: 'live', role: 'student', path: `/lectures/${IDS.schedulingLive}/live` },
  { name: 'search', role: 'student', path: '/search?q=quantum' },
  { name: 'devices', role: 'admin', path: '/devices' },
] as const;

for (const shot of SHOTS) {
  test(shot.name, async ({ page }) => {
    await signIn(page, shot.role, shot.path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await page.screenshot({ path: `docs/screenshots/${shot.name}.png`, fullPage: false });
  });
}

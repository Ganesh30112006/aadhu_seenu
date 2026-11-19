import { expect, test } from '@playwright/test';
import { IDS, mockLive, renderedSegmentIds, signIn } from './helpers';

test('a lecturer prepares a lecture and follows it live', async ({ page }) => {
  await signIn(page, 'lecturer');
  await page.getByLabel('Subject').selectOption(IDS.subjectOs);
  await page.getByLabel('Lecture title').fill('Deadlocks: Banker’s algorithm');
  await page.getByLabel('Microphone', { exact: true }).selectOption(IDS.room204);
  await page.getByText('Students have been told this lecture is recorded and transcribed').click();
  await page.getByRole('button', { name: 'Prepare lecture' }).click();

  await expect(page).toHaveURL(/\/lectures\/[^/]+\/live$/);
  const lectureId = /\/lectures\/([^/]+)\/live$/.exec(page.url())?.[1] ?? '';
  await expect(page.getByRole('heading', { name: 'Deadlocks: Banker’s algorithm' })).toBeVisible();
  await expect(page.getByText('Ready to record')).toBeVisible();

  // The simulated device starts recording 3 s after preparing; speed the lecture up.
  await expect(page.getByText('Ready to record')).toBeHidden({ timeout: 15_000 });
  await mockLive.setSpeed(page, lectureId, 20);
  const transcript = page.getByRole('list', { name: 'Live transcript' });
  await expect(transcript.locator('[data-segment-id]').first()).toBeVisible({ timeout: 20_000 });
});

test('a student sees an outage gap filled in place, and a dropped socket resumes without duplicates', async ({
  page,
}) => {
  const live = IDS.schedulingLive;
  await signIn(page, 'student', `/lectures/${live}/live`);
  const transcript = page.getByRole('list', { name: 'Live transcript' });
  await expect(transcript.locator('[data-segment-id]').first()).toBeVisible();

  // Just before the device loses Wi-Fi at 10:32 of the lecture.
  await mockLive.seek(page, live, 625_000);
  await mockLive.setSpeed(page, live, 10);
  await expect(page.getByText('Audio from 10:32 syncing…')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Live captions are paused/)).toBeVisible();

  // The browser's own socket drops too; it reconnects and resumes from its last seq.
  await mockLive.drop(page, live);
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The device comes back at 13:32 and uploads the buffered audio 9 s later.
  await mockLive.seek(page, live, 815_000);
  await expect(page.getByText(/^Audio .* syncing…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Live captions are paused/)).toBeHidden();

  const ids = await renderedSegmentIds(page);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
});

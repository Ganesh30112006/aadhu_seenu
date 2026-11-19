import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { IDS, signIn } from './helpers';

test('search finds a moment and opens the transcript scrolled to it', async ({ page }) => {
  await signIn(page, 'student', '/search');
  await page.getByLabel('Search all transcripts').fill('time quantum');
  await page.getByLabel('Search all transcripts').press('Enter');

  const open = page.getByRole('link', { name: /^Open at \d+:\d{2}/ }).first();
  await expect(open).toBeVisible();
  await open.click();

  await expect(page).toHaveURL(/\/transcript\?t=\d+&seg=/);
  const linked = page.getByText('Linked moment');
  await expect(linked).toBeVisible();
  await expect(linked).toBeInViewport();
});

test('a deep link far into a lecture scrolls the virtual list to that line', async ({ page }) => {
  await signIn(page, 'student', `/lectures/${IDS.scheduling}/transcript?t=2400000`);
  const linked = page.getByText('Linked moment');
  await expect(linked).toBeInViewport({ timeout: 15_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
});

test('the practice quiz scores answers and shows explanations', async ({ page }) => {
  await signIn(page, 'student', `/lectures/${IDS.scheduling}/questions`);
  const questions = page.locator('fieldset');
  await expect(questions.first()).toBeVisible();

  await expect(page.getByText(/questions? not answered yet\./)).toBeVisible();

  const count = await questions.count();
  for (let i = 0; i < count; i += 1) {
    await questions.nth(i).getByRole('radio').first().check();
  }
  await page.getByRole('button', { name: 'Check answers' }).click();
  await expect(
    page.getByText(new RegExp(`^You scored \\d+ out of ${String(count)}$`)),
  ).toBeVisible();
  await expect(page.getByText(/^(Correct|Not quite)$/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(/^You scored/)).toBeHidden();
});

test('exports the transcript as a text file', async ({ page }) => {
  await signIn(page, 'student', `/lectures/${IDS.scheduling}/transcript`);
  await page.getByRole('button', { name: 'Export' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Plain text' }).click();
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toMatch(/\.txt$/);
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  expect(text).toContain('CPU Scheduling Algorithms');
  await expect(page.getByText(/^Downloaded /)).toBeVisible();
});

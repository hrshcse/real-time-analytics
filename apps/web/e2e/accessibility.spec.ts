import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openConnected } from './helpers';

/** WBS 19: automated WCAG 2.1 A/AA checks on the live dashboard, plus reduced motion. */

test('no WCAG A/AA violations on the live dashboard', async ({ page }) => {
  await openConnected(page);
  await page.waitForTimeout(2500); // charts, grid and KPIs populated
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.impact} ${v.id}: ${v.nodes.length} × ${v.help}`,
  );
  expect(summary).toEqual([]);
});

test('no violations with the Performance panel and replay controls open', async ({ page }) => {
  await openConnected(page);
  await page.locator('summary', { hasText: 'Performance' }).click();
  await page.locator('summary', { hasText: 'Pipeline details' }).click();
  await page.getByRole('button', { name: 'Replay…' }).click();
  await page.waitForTimeout(1500);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.impact} ${v.id}: ${v.help}`)).toEqual([]);
});

test('reduced motion turns off the status pulse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const dot = page.locator('header [data-status] span').first();
  await expect(dot).toHaveCSS('animation-name', 'none');
});

test('connection status is announced politely, streamed numbers are not', async ({ page }) => {
  await openConnected(page);
  await expect(page.locator('header').getByRole('status')).toHaveAttribute('aria-live', 'polite');
  // KPI values must not be live regions (they'd announce several times a second).
  await expect(page.locator('[aria-label="Key metrics"] [aria-live]')).toHaveCount(0);
});

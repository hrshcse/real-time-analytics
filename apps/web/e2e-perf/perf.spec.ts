import { expect, test } from '@playwright/test';

/**
 * Fails CI on runtime performance regressions. Budgets are deliberately looser than measured
 * values (docs/PERFORMANCE.md) so shared CI runners don't flake, but tight enough that the known
 * failure modes trip them: naive per-message rendering (9 FPS, 160 publishes/s) or an unbounded
 * worker queue.
 */
const BUDGET = {
  minFps: 40,
  maxPublishesPerSec: 10,
  maxInFlightFrames: 40, // backpressure cap is 32
  maxHeapMB: 60,
  maxLongTasks10s: 5,
};

const card = async (page: import('@playwright/test').Page, label: string) => {
  const text = await page
    .locator('dt', { hasText: new RegExp(`^${label.replace(/[()/]/g, '\\$&')}$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]')
    .innerText();
  return Number(text.replace(/[^\d.]/g, ''));
};

test('10K events/s at 200 frames/s stays within budget', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header').getByRole('status')).toHaveText(/^Connected/);
  await page.locator('summary', { hasText: 'Performance' }).click();
  await page.getByLabel('Rate', { exact: true }).selectOption('10000');
  await page.waitForTimeout(8000); // warm-up + one full 10 s long-task window mostly elapsed

  const measured = {
    fps: await card(page, 'FPS'),
    publishesPerSec: await card(page, 'Publishes / s'),
    inFlight: await card(page, 'In-flight frames'),
    eventsPerSec: await card(page, 'Events / sec'),
    heapMB: await card(page, 'Memory'),
    longTasks: await card(page, 'Long tasks (10 s)'),
  };
  console.log('perf gate:', JSON.stringify(measured));

  expect(measured.fps, 'FPS').toBeGreaterThanOrEqual(BUDGET.minFps);
  expect(measured.publishesPerSec, 'publishes/s (render batching)').toBeLessThanOrEqual(
    BUDGET.maxPublishesPerSec,
  );
  expect(measured.inFlight, 'in-flight frames (backpressure)').toBeLessThanOrEqual(
    BUDGET.maxInFlightFrames,
  );
  expect(measured.eventsPerSec, 'throughput').toBeGreaterThan(9000);
  expect(measured.heapMB, 'main-thread heap MB').toBeLessThanOrEqual(BUDGET.maxHeapMB);
  expect(measured.longTasks, 'long tasks in 10 s').toBeLessThanOrEqual(BUDGET.maxLongTasks10s);
});

test('the naive render mode would fail this gate (the gate can catch the regression)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('header').getByRole('status')).toHaveText(/^Connected/);
  await page.locator('summary', { hasText: 'Performance' }).click();
  await page.getByLabel('Rate', { exact: true }).selectOption('10000');
  await page.locator('#exp-render').selectOption('immediate');
  await page.waitForTimeout(5000);
  expect(await card(page, 'Publishes / s')).toBeGreaterThan(BUDGET.maxPublishesPerSec);
});

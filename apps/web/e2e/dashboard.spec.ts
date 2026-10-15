import { expect, test } from '@playwright/test';
import { cardNumber, openConnected, status } from './helpers';

/**
 * The WBS 18.3 flow: open → connect → receive data → pause → resume → disconnect → reconnect,
 * plus a dropped connection, an auth refusal and the grid.
 */

test('streams live data into KPIs, charts and the grid', async ({ page }) => {
  await openConnected(page);
  await expect.poll(() => cardNumber(page, 'Events / sec')).toBeGreaterThan(500);
  await expect(page.locator('canvas')).toHaveCount(6);
  await expect(page.getByRole('grid', { name: 'Events' }).getByRole('row')).not.toHaveCount(1);
  await expect(page.getByText(/points per metric/)).toBeVisible();
});

test('pausing the chart freezes it while the stream keeps counting', async ({ page }) => {
  await openConnected(page);
  await page.getByRole('button', { name: 'Pause chart' }).click();
  await expect(page.getByText('Paused — stream continues')).toBeVisible();
  // The stream keeps flowing while the chart is frozen.
  await expect.poll(() => cardNumber(page, 'Events / sec')).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Resume chart' }).click();
  await expect(page.getByText('Paused — stream continues')).toBeHidden();
});

test('stream controls: rate, stop (empty state), start', async ({ page }) => {
  await openConnected(page);
  await page.getByLabel('Rate', { exact: true }).selectOption('10000');
  await expect
    .poll(() => cardNumber(page, 'Events / sec'), { timeout: 15_000 })
    .toBeGreaterThan(5000);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('The stream is stopped')).toBeVisible();
  await page.getByRole('button', { name: 'Start stream' }).click();
  await expect(page.getByText('The stream is stopped')).toBeHidden();
  await page.getByLabel('Rate', { exact: true }).selectOption('1000');
});

test('disconnect and reconnect', async ({ page }) => {
  await openConnected(page);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(status(page)).toHaveText(/^Disconnected/);
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(status(page)).toHaveText(/^Connected/);
});

test('recovers automatically when the connection drops', async ({ page }) => {
  // In dev, React StrictMode opens (and immediately closes) one extra socket, so we drop the
  // connection that is live once the page reports Connected, not "the first one".
  const routes: Array<{ close: () => void }> = [];
  await page.routeWebSocket('ws://localhost:8080/', (ws) => {
    const server = ws.connectToServer();
    routes.push({
      close: () => {
        ws.close({ code: 1011, reason: 'simulated drop' });
        server.close();
      },
    });
  });
  await openConnected(page);
  const before = routes.length;
  routes.at(-1)!.close();
  await expect(status(page)).toHaveText(/^Reconnecting/);
  await expect(page.getByText(/Connection lost \(code 1011\)/)).toBeVisible();
  await expect(status(page)).toHaveText(/^Connected/, { timeout: 10_000 });
  expect(routes.length).toBe(before + 1); // exactly one automatic retry was needed
});

test('auth refusal shows an error and is not retried', async ({ page }) => {
  let attempts = 0;
  await page.routeWebSocket('ws://localhost:8080/', (ws) => {
    attempts++;
    ws.close({ code: 4401, reason: 'Unauthorized' });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('4401 Unauthorized');
  const afterRefusal = attempts; // includes StrictMode's extra socket in dev
  await page.waitForTimeout(3000); // longer than the first backoff step
  expect(attempts).toBe(afterRefusal);
});

test('grid: sort by value, search, keyboard selection', async ({ page }) => {
  await openConnected(page);
  const grid = page.getByRole('grid', { name: 'Events' });
  await expect(grid.getByRole('row')).not.toHaveCount(1);

  await grid.getByRole('button', { name: /^Value/ }).click();
  await expect(grid.getByRole('columnheader', { name: /Value/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );

  await page.getByLabel('Search events').fill('worker-01');
  await expect(grid.getByRole('gridcell', { name: 'api-01' })).toHaveCount(0);

  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.getByText(/1 selected/)).toBeVisible();
});

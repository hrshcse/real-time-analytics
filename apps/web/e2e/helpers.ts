import { expect, type Page } from '@playwright/test';

export const status = (page: Page) => page.locator('header').getByRole('status');

export async function openConnected(page: Page) {
  await page.goto('/');
  await expect(status(page)).toHaveText(/^Connected/);
}

/** Read a KPI/stat card's number by its label. */
export async function cardNumber(page: Page, label: string): Promise<number> {
  const text = await page
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]')
    .innerText();
  return Number(text.replace(/[^\d.]/g, ''));
}

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const users = {
  owner: { email: 'owner@shabu.local', password: 'password123', home: /\/dashboard/ },
  admin: { email: 'admin@shabu.local', password: 'password123', home: /\/tables/ },
  cashier: { email: 'cashier@shabu.local', password: 'password123', home: /\/pos/ },
  staff: { email: 'staff@shabu.local', password: 'password123', home: /\/kds/ },
  restricted: { email: 'restricted@shabu.local', password: 'password123', home: /\/kds/ },
} as const;

export async function loginAs(page: Page, role: keyof typeof users) {
  const user = users[role];
  await page.goto('/login');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(user.home);
}

export async function expectNoA11yViolations(page: Page, tags: string[]) {
  const results = await new AxeBuilder({ page })
    .withTags(tags)
    .exclude('[data-nextjs-toast]')
    .analyze();

  expect(results.violations).toEqual([]);
}

export async function openTableFromTablesPage(page: Page, tableLabel: string, guests = { adults: 2, children: 1 }) {
  await page.goto('/tables');
  await page.getByText(new RegExp(`^${tableLabel}$`)).click();
  await page.getByRole('button', { name: /เปิดโต๊ะ/ }).click();

  const adultTile = page.getByText('Adult Buffet').first();
  for (let i = 0; i < guests.adults; i += 1) {
    await adultTile.click();
  }

  const childTile = page.getByText('Child Buffet').first();
  for (let i = 0; i < guests.children; i += 1) {
    await childTile.click();
  }

  await page.getByRole('button', { name: /เปิดโต๊ะ/ }).last().click();
  await expect(page.getByText(new RegExp(`เปิดโต๊ะ ${tableLabel} สำเร็จ|พร้อมแล้ว|โต๊ะ ${tableLabel}`))).toBeVisible();
}

export async function clearPaidTableIfVisible(page: Page) {
  const clearButton = page.getByRole('button', { name: /เคลียร์โต๊ะ/ });
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();
  }
}

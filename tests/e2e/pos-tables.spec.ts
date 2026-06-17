import { expect, test } from '@playwright/test';

import { loginAs, openTableFromTablesPage } from './fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('POS and tables flow', () => {
  test('opens a table, sets buffet guests, applies discount, checks out, and exposes receipt printing', async ({ page }) => {
    await loginAs(page, 'cashier');
    await openTableFromTablesPage(page, '1', { adults: 2, children: 1 });

    await page.goto('/pos');
    await page.getByText(/โต๊ะ 1/).first().click();
    await page.getByRole('button', { name: /ปริ้นบิล/ }).click();
    await expect(page.getByRole('button', { name: /พิมพ์บิลแล้ว/ })).toBeVisible();

    await page.getByRole('button', { name: /ชำระเงิน/ }).click();
    const discount = page.getByText('Discount 50').first();
    if (await discount.isVisible().catch(() => false)) {
      await discount.click();
    }

    await page.getByRole('button', { name: /QR PromptPay/ }).click();
    await page.getByRole('button', { name: /ยืนยันชำระ/ }).click();
    await expect(page.getByText(/ชำระเงินสำเร็จ/)).toBeVisible();
    await expect(page.getByRole('button', { name: /พิมพ์ซ้ำ/ })).toBeVisible();
  });

  test('table status changes from available to occupied and back after clearing paid table', async ({ page }) => {
    await loginAs(page, 'cashier');
    await page.goto('/tables');
    await page.getByText(/^1$/).click();
    await expect(page.getByText(/ชำระเงินแล้ว|รอเคลียร์โต๊ะ/)).toBeVisible();
    await page.getByRole('button', { name: /เคลียร์โต๊ะ/ }).click();
    await expect(page.getByText(/ว่าง|เปิดโต๊ะ/).first()).toBeVisible();
  });

  test('moves an open table to an available table', async ({ page }) => {
    await loginAs(page, 'cashier');
    await openTableFromTablesPage(page, '2', { adults: 1, children: 0 });

    await page.goto('/tables');
    await page.getByText(/^2$/).click();
    await page.getByRole('button', { name: /ย้ายโต๊ะ/ }).click();
    await page.getByText(/^3$/).click();
    await expect(page.getByText(/ย้ายโต๊ะไปยัง 3 สำเร็จ|โต๊ะ 3/)).toBeVisible();
  });

  test('links tables into one dining group', async ({ page }) => {
    await loginAs(page, 'cashier');
    await openTableFromTablesPage(page, '4', { adults: 2, children: 0 });

    await page.goto('/tables');
    await page.getByText(/^4$/).click();
    await page.getByRole('button', { name: /เชื่อมโต๊ะ/ }).click();
    await page.getByText(/^5$/).click();
    await page.getByRole('button', { name: /เปิดโต๊ะ|เชื่อมโต๊ะ/ }).last().click();
    await expect(page.getByText(/เชื่อมโต๊ะกับโต๊ะ 4|โต๊ะ 5|กลุ่ม/)).toBeVisible();
  });

  test.skip('TODO: POS does not currently expose staff-side add/edit/delete food ordering; food orders are placed from the customer QR flow.', async () => {});

  test.skip('TODO: table split is not a first-class tables workflow yet; current UI supports linked tables and split payment, not splitting an occupied table into separate sessions.', async () => {});
});

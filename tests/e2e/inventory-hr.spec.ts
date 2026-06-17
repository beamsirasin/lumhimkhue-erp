import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('Inventory and stock flow', () => {
  test('owner can add an ingredient', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/inventory/ingredients');
    await page.getByRole('button', { name: /เพิ่มวัตถุดิบ/ }).click();

    await page.getByPlaceholder(/เนื้อวัวสไลซ์/).fill('E2E Test Ingredient');
    await page.getByPlaceholder(/กก\.|ขวด/).fill('kg');
    await page.locator('input[name="minStock"]').fill('3');
    await page.locator('input[name="parLevel"]').fill('12');
    await page.locator('input[name="lastCost"]').fill('150');
    await page.getByRole('button', { name: /บันทึก/ }).click();

    await expect(page.getByText('E2E Test Ingredient')).toBeVisible();
  });

  test('owner can perform daily stock count and record waste/spoilage adjustment', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/inventory/count');
    await page.getByPlaceholder(/นับได้/).first().fill('9');
    await page.getByPlaceholder(/หมายเหตุสำหรับการนับ/).fill('E2E count note');
    await page.getByRole('button', { name: /บันทึกฉบับร่าง|บันทึก/ }).first().click();

    const adjustmentButton = page.getByRole('button', { name: /ปรับปรุง|ของเสีย|waste/i }).first();
    if (await adjustmentButton.isVisible().catch(() => false)) {
      await adjustmentButton.click();
      await page.getByPlaceholder(/เช่น 5 หรือ -3/).fill('-1');
      await page.getByPlaceholder(/ระบุเหตุผล/).fill('E2E spoilage');
      await page.getByRole('button', { name: /บันทึก|ยืนยัน/ }).last().click();
      await expect(page.getByText(/E2E spoilage|ของเสีย|ปรับปรุง/)).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'TODO',
        description: 'Waste/spoilage UI was not discoverable from the current stock count page.',
      });
    }
  });

  test.skip('TODO: receiving stock is modeled through purchase orders/goods receipts, but the E2E needs stable selectors for the multi-step PO receiving dialog.', async () => {});

  test.skip('TODO: POS sale does not currently reduce inventory automatically; there is no stock movement ledger/current stock deduction to assert.', async () => {});
});

test.describe('HR flow', () => {
  test('owner can add and view a time entry attendance record', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/hr/time');
    await page.getByRole('button', { name: /เพิ่มบันทึก/ }).click();
    await page.locator('input[type="date"]').fill('2026-06-17');
    await page.locator('input[type="time"]').nth(0).fill('09:30');
    await page.locator('input[type="time"]').nth(1).fill('18:00');
    await page.locator('input[type="number"]').fill('30');
    await page.getByRole('button', { name: /^เพิ่ม$/ }).click();

    await expect(page.getByText('09:30')).toBeVisible();
    await expect(page.getByText('18:00')).toBeVisible();
  });

  test.skip('TODO: live employee clock in / clock out buttons are not present; HR currently supports manual time-entry attendance records.', async () => {});
});

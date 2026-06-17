import { expect, test } from '@playwright/test';

import { loginAs } from './fixtures';

test.describe('Login flow', () => {
  test('owner can log in and lands on dashboard', async ({ page }) => {
    await loginAs(page, 'owner');
    await expect(page.getByRole('heading', { name: /dashboard|แดชบอร์ด/i })).toBeVisible();
  });

  test('admin manager can log in and lands on tables', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page).toHaveURL(/\/tables/);
  });

  test('cashier can log in and lands on POS', async ({ page }) => {
    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/pos/);
  });

  test('staff can log in and lands on KDS', async ({ page }) => {
    await loginAs(page, 'staff');
    await expect(page).toHaveURL(/\/kds/);
  });

  test('login fail stays on login and shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('cashier@shabu.local');
    await page.locator('#password').fill('wrong-password');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Invalid|ไม่ถูกต้อง|เข้าสู่ระบบไม่สำเร็จ|อีเมลหรือรหัสผ่าน/i)).toBeVisible();
  });
});

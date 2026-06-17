import { expect, test } from '@playwright/test';

import { expectNoA11yViolations, loginAs } from './fixtures';

test.describe('Permission flow', () => {
  test('cashier cannot access settings', async ({ page }) => {
    await loginAs(page, 'cashier');
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/\/settings/);
  });

  test('staff cannot view owner dashboard sales totals', async ({ page }) => {
    await loginAs(page, 'staff');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test('owner can access admin modules', async ({ page }) => {
    await loginAs(page, 'owner');
    for (const route of ['/dashboard', '/settings', '/inventory', '/hr']) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route));
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });

  test('restricted user is redirected away from a disallowed module', async ({ page }) => {
    await loginAs(page, 'restricted');
    await page.goto('/pos');
    await expect(page).not.toHaveURL(/\/pos/);
  });
});

test.describe('Responsive coverage', () => {
  const desktop = { width: 1440, height: 900 };
  const tablet = { width: 1024, height: 768 };
  const mobile = { width: 390, height: 844 };

  test('core staff pages render on desktop and tablet', async ({ page }) => {
    await loginAs(page, 'cashier');
    for (const viewport of [desktop, tablet]) {
      await page.setViewportSize(viewport);
      for (const route of ['/pos', '/tables']) {
        await page.goto(route);
        await expect(page.locator('body')).not.toBeEmpty();
        await expect(page.locator('main, body')).toBeVisible();
      }
    }
  });

  test('login and customer-facing table page render on mobile', async ({ page }) => {
    await page.setViewportSize(mobile);
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();

    await page.goto('/t/e2e-table-1');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Accessibility smoke tests', () => {
  test('login has no critical axe violations', async ({ page }) => {
    await page.goto('/login');
    await expectNoA11yViolations(page, ['wcag2a', 'wcag2aa']);
  });

  test('POS has no critical axe violations', async ({ page }) => {
    await loginAs(page, 'cashier');
    await page.goto('/pos');
    await expectNoA11yViolations(page, ['wcag2a', 'wcag2aa']);
  });

  test('Tables has no critical axe violations', async ({ page }) => {
    await loginAs(page, 'cashier');
    await page.goto('/tables');
    await expectNoA11yViolations(page, ['wcag2a', 'wcag2aa']);
  });

  test('Dashboard has no critical axe violations', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/dashboard');
    await expectNoA11yViolations(page, ['wcag2a', 'wcag2aa']);
  });
});

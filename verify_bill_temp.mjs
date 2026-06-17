import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  // Login
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="email"]', 'owner@shabu.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|settings|pos/, { timeout: 8000 });
  console.log('Logged in, URL:', page.url());

  // Go to settings
  await page.goto('http://localhost:3000/settings');
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  console.log('Settings loaded');

  // Click บัญชีหลัก (main) tab
  await page.locator('button').filter({ hasText: 'บัญชีหลัก' }).click();
  await page.waitForTimeout(500);

  // Check section labels and toggle states
  const sections = await page.locator('.divide-y label').all();
  console.log('\n=== Current toggle states on "main" tab ===');
  for (const sec of sections) {
    const text = (await sec.innerText()).trim();
    const toggle = sec.locator('.relative.inline-flex');
    const cls = await toggle.getAttribute('class').catch(() => '');
    const hidden = cls?.includes('bg-slate-200');
    console.log(`  ${text}: ${hidden ? '❌ HIDDEN' : '✅ VISIBLE'}`);
  }

  // Find address toggle
  const addressSec = page.locator('label').filter({ hasText: 'ที่อยู่' });
  const addressToggle = addressSec.locator('.relative.inline-flex');
  const addrCls = await addressToggle.getAttribute('class');
  const addressCurrentlyOn = !addrCls?.includes('bg-slate-200');
  console.log('\nAddress is currently:', addressCurrentlyOn ? 'VISIBLE (will hide it)' : 'ALREADY HIDDEN');

  if (addressCurrentlyOn) {
    await addressToggle.click();
    await page.waitForTimeout(300);
    const newCls = await addressToggle.getAttribute('class');
    console.log('After click, address is:', newCls?.includes('bg-slate-200') ? 'HIDDEN ✓' : 'still VISIBLE');
  }

  // Change billTypeLabel to "food"
  const radios = await page.locator('input[type="radio"]').all();
  for (const r of radios) {
    const nameAttr = await r.getAttribute('name');
    if (nameAttr?.includes('billType')) {
      const parent = r.locator('..');
      const labelText = (await parent.innerText()).trim();
      const checked = await r.isChecked();
      console.log(`\nRadio: "${labelText}" - ${checked ? 'SELECTED' : 'not selected'}`);
    }
  }

  // Click "บิลรายการอาหาร" radio
  await page.locator('label').filter({ hasText: 'บิลรายการอาหาร' }).locator('input[type="radio"]').click();
  await page.waitForTimeout(300);
  console.log('Changed to food label');

  // Click Save
  const saveBtn = page.locator('button[type="submit"]');
  await saveBtn.click();
  await page.waitForTimeout(3000);

  // Look for toast
  const toastEl = await page.locator('[data-sonner-toast]').first().textContent({ timeout: 3000 }).catch(() => null);
  console.log('\nToast:', toastEl ?? 'none found');

  // Take screenshot
  await page.screenshot({ path: 'd:/temp/settings_saved.png' }).catch(() => null);

} finally {
  await browser.close();
}

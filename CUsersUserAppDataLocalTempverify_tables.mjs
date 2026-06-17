import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const SCREENS = 'C:/Users/User/AppData/Local/Temp';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);

// --- Login ---
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"], input[type="email"]', 'cashier@shabu.local');
await page.fill('input[name="password"], input[type="password"]', 'password123');
await page.click('button[type="submit"]');
await page.waitForURL('**', { waitUntil: 'networkidle' });
console.log('LOGIN URL:', page.url());

// Navigate to tables
await page.goto(`${BASE}/tables`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: `${SCREENS}/01_tables.png`, fullPage: false });
console.log('01 tables loaded');

// Find an available table (green) and click it
const availableTable = page.locator('[class*="bg-green"]').first();
const tableCount = await availableTable.count();
console.log('Available tables visible:', tableCount);
await availableTable.first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${SCREENS}/02_sheet_available.png` });
console.log('02 sheet opened');

// Click "เปิดโต๊ะ"
const openBtn = page.getByText('เปิดโต๊ะ').first();
await openBtn.click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${SCREENS}/03_open_dialog.png` });
console.log('03 open dialog');

// Click "เชื่อมโต๊ะ" to go to link step
const linkTableBtn = page.getByText('เชื่อมโต๊ะ').first();
const linkBtnVisible = await linkTableBtn.isVisible().catch(() => false);
console.log('เชื่อมโต๊ะ button visible:', linkBtnVisible);
if (linkBtnVisible) {
  await linkTableBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/04_link_step.png` });
  console.log('04 link step');
  
  // Select a linked table
  const tableChips = page.locator('button').filter({ hasText: /^\d+$/ });
  const chipCount = await tableChips.count();
  console.log('Table chips:', chipCount);
  if (chipCount > 0) {
    await tableChips.first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENS}/05_table_selected.png` });
  }
  
  // Click เปิดโต๊ะ to submit
  const submitBtn = page.getByRole('button', { name: 'เปิดโต๊ะ' });
  await submitBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENS}/06_qr_dialog.png` });
  console.log('06 QR dialog');
  
  // Check dialog content
  const dialogTitle = await page.locator('[role="dialog"] h2, [role="dialog"] [data-slot="dialog-title"]').textContent().catch(() => '');
  console.log('QR dialog title:', dialogTitle);
  const linkButtons = page.getByRole('button', { name: /Link/i });
  const linkBtnCount = await linkButtons.count();
  console.log('Link buttons in dialog:', linkBtnCount);
  const printButtons = page.getByRole('button', { name: /พิมพ์ QR/i });
  const printBtnCount = await printButtons.count();
  console.log('Print buttons in dialog:', printBtnCount);
  const qrImg = page.locator('[role="dialog"] img');
  const qrImgCount = await qrImg.count();
  console.log('QR images in dialog (should be 0):', qrImgCount);
  
  // Close QR dialog
  const closeBtn = page.getByRole('button', { name: 'ปิด' });
  await closeBtn.click();
  await page.waitForTimeout(500);
}

// Check canvas for dashed lines (SVG)
await page.goto(`${BASE}/tables`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
const svgLines = await page.locator('svg line[stroke-dasharray]').count();
console.log('Dashed SVG lines on canvas:', svgLines);
await page.screenshot({ path: `${SCREENS}/07_canvas_links.png` });

// Click an occupied (red) table to open sheet
const occupiedTable = page.locator('[class*="bg-red"]').first();
const occupiedCount = await occupiedTable.count();
console.log('Occupied tables visible:', occupiedCount);
if (occupiedCount > 0) {
  await occupiedTable.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/08_occupied_sheet.png` });
  
  // Check for แก้ไข button
  const editBtn = page.getByRole('button', { name: /แก้ไข/ }).filter({ hasNot: page.locator('[class*="admin"]') });
  const editBtnVisible = await page.getByText('แก้ไข').isVisible().catch(() => false);
  console.log('แก้ไข button visible:', editBtnVisible);
  
  if (editBtnVisible) {
    await page.getByText('แก้ไข').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENS}/09_edit_guests_dialog.png` });
    const editDialogTitle = await page.locator('[role="dialog"] [data-slot="dialog-title"]').last().textContent().catch(() => '');
    console.log('Edit dialog title:', editDialogTitle);
    // Close
    await page.keyboard.press('Escape');
  }
}

await browser.close();
console.log('DONE');

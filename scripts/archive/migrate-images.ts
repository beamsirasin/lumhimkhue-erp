/**
 * One-time migration: move base64 data URLs in PostgreSQL to Vercel Blob Storage.
 *
 * Run with:
 *   npx tsx scripts/migrate-images.ts
 *
 * Requires: BLOB_READ_WRITE_TOKEN in environment (or .env.local loaded by dotenv).
 */

import 'dotenv/config';
import { put } from '@vercel/blob';
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db';
import { menuItems, storeSettings } from '../lib/db/schema';

async function base64ToBuffer(dataUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error(`Unexpected data URL format: ${dataUrl.slice(0, 40)}`);
  const [, mimeType, base64] = match;
  return { buffer: Buffer.from(base64.trim(), 'base64'), mimeType };
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

async function migrateMenuItems() {
  const items = await db
    .select({ id: menuItems.id, imageUrl: menuItems.imageUrl })
    .from(menuItems)
    .where(like(menuItems.imageUrl, 'data:%'));

  console.log(`Found ${items.length} menu item(s) with base64 images.`);

  let success = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const { buffer, mimeType } = await base64ToBuffer(item.imageUrl!);
      const filename = `menu-items/${item.id}.${extForMime(mimeType)}`;
      const blob = await put(filename, buffer, { access: 'public', contentType: mimeType });
      await db
        .update(menuItems)
        .set({ imageUrl: blob.url })
        .where(eq(menuItems.id, item.id));
      console.log(`  ✓ ${item.id} → ${blob.url}`);
      success++;
    } catch (e) {
      console.error(`  ✗ ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log(`Menu items: ${success} migrated, ${failed} failed.\n`);
}

async function migrateStoreLogo() {
  const [settings] = await db
    .select({ id: storeSettings.id, logoUrl: storeSettings.logoUrl })
    .from(storeSettings)
    .where(like(storeSettings.logoUrl, 'data:%'))
    .limit(1);

  if (!settings) {
    console.log('Store logo: already migrated or not set.');
    return;
  }

  try {
    const { buffer, mimeType } = await base64ToBuffer(settings.logoUrl!);
    const filename = `store/logo.${extForMime(mimeType)}`;
    const blob = await put(filename, buffer, { access: 'public', contentType: mimeType });
    await db
      .update(storeSettings)
      .set({ logoUrl: blob.url })
      .where(eq(storeSettings.id, settings.id));
    console.log(`Store logo: ✓ → ${blob.url}`);
  } catch (e) {
    console.error(`Store logo: ✗ ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log('=== Image migration: base64 → Vercel Blob ===\n');
  await migrateMenuItems();
  await migrateStoreLogo();
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

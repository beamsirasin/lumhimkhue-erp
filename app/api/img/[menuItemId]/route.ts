import { db } from '@/lib/db';
import { menuItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ menuItemId: string }> },
) {
  try {
    const { menuItemId } = await params;

    const [item] = await db
      .select({ imageUrl: menuItems.imageUrl })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId))
      .limit(1);

    if (!item?.imageUrl) {
      return new NextResponse(null, { status: 404 });
    }

    // Blob URL — redirect directly to Vercel Blob CDN
    if (item.imageUrl.startsWith('https://')) {
      return NextResponse.redirect(item.imageUrl, { status: 302 });
    }

    // Legacy: parse "data:<mime>;base64,<data>"
    const match = item.imageUrl.trim().match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      console.error('[img] imageUrl format unexpected for', menuItemId, item.imageUrl.slice(0, 30));
      return new NextResponse(null, { status: 422 });
    }

    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data.trim(), 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${menuItemId}"`,
      },
    });
  } catch (e) {
    console.error('[img] error', e);
    return new NextResponse(null, { status: 500 });
  }
}

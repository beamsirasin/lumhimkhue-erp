import { redirect } from 'next/navigation';
import { UtensilsCrossed } from 'lucide-react';
import { getActiveSessionByTable } from '@/lib/actions/orders';

interface Props {
  params: Promise<{ tableToken: string }>;
}

export default async function TableQrEntryPage({ params }: Props) {
  const { tableToken } = await params;

  const result = await getActiveSessionByTable(tableToken);

  if (result.ok) {
    redirect(`/t/${tableToken}/s/${result.data.session.sessionToken}`);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-6 py-10">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-dialog)]">
        <div className="border-b border-border bg-[var(--sidebar-header)] px-6 py-6 text-center text-sidebar-foreground">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl border border-sidebar-border bg-sidebar-accent/20">
            <UtensilsCrossed className="size-7" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/60">Lum Him Khue</p>
          <h1 className="mt-1 text-xl font-semibold">ลำฮิมคือ ชาบู บุฟเฟต์</h1>
        </div>

        <div className="px-6 py-7 text-center">
          <h2 className="text-lg font-semibold text-foreground">ยังไม่มีการเปิดโต๊ะ</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            กรุณาแจ้งพนักงานเพื่อเปิดโต๊ะก่อนสั่งอาหาร
          </p>
          <p className="mt-5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {result.error}
          </p>
        </div>
      </div>
    </div>
  );
}

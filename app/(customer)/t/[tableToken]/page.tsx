import { redirect } from 'next/navigation';
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
    <div className="min-h-dvh bg-muted/50 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
          🍲
        </div>
        <h1 className="text-lg font-semibold text-foreground">ยังไม่มีการเปิดโต๊ะ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          กรุณาแจ้งพนักงานเพื่อเปิดโต๊ะก่อนสั่งอาหาร
        </p>
        <p className="mt-4 text-xs text-muted-foreground/60">
          {result.error}
        </p>
      </div>
    </div>
  );
}

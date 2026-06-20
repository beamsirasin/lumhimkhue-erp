'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { getQueueStatus } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';

const STATUS_CONFIG = {
  waiting: {
    heading: 'กำลังรอคิว',
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]',
  },
  called: {
    heading: 'ถึงคิวของคุณแล้ว!',
    color: 'text-[var(--status-info-fg)]',
    bg: 'bg-[var(--status-info-bg)] border-[var(--status-info-border)]',
  },
  seated: {
    heading: 'เข้าที่นั่งแล้ว',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
  },
  left: {
    heading: 'ออกจากคิวแล้ว',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
  },
} as const;

interface QueueStatusProps {
  token: string;
  initialData: QueueStatusData;
}

export function QueueStatus({ token, initialData }: QueueStatusProps) {
  const { data } = useQuery({
    queryKey: ['queue-status', token],
    queryFn: () => getQueueStatus(token).then((r) => (r.ok ? r.data : null)),
    initialData,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">ไม่พบข้อมูลคิว</p>
      </div>
    );
  }

  const { entry, position } = data;
  const cfg = STATUS_CONFIG[entry.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.waiting;

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/30 px-4 py-12">
      {/* Store name */}
      <p className="mb-8 text-sm font-medium text-muted-foreground">ร้านชาบู</p>

      {/* Queue number */}
      <div className={`w-full max-w-xs rounded-2xl border-2 p-8 text-center ${cfg.bg}`}>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">คิวของคุณ</p>
        <p className={`mt-2 text-7xl font-bold tabular-nums ${cfg.color}`}>
          {entry.queueNumber}
        </p>
        <p className={`mt-3 text-lg font-semibold ${cfg.color}`}>{cfg.heading}</p>
      </div>

      {/* Details */}
      <div className="mt-6 w-full max-w-xs space-y-3 rounded-xl border border-border bg-card p-4">
        <Row label="ชื่อ" value={entry.customerName} />
        <Row label="จำนวนคน" value={`${entry.partySize} คน`} />
        {entry.preferredZone && <Row label="โซน" value={entry.preferredZone} />}
        <Row
          label="เวลาลงทะเบียน"
          value={format(new Date(entry.createdAt), 'HH:mm น.', { locale: th })}
        />
      </div>

      {/* Position / status message */}
      <div className="mt-6 w-full max-w-xs text-center">
        {entry.status === 'waiting' && position > 0 && (
          <p className="text-sm text-muted-foreground">
            มีอีก{' '}
            <span className="font-bold tabular-nums text-foreground">{position - 1}</span>{' '}
            กลุ่มข้างหน้าคุณ
          </p>
        )}
        {entry.status === 'waiting' && position === 1 && (
          <p className="text-sm font-medium text-[var(--status-warning-fg)]">คุณเป็นกลุ่มแรก! เตรียมพร้อมได้เลย</p>
        )}
        {entry.status === 'called' && (
          <p className="text-sm font-semibold text-[var(--status-info-fg)]">
            กรุณาแจ้งพนักงานเพื่อรับที่นั่ง
          </p>
        )}
        {entry.status === 'seated' && (
          <p className="text-sm text-[var(--status-success-fg)]">ขอบคุณที่ใช้บริการ สนุกกับมื้ออาหารนะคะ</p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">อัพเดทอัตโนมัติทุก 10 วินาที</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

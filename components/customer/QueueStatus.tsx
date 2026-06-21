'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { BellRing, CheckCircle2, Clock3, MapPin, RefreshCw, Timer, UserRound, UsersRound, XCircle } from 'lucide-react';
import { getQueueStatus } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';

const STATUS_CONFIG = {
  waiting: {
    heading: 'กำลังรอคิว',
    description: 'กรุณารอสัญญาณเรียกจากพนักงาน',
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]',
    dot: 'bg-[var(--status-warning-fg)]',
    halo: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
    Icon: Clock3,
  },
  called: {
    heading: 'ถึงคิวของคุณแล้ว!',
    description: 'โปรดแสดงหน้านี้กับพนักงานเพื่อรับที่นั่ง',
    color: 'text-[var(--status-info-fg)]',
    bg: 'bg-[var(--status-info-bg)] border-[var(--status-info-border)]',
    dot: 'bg-[var(--status-info-fg)]',
    halo: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
    Icon: BellRing,
  },
  seated: {
    heading: 'เข้าที่นั่งแล้ว',
    description: 'ขอบคุณที่ใช้บริการ ขอให้อร่อยกับมื้อนี้',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
  },
  left: {
    heading: 'ออกจากคิวแล้ว',
    description: 'รายการคิวนี้ไม่ได้อยู่ระหว่างรอเรียกแล้ว',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
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
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
            <XCircle className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">ไม่พบข้อมูลคิว</p>
          <p className="mt-1 text-xs text-muted-foreground">กรุณาตรวจสอบลิงก์อีกครั้ง</p>
        </div>
      </div>
    );
  }

  const { entry, position } = data;
  const cfg = STATUS_CONFIG[entry.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.waiting;
  const StatusIcon = cfg.Icon;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <main className="mx-auto flex w-full max-w-sm flex-col gap-5">
        {/* Brand header */}
        <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-subtle)]">
            <span className="text-xl font-bold text-primary">ลฮ</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Lum Him Khue</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">ลำฮิมคือ ชาบู บุฟเฟต์</h1>
          <p className="mt-1 text-sm text-muted-foreground">ระบบคิวหน้าร้าน</p>
        </section>

        {/* Queue number */}
        <section className={`relative overflow-hidden rounded-3xl border p-6 text-center shadow-[var(--shadow-dialog)] ${cfg.bg}`}>
          <div className="absolute left-1/2 top-0 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/30" />
          <div className="relative">
            <div className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border ${cfg.halo}`}>
              <StatusIcon className="size-6" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">คิวของคุณ</p>
            <p className={`mt-2 text-8xl font-bold leading-none tabular-nums ${cfg.color}`}>
              {entry.queueNumber}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className={`size-2.5 rounded-full ${cfg.dot}`} />
              <p className={`text-lg font-semibold ${cfg.color}`}>{cfg.heading}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{cfg.description}</p>
          </div>
        </section>

        {/* Details */}
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <Row icon={<UserRound className="size-4" />} label="ชื่อ" value={entry.customerName} />
          <Row icon={<UsersRound className="size-4" />} label="จำนวนคน" value={`${entry.partySize} คน`} />
          {entry.preferredZone && <Row icon={<MapPin className="size-4" />} label="โซน" value={entry.preferredZone} />}
          <Row
            icon={<Timer className="size-4" />}
            label="เวลาลงทะเบียน"
            value={format(new Date(entry.createdAt), 'HH:mm น.', { locale: th })}
          />
        </section>

        {/* Position / status message */}
        <section className="rounded-2xl border border-border bg-card p-4 text-center shadow-[var(--shadow-card)]">
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
          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" />
            <span>อัพเดทอัตโนมัติทุก 10 วินาที</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

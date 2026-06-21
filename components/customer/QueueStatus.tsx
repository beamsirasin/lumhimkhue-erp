'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Timer,
  UserRound,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { getQueueStatus, cancelQueueByToken } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';
import { toast } from 'sonner';

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
  waiting_suitable_table: {
    heading: 'รอโต๊ะที่เหมาะสม',
    description: 'กำลังรอโต๊ะที่เหมาะกับจำนวนลูกค้าของท่าน',
    color: 'text-[var(--status-orange-fg)]',
    bg: 'bg-[var(--status-orange-bg)] border-[var(--status-orange-border)]',
    dot: 'bg-[var(--status-orange-fg)]',
    halo: 'bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)] border-[var(--status-orange-border)]',
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
  admitted: {
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
  skipped: {
    heading: 'คิวถูกข้ามชั่วคราว',
    description: 'กรุณาติดต่อพนักงานหน้าร้านเพื่อรับคิวใหม่',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
  },
  cancelled: {
    heading: 'ยกเลิกคิวแล้ว',
    description: 'คิวของท่านถูกยกเลิกแล้ว ขอบคุณที่ใช้บริการ',
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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['queue-status', token],
    queryFn: () => getQueueStatus(token).then((r) => (r.ok ? r.data : null)),
    initialData,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelQueueByToken(token);
    setCancelling(false);
    if (!result.ok) {
      toast.error(result.error);
      setShowCancelConfirm(false);
      return;
    }
    setCancelled(true);
    setShowCancelConfirm(false);
    void refetch();
    toast.success('ยกเลิกคิวสำเร็จ');
  }

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
  const statusKey = entry.status as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.waiting;
  const StatusIcon = cfg.Icon;
  const canCancel = !cancelled && (entry.status === 'waiting' || entry.status === 'waiting_suitable_table');
  const seatsTotal = (entry.adultCount ?? 0) + (entry.childCount ?? 0) || entry.partySize;
  const hasAdultChild = (entry.adultCount ?? 0) + (entry.childCount ?? 0) > 0;

  function soupSummary(pots: unknown): string {
    if (!Array.isArray(pots) || pots.length === 0) return '';
    return (pots as Array<{ soups: string[] }>)
      .map((p, i) => `หม้อ${i + 1}: ${p.soups.join(' / ')}`)
      .join('  ');
  }

  const soup = soupSummary(entry.soupPots);

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
          <Row
            icon={<UsersRound className="size-4" />}
            label="จำนวน"
            value={
              hasAdultChild
                ? `${seatsTotal} คน (ผู้ใหญ่ ${entry.adultCount} / เด็ก ${entry.childCount})`
                : `${seatsTotal} คน`
            }
          />
          {soup && (
            <Row icon={<span className="text-sm">🍲</span>} label="น้ำซุป" value={soup} />
          )}
          <Row
            icon={<Timer className="size-4" />}
            label="เวลาลงทะเบียน"
            value={format(new Date(entry.createdAt), 'HH:mm น.', { locale: th })}
          />
        </section>

        {/* Position / status message */}
        <section className="rounded-2xl border border-border bg-card p-4 text-center shadow-[var(--shadow-card)]">
          {entry.status === 'waiting' && position > 1 && (
            <p className="text-sm text-muted-foreground">
              มีอีก{' '}
              <span className="font-bold tabular-nums text-foreground">{position - 1}</span>{' '}
              กลุ่มข้างหน้าคุณ
            </p>
          )}
          {entry.status === 'waiting' && position === 1 && (
            <p className="text-sm font-medium text-[var(--status-warning-fg)]">คุณเป็นกลุ่มแรก! เตรียมพร้อมได้เลย</p>
          )}
          {entry.status === 'waiting_suitable_table' && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--status-orange-fg)]">
                กำลังรอโต๊ะที่เหมาะกับจำนวนลูกค้าของท่าน
              </p>
              <p className="text-xs text-muted-foreground">
                โต๊ะที่ว่างในขณะนี้อาจไม่เหมาะกับจำนวนท่านในกลุ่ม พนักงานกำลังหาโต๊ะที่เหมาะสมให้
              </p>
            </div>
          )}
          {entry.status === 'called' && (
            <p className="text-sm font-semibold text-[var(--status-info-fg)]">
              กรุณาแจ้งพนักงานเพื่อรับที่นั่ง
            </p>
          )}
          {(entry.status === 'seated' || entry.status === 'admitted') && (
            <p className="text-sm text-[var(--status-success-fg)]">ขอบคุณที่ใช้บริการ สนุกกับมื้ออาหารนะคะ</p>
          )}
          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" />
            <span>อัพเดทอัตโนมัติทุก 10 วินาที</span>
          </div>
        </section>

        {/* Policy note */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-xs text-muted-foreground leading-relaxed">
            การเรียกคิวขึ้นอยู่กับลำดับคิวและขนาดโต๊ะที่ว่าง
            หากโต๊ะว่างไม่เหมาะกับจำนวนลูกค้าของคิวก่อนหน้า ร้านอาจเรียกคิวที่นั่งได้ก่อน
          </p>
        </section>

        {/* Cancel button */}
        {canCancel && (
          <section>
            {!showCancelConfirm ? (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="w-full rounded-2xl border border-border bg-card p-4 text-center text-sm font-medium text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:border-[var(--status-danger-border)] hover:text-[var(--status-danger-fg)]"
              >
                ยกเลิกคิวของฉัน
              </button>
            ) : (
              <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 shadow-[var(--shadow-card)]">
                <p className="mb-3 text-sm font-semibold text-[var(--status-danger-fg)]">
                  ยืนยันยกเลิกคิว?
                </p>
                <p className="mb-4 text-xs text-muted-foreground">
                  เมื่อยกเลิกแล้วจะไม่สามารถยกเลิกการยกเลิกได้
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold text-foreground"
                  >
                    ไม่ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {cancelling && <Loader2 className="size-4 animate-spin" />}
                    ยืนยันยกเลิก
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
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

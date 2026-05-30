'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { getQueueStatus } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';

const STATUS_CONFIG = {
  waiting: {
    heading: 'กำลังรอคิว',
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
  },
  called: {
    heading: 'ถึงคิวของคุณแล้ว!',
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-300',
  },
  seated: {
    heading: 'เข้าที่นั่งแล้ว',
    color: 'text-green-600',
    bg: 'bg-green-50 border-green-200',
  },
  left: {
    heading: 'ออกจากคิวแล้ว',
    color: 'text-slate-500',
    bg: 'bg-slate-50 border-slate-200',
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
    initialDataUpdatedAt: Date.now(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">ไม่พบข้อมูลคิว</p>
      </div>
    );
  }

  const { entry, position } = data;
  const cfg = STATUS_CONFIG[entry.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.waiting;

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-12">
      {/* Store name */}
      <p className="mb-8 text-sm font-medium text-slate-500">ร้านชาบู</p>

      {/* Queue number */}
      <div className={`w-full max-w-xs rounded-2xl border-2 p-8 text-center ${cfg.bg}`}>
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">คิวของคุณ</p>
        <p className={`mt-2 text-7xl font-bold tabular-nums ${cfg.color}`}>
          {entry.queueNumber}
        </p>
        <p className={`mt-3 text-lg font-semibold ${cfg.color}`}>{cfg.heading}</p>
      </div>

      {/* Details */}
      <div className="mt-6 w-full max-w-xs space-y-3 rounded-xl border border-slate-200 bg-white p-4">
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
          <p className="text-sm text-slate-600">
            มีอีก{' '}
            <span className="font-bold tabular-nums text-slate-900">{position - 1}</span>{' '}
            กลุ่มข้างหน้าคุณ
          </p>
        )}
        {entry.status === 'waiting' && position === 1 && (
          <p className="text-sm font-medium text-amber-700">คุณเป็นกลุ่มแรก! เตรียมพร้อมได้เลย</p>
        )}
        {entry.status === 'called' && (
          <p className="text-sm font-semibold text-blue-700">
            กรุณาแจ้งพนักงานเพื่อรับที่นั่ง
          </p>
        )}
        {entry.status === 'seated' && (
          <p className="text-sm text-green-700">ขอบคุณที่ใช้บริการ สนุกกับมื้ออาหารนะคะ</p>
        )}
        <p className="mt-4 text-xs text-slate-400">อัพเดทอัตโนมัติทุก 10 วินาที</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

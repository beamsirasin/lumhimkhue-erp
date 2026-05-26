import { differenceInSeconds, format } from 'date-fns';
import { th } from 'date-fns/locale';
import type { TableData } from '@/lib/actions/tables';

const STATUS_CONFIG = {
  available: {
    label: 'ว่าง',
    card: 'border-green-200 bg-green-50 hover:border-green-300',
    badge: 'bg-green-100 text-green-700',
    dot: 'bg-green-500',
  },
  occupied: {
    label: 'มีลูกค้า',
    card: 'border-red-200 bg-red-50 hover:border-red-300',
    badge: 'bg-red-100 text-red-700',
    dot: 'bg-red-500',
  },
  cleaning: {
    label: 'กำลังทำความสะอาด',
    card: 'border-amber-200 bg-amber-50 hover:border-amber-300',
    badge: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-500',
  },
  reserved: {
    label: 'จอง',
    card: 'border-blue-200 bg-blue-50 hover:border-blue-300',
    badge: 'bg-blue-100 text-blue-700',
    dot: 'bg-blue-500',
  },
} as const;

function formatRemaining(endsAt: Date): string {
  const secs = Math.max(0, differenceInSeconds(endsAt, new Date()));
  if (secs === 0) return 'หมดเวลา';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBaseAmount(session: NonNullable<TableData['activeSession']>): string {
  const total =
    Number(session.package.priceAdult) * session.adults +
    Number(session.package.priceChild) * session.children +
    Number(session.package.priceSenior) * session.seniors;
  return total.toLocaleString('th-TH');
}

interface TableCardProps {
  table: TableData;
  onClick: () => void;
}

export function TableCard({ table, onClick }: TableCardProps) {
  const cfg = STATUS_CONFIG[table.status];
  const sess = table.activeSession;
  const guestCount = sess
    ? sess.adults + sess.children + sess.seniors
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${cfg.card}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <span className="text-2xl font-medium tabular-nums text-slate-900">
          {table.number}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* Capacity */}
      <p className="mt-1 text-xs text-slate-500">{table.capacity} ที่นั่ง</p>

      {/* Session info — occupied only */}
      {sess && (
        <div className="mt-3 space-y-1 border-t border-red-100 pt-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">เปิดเมื่อ</span>
            <span className="tabular-nums text-slate-700">
              {format(sess.startedAt, 'HH:mm', { locale: th })}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">เหลือเวลา</span>
            <span className="tabular-nums font-medium text-slate-900">
              {formatRemaining(sess.endsAt)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">จำนวนคน</span>
            <span className="tabular-nums text-slate-700">{guestCount} คน</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">ยอด (ประมาณ)</span>
            <span className="tabular-nums font-medium text-slate-900">
              ฿{formatBaseAmount(sess)}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}

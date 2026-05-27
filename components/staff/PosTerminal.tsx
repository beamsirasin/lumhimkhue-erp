'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  getPosSessionsForPos,
  getPosSessionDetail,
  processPayment,
} from '@/lib/actions/pos';
import type { PosSession, PosSessionDetail } from '@/lib/actions/pos';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

interface PosTerminalProps {
  initialSessions: PosSession[];
}

export function PosTerminal({ initialSessions }: PosTerminalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: sessions = [] } = useQuery({
    queryKey: ['pos-sessions'],
    queryFn: () => getPosSessionsForPos().then((r) => (r.ok ? r.data : [])),
    initialData: initialSessions,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  // Auto-clear selection if session disappears (paid / table changed)
  useEffect(() => {
    if (selectedId && !sessions.find((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [sessions, selectedId]);

  const closing = sessions.filter((s) => s.status === 'closing');
  const active = sessions.filter((s) => s.status === 'active');

  function handlePaid() {
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Left — session list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-base font-semibold text-slate-900">POS / แคชเชียร์</h1>
          <p className="text-xs text-slate-500">
            {closing.length > 0 && (
              <span className="text-red-600 font-medium">{closing.length} รอเรียกเก็บเงิน · </span>
            )}
            {active.length} โต๊ะที่ใช้งาน
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {closing.length > 0 && (
            <div>
              <p className="sticky top-0 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-700">
                รอเรียกเก็บเงิน
              </p>
              {closing.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={selectedId === s.id}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
          {active.length > 0 && (
            <div>
              <p className="sticky top-0 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500">
                กำลังใช้งาน
              </p>
              {active.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={selectedId === s.id}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
          {sessions.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-400">ไม่มีโต๊ะที่ใช้งาน</p>
          )}
        </div>
      </aside>

      {/* Right — detail + payment */}
      <main className="flex-1 overflow-y-auto">
        {selectedId ? (
          <DetailPanel
            sessionId={selectedId}
            onPaid={handlePaid}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-slate-400">เลือกโต๊ะเพื่อดำเนินการ</p>
          </div>
        )}
      </main>
    </div>
  );
}

function baseTotal(session: PosSession): number {
  return (
    Number(session.package.priceAdult) * session.adults +
    Number(session.package.priceChild) * session.children +
    Number(session.package.priceSenior) * session.seniors
  );
}

function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: PosSession;
  selected: boolean;
  onClick: () => void;
}) {
  const total = baseTotal(session);
  const isClosing = session.status === 'closing';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-4 py-3 text-left transition-colors border-b border-slate-100 ${
        selected
          ? 'bg-slate-800 text-white'
          : isClosing
            ? 'bg-red-50 hover:bg-red-100'
            : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-lg font-bold tabular-nums ${selected ? 'text-white' : 'text-slate-900'}`}>
          โต๊ะ {session.table.number}
        </span>
        {isClosing && !selected && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            รอบิล
          </span>
        )}
      </div>
      <p className={`text-xs truncate ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
        {session.package.name} · {session.adults + session.children + session.seniors} คน
      </p>
      <div className={`mt-0.5 flex justify-between text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
        <span>฿{total.toLocaleString('th-TH')}</span>
        <span>{formatDistanceToNowStrict(new Date(session.startedAt), { locale: th, addSuffix: true })}</span>
      </div>
    </button>
  );
}

function DetailPanel({
  sessionId,
  onPaid,
}: {
  sessionId: string;
  onPaid: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['pos-detail', sessionId],
    queryFn: () => getPosSessionDetail(sessionId).then((r) => (r.ok ? r.data : null)),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-400">กำลังโหลด…</p>
      </div>
    );
  }

  return <PaymentPanel detail={data} onPaid={onPaid} />;
}

function PaymentPanel({
  detail,
  onPaid,
}: {
  detail: PosSessionDetail;
  onPaid: () => void;
}) {
  const { session, orders, totals } = detail;

  const [method, setMethod] = useState<'cash' | 'qr_promptpay' | 'transfer' | 'card'>('cash');
  const [received, setReceived] = useState('');
  const [discount, setDiscount] = useState('0');
  const [wasteCharge, setWasteCharge] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const discountNum = Math.max(0, Number(discount) || 0);
  const wasteNum = Math.max(0, Number(wasteCharge) || 0);
  const total = totals.subtotal - discountNum + wasteNum;
  const receivedNum = Number(received) || 0;
  const change = method === 'cash' ? receivedNum - total : 0;

  const allOrderItems = orders.flatMap((o) => o.items).filter((i) => i.status !== 'cancelled');

  async function handleSubmit() {
    if (method === 'cash' && receivedNum < total) {
      toast.error('จำนวนเงินที่รับไม่เพียงพอ');
      return;
    }
    setSubmitting(true);
    const result = await processPayment({
      sessionId: session.id,
      paymentMethod: method,
      receivedAmount: method === 'cash' ? receivedNum : total,
      discount: discountNum,
      wasteCharge: wasteNum,
      notes: notes || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `ชำระเงินสำเร็จ ฿${result.data.total.toLocaleString('th-TH')}` +
        (method === 'cash' && result.data.changeAmount > 0
          ? ` · เงินทอน ฿${result.data.changeAmount.toLocaleString('th-TH')}`
          : ''),
    );
    onPaid();
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Session header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold text-slate-900">โต๊ะ {session.table.number}</p>
            <p className="text-sm text-slate-500">{session.package.name}</p>
          </div>
          {session.status === 'closing' && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
              รอเรียกเก็บเงิน
            </span>
          )}
        </div>

        {/* Guest breakdown */}
        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
          {session.adults > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">
                ผู้ใหญ่ {session.adults} คน × ฿{Number(session.package.priceAdult).toLocaleString('th-TH')}
              </span>
              <span className="tabular-nums font-medium text-slate-900">
                ฿{(Number(session.package.priceAdult) * session.adults).toLocaleString('th-TH')}
              </span>
            </div>
          )}
          {session.children > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">
                เด็ก {session.children} คน × ฿{Number(session.package.priceChild).toLocaleString('th-TH')}
              </span>
              <span className="tabular-nums font-medium text-slate-900">
                ฿{(Number(session.package.priceChild) * session.children).toLocaleString('th-TH')}
              </span>
            </div>
          )}
          {session.seniors > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">
                ผู้สูงอายุ {session.seniors} คน × ฿{Number(session.package.priceSenior).toLocaleString('th-TH')}
              </span>
              <span className="tabular-nums font-medium text-slate-900">
                ฿{(Number(session.package.priceSenior) * session.seniors).toLocaleString('th-TH')}
              </span>
            </div>
          )}
          {totals.extraAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">รายการพิเศษ</span>
              <span className="tabular-nums font-medium text-red-600">
                +฿{totals.extraAmount.toLocaleString('th-TH')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Order items (compact) */}
      {allOrderItems.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            รายการที่สั่ง ({allOrderItems.length} รายการ)
          </h2>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {allOrderItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">
                  {item.menuItem.name}
                  {item.notes && <span className="ml-1 text-slate-400">({item.notes})</span>}
                </span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-500">×{item.quantity}</span>
                  {!item.menuItem.isBuffet && (
                    <span className="tabular-nums text-red-600">
                      +฿{(Number(item.menuItem.extraPrice) * item.quantity).toLocaleString('th-TH')}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs ${
                      item.status === 'served'
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.status === 'served' ? 'เสิร์ฟแล้ว' : item.status === 'ready' ? 'พร้อมแล้ว' : 'กำลังทำ'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Payment form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">ชำระเงิน</h2>

        {/* Method */}
        <div className="grid grid-cols-4 gap-2">
          {(['cash', 'qr_promptpay', 'transfer', 'card'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                method === m
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        {/* Discount + waste */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">ส่วนลด (฿)</label>
            <input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              ค่าของเสีย (฿)
            </label>
            <input
              type="number"
              min={0}
              value={wasteCharge}
              onChange={(e) => setWasteCharge(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500"
            />
          </div>
        </div>

        {/* Total */}
        <div className="rounded-lg bg-slate-50 px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm text-slate-600">
            <span>รวม</span>
            <span className="tabular-nums">฿{totals.subtotal.toLocaleString('th-TH')}</span>
          </div>
          {discountNum > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>ส่วนลด</span>
              <span className="tabular-nums">−฿{discountNum.toLocaleString('th-TH')}</span>
            </div>
          )}
          {wasteNum > 0 && (
            <div className="flex justify-between text-sm text-red-600">
              <span>ค่าของเสีย</span>
              <span className="tabular-nums">+฿{wasteNum.toLocaleString('th-TH')}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
            <span>ยอดชำระ</span>
            <span className="tabular-nums text-lg">฿{total.toLocaleString('th-TH')}</span>
          </div>
        </div>

        {/* Cash received + change */}
        {method === 'cash' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                รับเงิน (฿)
              </label>
              <input
                type="number"
                min={0}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={total.toString()}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                เงินทอน (฿)
              </label>
              <p
                className={`rounded-lg border px-3 py-2 text-sm tabular-nums font-semibold ${
                  change >= 0
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-red-200 bg-red-50 text-red-600'
                }`}
              >
                {change >= 0 ? `฿${change.toLocaleString('th-TH')}` : 'ไม่เพียงพอ'}
              </p>
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ไม่บังคับ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || (method === 'cash' && (!received || change < 0))}
          className="w-full rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'กำลังดำเนินการ…' : `ยืนยันการชำระเงิน ฿${total.toLocaleString('th-TH')}`}
        </button>
      </div>
    </div>
  );
}

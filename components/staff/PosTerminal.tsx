'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  getPosSessionsForPos,
  getPosSessionDetail,
  getActiveTilesForPos,
  processPayment,
} from '@/lib/actions/pos';
import type { PosSession, PosSessionDetail } from '@/lib/actions/pos';
import { Printer, CheckCircle2, Package, Tag } from 'lucide-react';
import { print as printReceipt } from '@/lib/printer/service';
import type { ReceiptData } from '@/lib/printer/types';
import type { PricingTile } from '@/lib/db/schema';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

interface PosTerminalProps {
  initialSessions: PosSession[];
  cashierName: string;
}

export function PosTerminal({ initialSessions, cashierName }: PosTerminalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: sessions = [] } = useQuery({
    queryKey: ['pos-sessions'],
    queryFn: () => getPosSessionsForPos().then((r) => (r.ok ? r.data : [])),
    initialData: initialSessions,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

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
              <p className="sticky top-0 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-700">รอเรียกเก็บเงิน</p>
              {closing.map((s) => (
                <SessionRow key={s.id} session={s} selected={selectedId === s.id} onClick={() => setSelectedId(s.id)} />
              ))}
            </div>
          )}
          {active.length > 0 && (
            <div>
              <p className="sticky top-0 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500">กำลังใช้งาน</p>
              {active.map((s) => (
                <SessionRow key={s.id} session={s} selected={selectedId === s.id} onClick={() => setSelectedId(s.id)} />
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
          <DetailPanel sessionId={selectedId} cashierName={cashierName} onPaid={handlePaid} />
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
  return session.guests.reduce((sum, g) => sum + Number(g.pricingTile.price) * g.quantity, 0);
}

function SessionRow({ session, selected, onClick }: { session: PosSession; selected: boolean; onClick: () => void }) {
  const total = baseTotal(session);
  const isClosing = session.status === 'closing';
  const totalGuests = session.guests.reduce((s, g) => s + g.quantity, 0);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-4 py-3 text-left transition-colors border-b border-slate-100 ${
        selected ? 'bg-slate-800 text-white' : isClosing ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-lg font-bold tabular-nums ${selected ? 'text-white' : 'text-slate-900'}`}>โต๊ะ {session.table.label}</span>
        {isClosing && !selected && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">รอบิล</span>}
      </div>
      <p className={`text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{totalGuests} คน</p>
      <div className={`mt-0.5 flex justify-between text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
        <span>฿{total.toLocaleString('th-TH')}</span>
        <span>{formatDistanceToNowStrict(new Date(session.startedAt), { locale: th, addSuffix: true })}</span>
      </div>
    </button>
  );
}

function DetailPanel({ sessionId, cashierName, onPaid }: { sessionId: string; cashierName: string; onPaid: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pos-detail', sessionId],
    queryFn: () => getPosSessionDetail(sessionId).then((r) => (r.ok ? r.data : null)),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: tileData } = useQuery({
    queryKey: ['pos-tiles'],
    queryFn: () => getActiveTilesForPos().then((r) => (r.ok ? r.data : { addons: [], discounts: [] })),
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-slate-400">กำลังโหลด…</p></div>;
  }

  return (
    <PaymentPanel
      detail={data}
      addonTiles={tileData?.addons ?? []}
      discountTiles={tileData?.discounts ?? []}
      cashierName={cashierName}
      onPaid={onPaid}
    />
  );
}

/* ─── Tile counter tile (compact, for POS) ─────────────────────────── */

function PosTile({
  tile,
  qty,
  onInc,
  onDec,
}: {
  tile: PricingTile;
  qty: number;
  onInc: () => void;
  onDec: () => void;
}) {
  const bg = tile.color ?? (tile.category === 'addon' ? '#f0fdf4' : '#fff7ed');
  const priceLabel =
    tile.category === 'discount'
      ? tile.discountType === 'percentage'
        ? `-${tile.discountValue}%`
        : `-฿${Number(tile.discountValue).toLocaleString('th-TH')}`
      : `+฿${Number(tile.price).toLocaleString('th-TH')}`;

  return (
    <div
      className={`relative flex flex-col items-center rounded-xl border-2 transition-all p-2 ${
        qty > 0 ? 'border-slate-800' : 'border-transparent'
      }`}
      style={{ width: 100, minHeight: 90, backgroundColor: bg }}
    >
      {qty > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">
          {qty}
        </span>
      )}
      {tile.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.imageUrl} alt={tile.name} className="h-8 w-8 object-contain rounded" />
      ) : (
        tile.category === 'addon'
          ? <Package className="size-7 text-green-500 opacity-70" />
          : <Tag className="size-7 text-red-400 opacity-70" />
      )}
      <p className="mt-0.5 text-center text-[11px] font-semibold text-slate-800 line-clamp-1 w-full">{tile.name}</p>
      <p className={`text-[11px] font-bold ${tile.category === 'discount' ? 'text-red-600' : 'text-green-700'}`}>{priceLabel}</p>
      <div className="flex items-center gap-1 mt-1">
        <button type="button" aria-label="ลด" onClick={onDec} disabled={qty === 0}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-30 shadow-sm">−</button>
        <span className="w-4 text-center tabular-nums text-xs font-bold">{qty}</span>
        <button type="button" aria-label="เพิ่ม" onClick={onInc}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white hover:bg-slate-700 shadow-sm">+</button>
      </div>
    </div>
  );
}

/* ─── Payment Panel ────────────────────────────────────────────────── */

function PaymentPanel({
  detail,
  addonTiles,
  discountTiles,
  cashierName,
  onPaid,
}: {
  detail: PosSessionDetail;
  addonTiles: PricingTile[];
  discountTiles: PricingTile[];
  cashierName: string;
  onPaid: () => void;
}) {
  const { session, orders, totals } = detail;

  const [method, setMethod] = useState<'cash' | 'qr_promptpay' | 'transfer' | 'card'>('cash');
  const [received, setReceived] = useState('');
  const [manualDiscount, setManualDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);

  // Addon/discount tile quantities
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [discountQty, setDiscountQty] = useState<Record<string, number>>({});

  const allOrderItems = orders.flatMap((o) => o.items).filter((i) => i.status !== 'cancelled');
  const manualDiscountNum = Math.max(0, Number(manualDiscount) || 0);

  // Compute addon total
  const addonTotal = addonTiles.reduce((sum, t) => sum + Number(t.price) * (addonQty[t.id] ?? 0), 0);

  // Compute discount-tile total (preview — final computation is server-side)
  const subtotalBeforeDiscount = totals.subtotal + addonTotal;
  const discountTileTotal = discountTiles.reduce((sum, t) => {
    const qty = discountQty[t.id] ?? 0;
    if (qty === 0) return sum;
    if (t.discountType === 'percentage') return sum + subtotalBeforeDiscount * Number(t.discountValue) / 100;
    return sum + Number(t.discountValue) * qty;
  }, 0);

  const total = Math.max(0, subtotalBeforeDiscount - manualDiscountNum - discountTileTotal);
  const receivedNum = Number(received) || 0;
  const change = method === 'cash' ? receivedNum - total : 0;

  // Build line items for submission
  function buildLineItems() {
    const items: Array<{ pricingTileId: string; quantity: number; amount: number }> = [];
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) items.push({ pricingTileId: t.id, quantity: qty, amount: Number(t.price) * qty });
    }
    for (const t of discountTiles) {
      const qty = discountQty[t.id] ?? 0;
      if (qty > 0) {
        let amount = 0;
        if (t.discountType === 'percentage') amount = -(subtotalBeforeDiscount * Number(t.discountValue) / 100);
        else amount = -(Number(t.discountValue) * qty);
        items.push({ pricingTileId: t.id, quantity: qty, amount });
      }
    }
    return items;
  }

  async function handleSubmit() {
    if (method === 'cash' && receivedNum < total) { toast.error('จำนวนเงินที่รับไม่เพียงพอ'); return; }
    setSubmitting(true);
    const result = await processPayment({
      sessionId: session.id,
      paymentMethod: method,
      receivedAmount: method === 'cash' ? receivedNum : total,
      discount: manualDiscountNum,
      notes: notes || undefined,
      lineItems: buildLineItems(),
    });
    setSubmitting(false);

    if (!result.ok) { toast.error(result.error); return; }

    // Build receipt
    const receiptItems: ReceiptData['items'] = [];
    for (const g of session.guests) {
      if (g.quantity > 0) receiptItems.push({ name: g.pricingTile.name, quantity: g.quantity, total: Number(g.pricingTile.price) * g.quantity });
    }
    for (const item of allOrderItems.filter((i) => !i.menuItem.isBuffet)) {
      receiptItems.push({ name: item.menuItem.name, quantity: item.quantity, total: Number(item.menuItem.extraPrice) * item.quantity });
    }
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }

    const receipt: ReceiptData = {
      shopName: 'ร้านชาบู',
      tableNumber: session.table.label,
      cashierName,
      paidAt: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }),
      items: receiptItems,
      subtotal: totals.subtotal + addonTotal,
      discount: manualDiscountNum + discountTileTotal,
      serviceCharge: 0,
      total: result.data.total,
      receivedAmount: method === 'cash' ? receivedNum : result.data.total,
      changeAmount: result.data.changeAmount,
      paymentMethod: METHOD_LABEL[method],
      sessionId: session.id,
    };

    setLastReceipt(receipt);
    setPaid(true);
    await printReceipt({ type: 'receipt', payment: receipt });
  }

  /* ── Success screen ── */
  if (paid && lastReceipt) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-6">
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto size-12 text-green-500" />
          <h2 className="text-xl font-bold text-green-800">ชำระเงินสำเร็จ</h2>
          <p className="text-3xl font-bold tabular-nums text-slate-900">฿{lastReceipt.total.toLocaleString('th-TH')}</p>
          {lastReceipt.changeAmount > 0 && <p className="text-base text-slate-600">เงินทอน ฿{lastReceipt.changeAmount.toLocaleString('th-TH')}</p>}
          <p className="text-sm text-slate-500">โต๊ะ {lastReceipt.tableNumber} · ชำระด้วย {lastReceipt.paymentMethod}</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => void printReceipt({ type: 'receipt', payment: lastReceipt })}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="size-4" />พิมพ์ใบเสร็จซ้ำ
          </button>
          <button type="button" onClick={onPaid} className="flex-1 rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700">เสร็จสิ้น</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-5">
      {/* Session header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold text-slate-900">โต๊ะ {session.table.label}</p>
            <p className="text-sm text-slate-500">{session.guests.reduce((s, g) => s + g.quantity, 0)} คน</p>
          </div>
          {session.status === 'closing' && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">รอเรียกเก็บเงิน</span>
          )}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
          {session.guests.map((g) =>
            g.quantity > 0 && (
              <div key={g.id} className="flex justify-between text-sm">
                <span className="text-slate-600">{g.pricingTile.name} {g.quantity} คน × ฿{Number(g.pricingTile.price).toLocaleString('th-TH')}</span>
                <span className="tabular-nums font-medium text-slate-900">฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}</span>
              </div>
            ),
          )}
          {totals.extraAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">รายการพิเศษ</span>
              <span className="tabular-nums font-medium text-red-600">+฿{totals.extraAmount.toLocaleString('th-TH')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Order items */}
      {allOrderItems.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">รายการที่สั่ง ({allOrderItems.length} รายการ)</h2>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {allOrderItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{item.menuItem.name}{item.notes && <span className="ml-1 text-slate-400">({item.notes})</span>}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-500">×{item.quantity}</span>
                  {!item.menuItem.isBuffet && <span className="tabular-nums text-red-600">+฿{(Number(item.menuItem.extraPrice) * item.quantity).toLocaleString('th-TH')}</span>}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${item.status === 'served' ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-700'}`}>
                    {item.status === 'served' ? 'เสิร์ฟแล้ว' : item.status === 'ready' ? 'พร้อมแล้ว' : 'กำลังทำ'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Addon tiles */}
      {addonTiles.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Package className="size-4 text-green-500" />รายการเพิ่มเติม
          </h2>
          <div className="flex flex-wrap gap-3">
            {addonTiles.map((t) => (
              <PosTile
                key={t.id}
                tile={t}
                qty={addonQty[t.id] ?? 0}
                onInc={() => setAddonQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                onDec={() => setAddonQty((p) => ({ ...p, [t.id]: Math.max(0, (p[t.id] ?? 0) - 1) }))}
              />
            ))}
          </div>
          {addonTotal > 0 && (
            <p className="mt-2 text-right text-xs font-medium text-green-700">+฿{addonTotal.toLocaleString('th-TH')}</p>
          )}
        </div>
      )}

      {/* Discount tiles */}
      {discountTiles.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Tag className="size-4 text-red-400" />ส่วนลด
          </h2>
          <div className="flex flex-wrap gap-3">
            {discountTiles.map((t) => (
              <PosTile
                key={t.id}
                tile={t}
                qty={discountQty[t.id] ?? 0}
                onInc={() => setDiscountQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                onDec={() => setDiscountQty((p) => ({ ...p, [t.id]: Math.max(0, (p[t.id] ?? 0) - 1) }))}
              />
            ))}
          </div>
          {discountTileTotal > 0 && (
            <p className="mt-2 text-right text-xs font-medium text-red-600">−฿{discountTileTotal.toLocaleString('th-TH')}</p>
          )}
        </div>
      )}

      {/* Payment form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">ชำระเงิน</h2>

        {/* Method */}
        <div className="grid grid-cols-4 gap-2">
          {(['cash', 'qr_promptpay', 'transfer', 'card'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)}
              className={`rounded-lg border py-2 text-xs font-medium transition-colors ${method === m ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        {/* Manual discount */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">ส่วนลดเพิ่มเติม (฿)</label>
          <input type="number" min={0} value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500" />
        </div>

        {/* Totals summary */}
        <div className="rounded-lg bg-slate-50 px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm text-slate-600"><span>ยอดอาหาร</span><span className="tabular-nums">฿{totals.subtotal.toLocaleString('th-TH')}</span></div>
          {addonTotal > 0 && <div className="flex justify-between text-sm text-green-600"><span>รายการเพิ่ม</span><span className="tabular-nums">+฿{addonTotal.toLocaleString('th-TH')}</span></div>}
          {discountTileTotal > 0 && <div className="flex justify-between text-sm text-red-500"><span>ส่วนลด (tile)</span><span className="tabular-nums">−฿{discountTileTotal.toLocaleString('th-TH')}</span></div>}
          {manualDiscountNum > 0 && <div className="flex justify-between text-sm text-red-500"><span>ส่วนลดเพิ่มเติม</span><span className="tabular-nums">−฿{manualDiscountNum.toLocaleString('th-TH')}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
            <span>ยอดชำระ</span>
            <span className="tabular-nums text-lg">฿{total.toLocaleString('th-TH')}</span>
          </div>
        </div>

        {/* Cash received */}
        {method === 'cash' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">รับเงิน (฿)</label>
              <input type="number" min={0} value={received} onChange={(e) => setReceived(e.target.value)} placeholder={total.toString()}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">เงินทอน (฿)</label>
              <p className={`rounded-lg border px-3 py-2 text-sm tabular-nums font-semibold ${change >= 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
                {change >= 0 ? `฿${change.toLocaleString('th-TH')}` : 'ไม่เพียงพอ'}
              </p>
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">หมายเหตุ</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ไม่บังคับ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
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

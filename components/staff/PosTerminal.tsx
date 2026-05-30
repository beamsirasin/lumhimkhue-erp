'use client';

import { useState, useEffect, memo, useMemo, useCallback } from 'react';
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
import { updateSessionGuests, closeSession } from '@/lib/actions/sessions';
import { getStoreSettings } from '@/lib/actions/store';
import type { StoreSettingsData } from '@/lib/actions/store';
import { resolveBillConfig } from '@/lib/utils/billConfig';
import type { PosSession, PosSessionDetail } from '@/lib/actions/pos';
import { Printer, CheckCircle2, Tag, Package, X, Loader2 } from 'lucide-react';
import { PricingTile as PricingTileCard } from '@/components/staff/PricingTile';
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
    initialDataUpdatedAt: Date.now(),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  useEffect(() => {
    if (selectedId && !sessions.find((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [sessions, selectedId]);

  const closing = useMemo(() => sessions.filter((s) => s.status === 'closing'), [sessions]);
  const active = useMemo(() => sessions.filter((s) => s.status === 'active'), [sessions]);

  const handlePaid = useCallback(() => {
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
  }, [queryClient]);

  const handleSelectSession = useCallback((id: string) => setSelectedId(id), []);

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    const order = (s: string) => s === 'closing' ? 0 : s === 'active' ? 1 : 2;
    if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  }), [sessions]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">POS / แคชเชียร์</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {closing.length > 0 && (
            <span className="text-red-600 font-medium">{closing.length} รอเรียกเก็บเงิน · </span>
          )}
          {active.length} โต๊ะที่ใช้งาน
        </p>
      </div>

      {/* Session grid */}
      {sortedSessions.length === 0 ? (
        <p className="py-24 text-center text-sm text-slate-400">ไม่มีโต๊ะที่ใช้งาน</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sortedSessions.map((s) => (
            <SessionCard key={s.id} session={s} selected={selectedId === s.id} onSelect={handleSelectSession} />
          ))}
        </div>
      )}

      {/* Modal */}
      {selectedId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => setSelectedId(null)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-600 hover:bg-white shadow"
            >
              <X className="size-4" />
            </button>
            <DetailPanel sessionId={selectedId} cashierName={cashierName} onPaid={handlePaid} />
          </div>
        </div>
      )}
    </div>
  );
}

function baseTotal(session: PosSession): number {
  return session.guests.reduce((sum, g) => sum + Number(g.pricingTile.price) * g.quantity, 0);
}

const SessionCard = memo(function SessionCard({ session, selected, onSelect }: { session: PosSession; selected: boolean; onSelect: (id: string) => void }) {
  const handleClick = useCallback(() => onSelect(session.id), [onSelect, session.id]);
  const total = baseTotal(session);
  const isClosing = session.status === 'closing';
  const isPaid = session.status === 'paid';
  const totalGuests = session.guests.reduce((s, g) => s + g.quantity, 0);

  let cardClass = 'rounded-xl border-2 p-3 text-left transition-colors w-full ';
  if (selected) {
    cardClass += 'border-slate-800 bg-slate-800 text-white';
  } else if (isClosing) {
    cardClass += 'border-red-300 bg-red-50 hover:bg-red-100';
  } else if (isPaid) {
    cardClass += 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100';
  } else {
    cardClass += 'border-slate-200 bg-white hover:bg-slate-50';
  }

  return (
    <button type="button" onClick={handleClick} className={cardClass}>
      <div className="flex items-start justify-between gap-1">
        <span className={`text-base font-bold tabular-nums leading-tight ${selected ? 'text-white' : 'text-slate-900'}`}>
          โต๊ะ {session.table.label}
        </span>
        {isClosing && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-red-400 text-white' : 'bg-red-100 text-red-700'}`}>
            รอบิล
          </span>
        )}
        {isPaid && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-emerald-400 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
            จ่ายแล้ว
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{totalGuests} คน</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${selected ? 'text-white' : isPaid ? 'text-emerald-700' : 'text-slate-800'}`}>
        ฿{total.toLocaleString('th-TH')}
      </p>
      <p className={`mt-0.5 text-[11px] ${selected ? 'text-slate-400' : 'text-slate-400'}`}>
        {formatDistanceToNowStrict(new Date(session.startedAt), { locale: th, addSuffix: true })}
      </p>
    </button>
  );
});

function DetailPanel({ sessionId, cashierName, onPaid }: { sessionId: string; cashierName: string; onPaid: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pos-detail', sessionId],
    queryFn: () => getPosSessionDetail(sessionId).then((r) => (r.ok ? r.data : null)),
    enabled: !!sessionId,
    refetchInterval: sessionId ? 10_000 : false,
    staleTime: 5_000,
  });

  const { data: tileData } = useQuery({
    queryKey: ['pos-tiles'],
    queryFn: () => getActiveTilesForPos().then((r) => (r.ok ? r.data : { guests: [], addons: [], discounts: [] })),
    staleTime: 60_000,
  });

  const { data: storeData } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => getStoreSettings().then((r) => (r.ok ? r.data : null)),
    staleTime: 300_000,
  });

  if (isLoading || !data) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-slate-400">กำลังโหลด…</p></div>;
  }

  return (
    <PaymentPanel
      detail={data}
      guestTiles={tileData?.guests ?? []}
      addonTiles={tileData?.addons ?? []}
      discountTiles={tileData?.discounts ?? []}
      cashierName={cashierName}
      storeSettings={storeData ?? null}
      isGroupBill={data.isGroupBill}
      linkedTableLabels={data.linkedTableLabels}
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
  guestTiles,
  addonTiles,
  discountTiles,
  cashierName,
  storeSettings,
  isGroupBill,
  linkedTableLabels,
  onPaid,
}: {
  detail: PosSessionDetail;
  guestTiles: PricingTile[];
  addonTiles: PricingTile[];
  discountTiles: PricingTile[];
  cashierName: string;
  storeSettings: StoreSettingsData | null;
  isGroupBill?: boolean;
  linkedTableLabels?: string[];
  onPaid: () => void;
}) {
  const { session, orders, totals } = detail;

  const [view, setView] = useState<'bill' | 'payment'>('bill');
  // keyed by pricingTile.id — initialized from existing session guests
  const [guestQty, setGuestQty] = useState<Record<string, number>>(
    Object.fromEntries(session.guests.map((g) => [g.pricingTile.id, g.quantity])),
  );
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [discountQty, setDiscountQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Payment-view state
  const [method, setMethod] = useState<'cash' | 'qr_promptpay' | 'transfer' | 'card'>('cash');
  const [bankAccount, setBankAccount] = useState<'main' | 'secondary'>('main');
  const [received, setReceived] = useState('');
  const [manualDiscount, setManualDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);

  // Tax invoice state
  const [taxInvoiceOpen, setTaxInvoiceOpen] = useState(false);
  const [taxInvoice, setTaxInvoice] = useState<{
    companyName: string; phone: string; taxId: string; address: string;
  } | null>(null);
  const [taxForm, setTaxForm] = useState({ companyName: '', phone: '', taxId: '', address: '' });
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);

  const baseTotal = guestTiles.reduce(
    (sum, t) => sum + Number(t.price) * (guestQty[t.id] ?? 0),
    0,
  );
  const addonTotal = addonTiles.reduce((sum, t) => sum + Number(t.price) * (addonQty[t.id] ?? 0), 0);
  const subtotalBeforeDiscount = baseTotal + addonTotal;
  const manualDiscountNum = Math.max(0, Number(manualDiscount) || 0);
  const discountTileTotal = discountTiles.reduce((sum, t) => {
    const qty = discountQty[t.id] ?? 0;
    if (qty === 0) return sum;
    if (t.discountType === 'percentage') return sum + subtotalBeforeDiscount * Number(t.discountValue) / 100;
    return sum + Number(t.discountValue) * qty;
  }, 0);
  const total = Math.max(0, subtotalBeforeDiscount - manualDiscountNum - discountTileTotal);
  const receivedNum = Number(received) || 0;
  const change = method === 'cash' ? receivedNum - total : 0;

  async function handleSave() {
    setSaving(true);
    const result = await updateSessionGuests({
      sessionId: session.id,
      guests: guestTiles.map((t) => ({
        pricingTileId: t.id,
        quantity: guestQty[t.id] ?? 0,
      })),
    });
    setSaving(false);
    if (!result.ok) toast.error(result.error);
    else toast.success('บันทึกแล้ว');
  }

  const now = () => new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

  function buildShopInfo(billType: 'preview' | 'main' | 'secondary') {
    if (!storeSettings) return { shopNameTh: 'ร้านชาบู' };
    const cfg = resolveBillConfig(storeSettings, billType);
    return {
      shopNameTh:  cfg.shopNameTh ?? 'ร้านชาบู',
      shopNameEn:  cfg.shopNameEn,
      companyName: cfg.companyName,
      shopAddress: cfg.address,
      phone:       cfg.phone,
      taxId:       cfg.taxId,
      branch:      cfg.branch,
      registerNo:  cfg.registerNo,
      footerNote:  cfg.footerNote,
      vatPercent:  cfg.vatPercent ?? 7,
    };
  }

  async function handlePrint() {
    const receiptItems: ReceiptData['items'] = [];
    for (const t of guestTiles) {
      const qty = guestQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    await printReceipt({
      type: 'receipt',
      payment: {
        receiptType: 'bill',
        ...buildShopInfo('preview'),
        tableNumber: session.table.label, cashierName,
        paidAt: now(),
        items: receiptItems, subtotal: subtotalBeforeDiscount, discount: 0, serviceCharge: 0,
        total: subtotalBeforeDiscount, receivedAmount: 0, changeAmount: 0,
        paymentMethod: '', sessionId: session.id,
      },
    });
  }

  function buildLineItems() {
    const items: Array<{ pricingTileId: string; quantity: number; amount: number }> = [];
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) items.push({ pricingTileId: t.id, quantity: qty, amount: Number(t.price) * qty });
    }
    for (const t of discountTiles) {
      const qty = discountQty[t.id] ?? 0;
      if (qty > 0) {
        const amount = t.discountType === 'percentage'
          ? -(subtotalBeforeDiscount * Number(t.discountValue) / 100)
          : -(Number(t.discountValue) * qty);
        items.push({ pricingTileId: t.id, quantity: qty, amount });
      }
    }
    return items;
  }

  async function handleSubmit() {
    if (method === 'cash' && receivedNum < total) { toast.error('จำนวนเงินที่รับไม่เพียงพอ'); return; }
    setSubmitting(true);
    const accountLabel = bankAccount === 'main' ? 'บัญชีหลัก' : 'บัญชีรอง';
    const fullNotes = [
      `[${accountLabel}]`,
      notes || '',
      taxInvoice ? `[ใบกำกับภาษี: ${taxInvoice.companyName} ${taxInvoice.taxId}]` : '',
    ].filter(Boolean).join(' ');

    const result = await processPayment({
      sessionId: session.id,
      paymentMethod: method,
      receivedAmount: method === 'cash' ? receivedNum : total,
      discount: manualDiscountNum,
      notes: fullNotes || undefined,
      lineItems: buildLineItems(),
    });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }

    const receiptItems: ReceiptData['items'] = [];
    for (const t of guestTiles) {
      const qty = guestQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    const receipt: ReceiptData = {
      receiptType: 'receipt',
      ...buildShopInfo(bankAccount === 'main' ? 'main' : 'secondary'),
      receiptNo: Date.now().toString().slice(-8),
      tableNumber: session.table.label, cashierName,
      paidAt: now(),
      items: receiptItems, subtotal: subtotalBeforeDiscount,
      discount: manualDiscountNum + discountTileTotal, serviceCharge: 0,
      total: result.data.total,
      receivedAmount: method === 'cash' ? receivedNum : result.data.total,
      changeAmount: result.data.changeAmount, paymentMethod: METHOD_LABEL[method], sessionId: session.id,
    };
    setLastReceipt(receipt);
    setPaid(true);
    await printReceipt({ type: 'receipt', payment: receipt });
  }

  /* ── Success ── */
  if (paid && lastReceipt) {
    async function handleForceClose() {
      setSubmitting(true);
      const res = await closeSession({ sessionId: session.id });
      setSubmitting(false);
      if (!res.ok) { toast.error(res.error); return; }
      onPaid();
    }

    return (
      <div className="p-6 space-y-6">
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto size-12 text-green-500" />
          <h2 className="text-xl font-bold text-green-800">ชำระเงินสำเร็จ</h2>
          <p className="text-3xl font-bold tabular-nums text-slate-900">฿{lastReceipt.total.toLocaleString('th-TH')}</p>
          {lastReceipt.changeAmount > 0 && <p className="text-base text-slate-600">เงินทอน ฿{lastReceipt.changeAmount.toLocaleString('th-TH')}</p>}
          <p className="text-sm text-slate-500">โต๊ะ {lastReceipt.tableNumber} · ชำระด้วย {lastReceipt.paymentMethod}</p>
          <p className="text-xs text-slate-400">โต๊ะยังแสดงสถานะ &quot;จ่ายแล้ว&quot; — ปิดโต๊ะได้ที่ จัดการโต๊ะ</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => void printReceipt({ type: 'receipt', payment: lastReceipt })}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="size-4" />พิมพ์ซ้ำ
          </button>
          <button type="button" onClick={handleForceClose} disabled={submitting}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300 py-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {submitting ? 'กำลังปิด…' : 'บังคับปิดโต๊ะ'}
          </button>
          <button type="button" onClick={onPaid} className="flex-1 rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700">เสร็จสิ้น</button>
        </div>
      </div>
    );
  }

  /* ── Tax invoice popup ── */
  const TaxInvoicePopup = taxInvoiceOpen ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">ข้อมูลใบกำกับภาษี</h3>
          <button type="button" aria-label="ปิด" onClick={() => setTaxInvoiceOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
        </div>
        {(['companyName', 'phone', 'taxId', 'address'] as const).map((field) => {
          const labels = { companyName: 'ชื่อบริษัท / นิติบุคคล', phone: 'เบอร์โทรศัพท์', taxId: 'เลขประจำตัวผู้เสียภาษี', address: 'ที่อยู่' };
          return (
            <div key={field}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{labels[field]}</label>
              {field === 'address' ? (
                <textarea rows={2} value={taxForm[field]} onChange={(e) => setTaxForm((p) => ({ ...p, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 resize-none" />
              ) : (
                <input type="text" value={taxForm[field]} onChange={(e) => setTaxForm((p) => ({ ...p, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
              )}
            </div>
          );
        })}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => { setTaxInvoice(null); setTaxInvoiceOpen(false); }}
            className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50">ไม่ออกใบกำกับ</button>
          <button type="button"
            onClick={() => {
              if (taxForm.companyName && taxForm.taxId) { setTaxInvoice({ ...taxForm }); }
              setTaxInvoiceOpen(false);
            }}
            className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-semibold text-white hover:bg-slate-700">บันทึก</button>
        </div>
      </div>
    </div>
  ) : null;

  /* ── Payment form view ── */
  if (view === 'payment') {
    return (
      <div className="p-6 space-y-4">
        {TaxInvoicePopup}

        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setView('bill')}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            ← กลับ
          </button>
          <h2 className="text-base font-semibold text-slate-900">ชำระเงิน — โต๊ะ {session.table.label}</h2>
          {isGroupBill && linkedTableLabels && (
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
              บิลกลุ่ม · โต๊ะ {[session.table.label, ...linkedTableLabels].join(', ')}
            </span>
          )}
        </div>

        {/* Bank account selector */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">เข้าบัญชี</p>
          <div className="flex gap-2">
            {(['main', 'secondary'] as const).map((acc) => (
              <button key={acc} type="button" onClick={() => setBankAccount(acc)}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                  bankAccount === acc ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                {acc === 'main' ? 'บัญชีหลัก' : 'บัญชีรอง'}
              </button>
            ))}
          </div>
        </div>

        {/* Method */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">ช่องทางชำระ</p>
          <div className="grid grid-cols-4 gap-2">
            {(['cash', 'qr_promptpay', 'transfer', 'card'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={`rounded-lg border py-2 text-xs font-medium transition-colors ${method === m ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Discount tiles */}
        {discountTiles.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Tag className="size-3.5 text-red-400" />ส่วนลด</p>
            <div className="flex flex-wrap gap-2">
              {discountTiles.map((t) => (
                <PosTile key={t.id} tile={t} qty={discountQty[t.id] ?? 0}
                  onInc={() => setDiscountQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                  onDec={() => setDiscountQty((p) => ({ ...p, [t.id]: Math.max(0, (p[t.id] ?? 0) - 1) }))} />
              ))}
            </div>
          </div>
        )}

        {/* Manual discount */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">ส่วนลดเพิ่มเติม (฿)</label>
          <input type="number" min={0} value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-500" />
        </div>

        {/* Totals */}
        <div className="rounded-lg bg-slate-50 px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm text-slate-600"><span>ยอดรวม</span><span className="tabular-nums">฿{subtotalBeforeDiscount.toLocaleString('th-TH')}</span></div>
          {discountTileTotal > 0 && <div className="flex justify-between text-sm text-red-500"><span>ส่วนลด</span><span className="tabular-nums">−฿{discountTileTotal.toLocaleString('th-TH')}</span></div>}
          {manualDiscountNum > 0 && <div className="flex justify-between text-sm text-red-500"><span>ส่วนลดเพิ่มเติม</span><span className="tabular-nums">−฿{manualDiscountNum.toLocaleString('th-TH')}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
            <span>ยอดชำระ</span><span className="tabular-nums text-lg">฿{total.toLocaleString('th-TH')}</span>
          </div>
        </div>

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

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">หมายเหตุ</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ไม่บังคับ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>

        {/* Tax invoice toggle */}
        <button type="button"
          onClick={() => { setTaxForm(taxInvoice ?? { companyName: '', phone: '', taxId: '', address: '' }); setTaxInvoiceOpen(true); }}
          className={`w-full rounded-lg border py-2.5 text-sm font-medium transition-colors ${
            taxInvoice ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}>
          {taxInvoice ? `📄 ใบกำกับภาษี: ${taxInvoice.companyName}` : '+ ออกใบกำกับภาษี'}
        </button>

        <button type="button" onClick={handleSubmit}
          disabled={submitting || (method === 'cash' && (!received || change < 0))}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? 'กำลังดำเนินการ…' : `ยืนยันการชำระเงิน ฿${total.toLocaleString('th-TH')}`}
        </button>
      </div>
    );
  }

  /* ── Bill view (default) — mirrors เปิดโต๊ะ pattern ── */
  const selectedGuests = guestTiles.filter((t) => (guestQty[t.id] ?? 0) > 0);
  const selectedAddons = addonTiles.filter((t) => (addonQty[t.id] ?? 0) > 0);
  const totalGuests = guestTiles.reduce((s, t) => s + (guestQty[t.id] ?? 0), 0);

  return (
    <div className="flex gap-5 p-6" style={{ minHeight: 420 }}>
      {/* Left: tile pickers */}
      <div className="flex-1 min-w-0 overflow-y-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-bold text-slate-900">โต๊ะ {session.table.label}</p>
            {isGroupBill && linkedTableLabels && (
              <p className="text-xs font-medium text-violet-600 mt-0.5">
                บิลกลุ่ม · รวมโต๊ะ {[session.table.label, ...linkedTableLabels].join(', ')}
              </p>
            )}
          </div>
          {session.status === 'closing' && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">รอเรียกเก็บเงิน</span>
          )}
        </div>

        {/* Guest tiles */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">จำนวนลูกค้า</p>
          <div className="flex flex-wrap gap-3">
            {guestTiles.map((t) => (
              <PricingTileCard
                key={t.id}
                tile={t}
                mode="tap"
                quantity={guestQty[t.id] ?? 0}
                onIncrement={() => setGuestQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
              />
            ))}
          </div>
        </div>

        {/* Addon tiles */}
        {addonTiles.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">รายการเพิ่มเติม</p>
            <div className="flex flex-wrap gap-3">
              {addonTiles.map((t) => (
                <PricingTileCard
                  key={t.id}
                  tile={t}
                  mode="tap"
                  quantity={addonQty[t.id] ?? 0}
                  onIncrement={() => setAddonQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: summary panel + action buttons */}
      <div className="w-48 shrink-0 flex flex-col gap-3">
        {/* Summary — mirrors TileSummaryPanel */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">รายการ</p>
          {selectedGuests.length === 0 && selectedAddons.length === 0 ? (
            <p className="flex-1 flex items-center justify-center text-center text-xs text-slate-400 leading-relaxed">
              แตะ tile<br />เพื่อเพิ่ม
            </p>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
              {selectedGuests.map((t) => {
                const qty = guestQty[t.id] ?? 0;
                return (
                  <div key={t.id} className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <div className="flex items-center gap-1">
                      <span className="flex-1 text-sm font-medium text-slate-800 truncate">{t.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" aria-label="ลด"
                          onClick={() => setGuestQty((p) => ({ ...p, [t.id]: Math.max(0, qty - 1) }))}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 hover:bg-red-100 hover:text-red-700">−</button>
                        <span className="w-5 text-center text-xs font-bold">{qty}</span>
                        <button type="button" aria-label="เพิ่ม"
                          onClick={() => setGuestQty((p) => ({ ...p, [t.id]: qty + 1 }))}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white hover:bg-slate-700">+</button>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[11px] text-slate-400">฿{Number(t.price).toLocaleString('th-TH')} / คน</span>
                      <span className="text-xs font-medium text-slate-600">฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                    </div>
                  </div>
                );
              })}
              {selectedAddons.map((t) => {
                const qty = addonQty[t.id] ?? 0;
                return (
                  <div key={t.id} className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <div className="flex items-center gap-1">
                      <span className="flex-1 text-sm font-medium text-slate-800 truncate">{t.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" aria-label="ลด"
                          onClick={() => setAddonQty((p) => ({ ...p, [t.id]: Math.max(0, qty - 1) }))}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 hover:bg-red-100 hover:text-red-700">−</button>
                        <span className="w-5 text-center text-xs font-bold">{qty}</span>
                        <button type="button" aria-label="เพิ่ม"
                          onClick={() => setAddonQty((p) => ({ ...p, [t.id]: qty + 1 }))}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white hover:bg-slate-700">+</button>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[11px] text-slate-400">+฿{Number(t.price).toLocaleString('th-TH')}</span>
                      <span className="text-xs font-medium text-green-600">฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(totalGuests > 0 || addonTotal > 0) && (
            <div className="mt-3 border-t border-slate-200 pt-3 space-y-1">
              {totalGuests > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">รวม</span>
                  <span className="font-bold text-slate-900">{totalGuests} คน</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">ยอดรวม</span>
                <span className="font-bold text-slate-900">฿{subtotalBeforeDiscount.toLocaleString('th-TH')}</span>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button type="button" onClick={handleSave} disabled={saving}
            className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <button type="button" onClick={handlePrint}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="size-3.5" />ปริ้นบิล
          </button>
          <button type="button" onClick={() => setView('payment')}
            className="w-full rounded-lg bg-slate-800 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            ชำระเงิน →
          </button>
        </div>
      </div>
    </div>
  );
}

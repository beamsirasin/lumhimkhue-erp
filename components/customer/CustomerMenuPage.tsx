'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { differenceInSeconds } from 'date-fns';
import { useCartStore, selectTotalItems, selectTotalExtra } from '@/lib/store/cart';
import { placeOrder, callStaff, requestBill } from '@/lib/actions/orders';
import type { SessionData, MenuCategoriesData } from '@/lib/actions/orders';

/* ─── Elapsed time display (counts up from session start) ─────────────────── */

function ElapsedTimer({ startedAt }: { startedAt: Date }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    function update() {
      const secs = differenceInSeconds(new Date(), new Date(startedAt));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) {
        setDisplay(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      } else {
        setDisplay(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    }
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="tabular-nums font-semibold text-slate-900 text-sm">{display}</span>;
}

/* ─── Main component ──────────────────────────────────────────────────────── */

interface CustomerMenuPageProps {
  sessionData: SessionData;
  categories: MenuCategoriesData;
  sessionToken: string;
}

export function CustomerMenuPage({
  sessionData,
  categories,
  sessionToken,
}: CustomerMenuPageProps) {
  const { table, session } = sessionData;
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const { items, initCart, setQuantity, clear } = useCartStore();
  const totalItems = useCartStore(selectTotalItems);
  const totalExtra = useCartStore(selectTotalExtra);

  useEffect(() => {
    initCart(sessionToken);
  }, [sessionToken, initCart]);

  const activeCategory = categories.find((c) => c.id === activeCategoryId);

  async function handleOrder() {
    const orderItems = Object.values(items).map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
    }));
    if (orderItems.length === 0) return;

    setSubmitting(true);
    const result = await placeOrder({ sessionToken, items: orderItems });
    setSubmitting(false);

    if (result.ok) {
      clear();
      toast.success('สั่งอาหารสำเร็จ');
    } else {
      toast.error(result.error);
    }
  }

  async function handleCallStaff() {
    const result = await callStaff(sessionToken);
    if (result.ok) toast.success('เรียกพนักงานแล้ว กรุณารอสักครู่');
    else toast.error(result.error);
  }

  async function handleRequestBill() {
    const result = await requestBill(sessionToken);
    if (result.ok) toast.success('แจ้งพนักงานรับบิลแล้ว กรุณารอสักครู่');
    else toast.error(result.error);
  }

  const isClosed = session.status === 'closing' || session.status === 'closed';

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">โต๊ะ {table.label}</p>
            <p className="text-sm font-medium text-slate-900">บุฟเฟ่ต์ไม่อั้น</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="text-xs text-slate-500">เวลาที่ใช้</p>
              <ElapsedTimer startedAt={session.startedAt} />
            </div>
            <a
              href={`/t/${table.qrToken}/s/${sessionToken}/orders`}
              className="text-xs font-medium text-slate-700 underline underline-offset-2"
            >
              รายการของฉัน
            </a>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex overflow-x-auto gap-1.5 px-4 pb-3 [scrollbar-width:none]">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategoryId(cat.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategoryId === cat.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* Closed notice */}
      {isClosed && (
        <div className="mx-4 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm text-amber-800 font-medium">
            {session.status === 'closing'
              ? 'แจ้งเรียกเก็บเงินแล้ว กรุณารอพนักงาน'
              : 'session นี้ปิดแล้ว'}
          </p>
        </div>
      )}

      {/* Menu items */}
      <main className="p-4">
        {activeCategory && activeCategory.menuItems.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">ไม่มีเมนูในหมวดนี้</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {activeCategory?.menuItems.map((mi) => {
            const qty = items[mi.id]?.quantity ?? 0;
            const cartItem = {
              menuItemId: mi.id,
              name: mi.name,
              extraPrice: Number(mi.extraPrice),
              isBuffet: mi.isBuffet,
              maxPerOrder: mi.maxPerOrder,
            };
            const atMax = mi.maxPerOrder !== null && qty >= mi.maxPerOrder;

            return (
              <div
                key={mi.id}
                className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                {mi.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mi.imageUrl}
                    alt={mi.name}
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  <div className="h-24 w-full bg-slate-100" />
                )}
                <div className="flex flex-1 flex-col p-2">
                  <p className="text-xs font-medium leading-tight text-slate-900">{mi.name}</p>
                  {!mi.isBuffet && (
                    <p className="mt-0.5 text-xs font-medium text-red-600">
                      +฿{Number(mi.extraPrice).toLocaleString('th-TH')}
                    </p>
                  )}
                  <div className="mt-auto pt-2">
                    {qty === 0 ? (
                      <button
                        type="button"
                        disabled={isClosed}
                        onClick={() => setQuantity(cartItem, 1)}
                        className="w-full rounded-md bg-slate-800 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                      >
                        เพิ่ม
                      </button>
                    ) : (
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          aria-label="ลดจำนวน"
                          onClick={() => setQuantity(cartItem, qty - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300"
                        >
                          −
                        </button>
                        <span className="tabular-nums text-sm font-semibold">{qty}</span>
                        <button
                          type="button"
                          aria-label="เพิ่มจำนวน"
                          disabled={atMax}
                          onClick={() => setQuantity(cartItem, qty + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Action buttons */}
      <div className="fixed bottom-20 right-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleCallStaff}
          disabled={isClosed}
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow hover:bg-slate-50 disabled:opacity-40"
        >
          เรียกพนักงาน
        </button>
        <button
          type="button"
          onClick={handleRequestBill}
          disabled={isClosed}
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow hover:bg-slate-50 disabled:opacity-40"
        >
          เรียกเก็บเงิน
        </button>
      </div>

      {/* Cart bar */}
      {totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
          <div className="text-sm text-slate-600">
            <span className="tabular-nums font-semibold">{totalItems}</span> รายการ
            {totalExtra > 0 && (
              <span className="ml-2 font-medium text-red-600">
                +฿{totalExtra.toLocaleString('th-TH')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleOrder}
            disabled={submitting || isClosed}
            className="rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'กำลังสั่ง…' : 'สั่งอาหาร'}
          </button>
        </div>
      )}
    </div>
  );
}

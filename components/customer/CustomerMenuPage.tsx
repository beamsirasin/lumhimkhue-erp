'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInSeconds } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useCartStore, selectTotalItems, selectTotalExtra } from '@/lib/store/cart';
import { placeOrder, hasUnservedItems } from '@/lib/actions/orders';
import type { SessionData, MenuCategoriesData } from '@/lib/actions/orders';

/* ─── Translations ───────────────────────────────────────────────────────────── */

const T = {
  th: {
    table: 'โต๊ะ',
    timeLabel: 'เวลาที่ใช้',
    myOrders: 'รายการของฉัน',
    add: 'เพิ่ม',
    full: 'ครบแล้ว',
    noItems: 'ไม่มีเมนูในหมวดนี้',
    cartItems: 'รายการ',
    ordering: 'กำลังสั่ง…',
    order: 'สั่งอาหาร',
    orderSuccess: 'สั่งอาหารสำเร็จ',
    closingNotice: 'แจ้งเรียกเก็บเงินแล้ว กรุณารอพนักงาน',
    closedNotice: 'เซสชันนี้ปิดแล้ว',
    waitingNotice: 'กรุณารอครัวเสิร์ฟออเดอร์รอบก่อนก่อน จึงจะสั่งรอบใหม่ได้',
    waitingBtn: 'รอครัวเสิร์ฟก่อน',
    buffet: 'บุฟเฟ่ต์',
    extra: 'พิเศษ',
    decreaseQty: 'ลดจำนวน',
    increaseQty: 'เพิ่มจำนวน',
  },
  en: {
    table: 'Table',
    timeLabel: 'Time used',
    myOrders: 'My Orders',
    add: 'Add',
    full: 'Limit reached',
    noItems: 'No items in this category',
    cartItems: 'items',
    ordering: 'Ordering…',
    order: 'Order',
    orderSuccess: 'Order placed successfully',
    closingNotice: 'Bill requested. Please wait for staff.',
    closedNotice: 'This session is closed.',
    waitingNotice: 'Please wait for the kitchen to serve your current order before ordering again.',
    waitingBtn: 'Waiting for kitchen…',
    buffet: 'Buffet',
    extra: 'Special',
    decreaseQty: 'Decrease quantity',
    increaseQty: 'Increase quantity',
  },
} as const;

const STATION_EN: Record<string, string> = {
  meat: 'Meat',
  seafood: 'Seafood',
  vegetable: 'Vegetables',
  noodle: 'Noodles',
  dessert: 'Desserts',
  drink: 'Drinks',
  sauce: 'Sauces',
};

type Lang = keyof typeof T;

/* ─── Elapsed time display ───────────────────────────────────────────────────── */

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

/* ─── TH / EN pill switch ────────────────────────────────────────────────────── */

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-slate-300 text-xs font-medium">
      {(['th', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`px-2.5 py-1 transition-colors ${
            lang === l
              ? 'bg-slate-800 text-white'
              : 'bg-white text-slate-500 hover:bg-slate-100'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────────── */

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
  const [lang, setLang] = useState<Lang>('th');
  const t = T[lang];

  const { items, initCart, setQuantity, clear } = useCartStore();
  const totalItems = useCartStore(selectTotalItems);
  const totalExtra = useCartStore(selectTotalExtra);

  const { data: unservedData } = useQuery({
    queryKey: ['unserved', sessionToken],
    queryFn: () => hasUnservedItems(sessionToken).then((r) => (r.ok ? r.data : { hasUnserved: false })),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const hasUnserved = unservedData?.hasUnserved ?? false;

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
      toast.success(t.orderSuccess);
    } else {
      toast.error(result.error);
    }
  }

  const isClosed = session.status === 'closing' || session.status === 'closed';

  return (
    <div className="min-h-screen bg-slate-50 pt-[88px] pb-28">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-10 bg-white border-b border-slate-200">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          {/* Logo + table */}
          <div className="flex items-center gap-2 min-w-0">
            <Image
              src="/images/logo.png"
              alt="Logo"
              width={36}
              height={36}
              className="rounded-md object-contain shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 leading-none">{t.table}</p>
              <p className="text-sm font-semibold text-slate-800 leading-tight">{table.label}</p>
            </div>
          </div>

          {/* Right: timer + my orders + lang switch */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="text-[10px] text-slate-400 leading-none">{t.timeLabel}</p>
              <ElapsedTimer startedAt={session.startedAt} />
            </div>
            <a
              href={`/t/${table.qrToken}/s/${sessionToken}/orders`}
              className="text-xs font-medium text-slate-700 underline underline-offset-2 whitespace-nowrap"
            >
              {t.myOrders}
            </a>
            <LangSwitch lang={lang} onChange={setLang} />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex overflow-x-auto gap-1.5 px-4 pb-3 [scrollbar-width:none]">
          {categories.map((cat) => {
            const catLimit = cat.maxPerSession ?? null;
            const cartQtyForCat = Object.values(items)
              .filter((ci) => ci.categoryId === cat.id)
              .reduce((s, ci) => s + ci.quantity, 0);
            const isAtMax = catLimit !== null && cartQtyForCat >= catLimit;
            const catName = lang === 'en' ? (STATION_EN[cat.station] ?? cat.name) : cat.name;
            return (
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
                {catName}
                {catLimit !== null && (
                  <span className={`ml-1 text-[10px] ${isAtMax ? 'text-red-400' : 'opacity-60'}`}>
                    {cartQtyForCat}/{catLimit}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Closed notice */}
      {isClosed && (
        <div className="mx-4 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm text-amber-800 font-medium">
            {session.status === 'closing' ? t.closingNotice : t.closedNotice}
          </p>
        </div>
      )}

      {/* Waiting for kitchen notice */}
      {!isClosed && hasUnserved && (
        <div className="mx-4 mt-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <p className="text-sm text-blue-800 font-medium">{t.waitingNotice}</p>
        </div>
      )}

      {/* Menu grid */}
      <main className="p-4">
        {activeCategory && activeCategory.menuItems.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">{t.noItems}</p>
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
              categoryId: activeCategory.id,
            };
            const atMax = mi.maxPerOrder !== null && qty >= mi.maxPerOrder;
            const catLimit = activeCategory.maxPerSession ?? null;
            const cartQtyForCat = Object.values(items)
              .filter((ci) => ci.categoryId === activeCategory.id)
              .reduce((s, ci) => s + ci.quantity, 0);
            const atCatMax = catLimit !== null && cartQtyForCat >= catLimit;

            const displayName = lang === 'en' && mi.nameEn ? mi.nameEn : mi.name;
            const miEx = mi as typeof mi & { descriptionEn?: string | null };
            const description = lang === 'en' && miEx.descriptionEn
              ? miEx.descriptionEn
              : mi.description ?? null;

            return (
              <div
                key={mi.id}
                className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                {/* Image */}
                {mi.hasImage ? (
                  <div className="relative aspect-square w-full">
                    <Image
                      src={`/api/img/${mi.id}`}
                      alt={displayName}
                      fill
                      sizes="(max-width: 640px) 50vw, 33vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="aspect-square w-full bg-slate-100" />
                )}

                {/* Info */}
                <div className="flex flex-1 flex-col p-2 gap-1">
                  {/* Name + type badge */}
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold leading-tight text-slate-900 flex-1">
                      {displayName}
                    </p>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                      mi.isBuffet
                        ? 'bg-green-100 text-green-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {mi.isBuffet ? t.buffet : t.extra}
                    </span>
                  </div>

                  {/* Description */}
                  {description && (
                    <p className="text-[11px] leading-snug text-slate-400 line-clamp-2">
                      {description}
                    </p>
                  )}

                  {/* Extra price */}
                  {!mi.isBuffet && (
                    <p className="text-xs font-semibold text-red-600">
                      +฿{Number(mi.extraPrice).toLocaleString('th-TH')}
                    </p>
                  )}

                  {/* Action */}
                  <div className="mt-auto pt-1">
                    {qty === 0 ? (
                      <button
                        type="button"
                        disabled={isClosed || atCatMax}
                        onClick={() => setQuantity(cartItem, 1)}
                        className="w-full rounded-md bg-slate-800 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                      >
                        {atCatMax ? t.full : t.add}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          aria-label={t.decreaseQty}
                          onClick={() => setQuantity(cartItem, qty - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300"
                        >
                          −
                        </button>
                        <span className="tabular-nums text-sm font-semibold">{qty}</span>
                        <button
                          type="button"
                          aria-label={t.increaseQty}
                          disabled={atMax || atCatMax}
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

      {/* Cart bar */}
      {totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
          <div className="text-sm text-slate-600">
            <span className="tabular-nums font-semibold">{totalItems}</span>{' '}
            {t.cartItems}
            {totalExtra > 0 && (
              <span className="ml-2 font-semibold text-red-600">
                +฿{totalExtra.toLocaleString('th-TH')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleOrder}
            disabled={submitting || isClosed || hasUnserved}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {submitting ? t.ordering : hasUnserved ? t.waitingBtn : t.order}
          </button>
        </div>
      )}
    </div>
  );
}

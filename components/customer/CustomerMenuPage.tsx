'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Loader2, Minus, Plus, ReceiptText, ShoppingCart, Utensils } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInSeconds } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCartStore, selectTotalItems, selectTotalExtra } from '@/lib/store/cart';
import { placeOrder, hasUnservedItems } from '@/lib/actions/orders';
import type { SessionData, MenuCategoriesData } from '@/lib/actions/orders';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
    cartTitle: 'ตะกร้าของคุณ',
    extraTotal: 'รวมเมนูพิเศษ',
    reviewOrder: 'ตรวจรายการ',
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
    cartTitle: 'Your cart',
    extraTotal: 'Special items total',
    reviewOrder: 'Review order',
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

  return <span className="tabular-nums font-semibold text-foreground text-sm">{display}</span>;
}

/* ─── TH / EN pill switch ────────────────────────────────────────────────────── */

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-border text-xs font-medium">
      {(['th', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`px-2.5 py-1 transition-colors ${
            lang === l
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:bg-muted/50'
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
  const [cartOpen, setCartOpen] = useState(false);
  const t = T[lang];

  const queryClient = useQueryClient();
  const { items, initCart, setQuantity, clear } = useCartStore();
  const totalItems = useCartStore(selectTotalItems);
  const totalExtra = useCartStore(selectTotalExtra);

  const UNSERVED_KEY = ['unserved', sessionToken];
  const { data: unservedData } = useQuery({
    queryKey: UNSERVED_KEY,
    queryFn: () => hasUnservedItems(sessionToken).then((r) => (r.ok ? r.data : { hasUnserved: false })),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const hasUnserved = unservedData?.hasUnserved ?? false;

  useEffect(() => {
    initCart(sessionToken);
  }, [sessionToken, initCart]);

  const activeCategory = categories.find((c) => c.id === activeCategoryId);
  const cartEntries = Object.values(items);

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
      // Instantly block re-ordering — no waiting for the next poll cycle
      queryClient.setQueryData(UNSERVED_KEY, { hasUnserved: true });
      toast.success(t.orderSuccess);
    } else {
      toast.error(result.error);
    }
  }

  const isClosed = session.status === 'closing' || session.status === 'closed';

  return (
    <div className="min-h-screen bg-muted/30 pt-[96px] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-10 border-b border-border bg-card/95 shadow-[var(--shadow-subtle)] backdrop-blur">
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
              <p className="text-[10px] text-muted-foreground leading-none">{t.table}</p>
              <p className="text-sm font-semibold text-foreground leading-tight">{table.label}</p>
            </div>
          </div>

          {/* Right: timer + my orders + lang switch */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground leading-none">{t.timeLabel}</p>
              <ElapsedTimer startedAt={session.startedAt} />
            </div>
            <a
              href={`/t/${table.qrToken}/s/${sessionToken}/orders`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-[var(--shadow-card)] whitespace-nowrap"
            >
              <ReceiptText className="size-3.5" />
              {t.myOrders}
            </a>
            <LangSwitch lang={lang} onChange={setLang} />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex overflow-x-auto gap-2 px-4 pb-3 [scrollbar-width:none]">
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
                className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-[var(--shadow-subtle)] transition-colors ${
                  activeCategoryId === cat.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Utensils className="size-3.5" />
                {catName}
                {catLimit !== null && (
                  <span className={`ml-1 text-[10px] ${isAtMax ? 'text-[var(--status-danger-fg)]' : 'opacity-60'}`}>
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
        <div className="mx-4 mt-4 rounded-lg bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] px-4 py-3">
          <p className="text-sm text-[var(--status-warning-fg)] font-medium">
            {session.status === 'closing' ? t.closingNotice : t.closedNotice}
          </p>
        </div>
      )}

      {/* Waiting for kitchen notice */}
      {!isClosed && hasUnserved && (
        <div className="mx-4 mt-4 rounded-lg bg-[var(--status-info-bg)] border border-[var(--status-info-border)] px-4 py-3">
          <p className="text-sm text-[var(--status-info-fg)] font-medium">{t.waitingNotice}</p>
        </div>
      )}

      {/* Menu grid */}
      <main className="p-4">
        {activeCategory && activeCategory.menuItems.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">{t.noItems}</p>
        )}
        <div className="grid grid-cols-2 gap-3.5">
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
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]"
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
                  <div className="flex aspect-square w-full items-center justify-center bg-muted/50 text-muted-foreground">
                    <Utensils className="size-8 opacity-45" />
                  </div>
                )}

                {/* Info */}
                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  {/* Name + type badge */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold leading-tight text-foreground">
                      {displayName}
                    </p>
                    <div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${
                        mi.isBuffet
                          ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                          : 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                      }`}>
                        {mi.isBuffet ? t.buffet : t.extra}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  {description && (
                    <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
                      {description}
                    </p>
                  )}

                  {/* Extra price */}
                  {!mi.isBuffet && (
                    <p className="text-xs font-semibold text-[var(--status-danger-fg)]">
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
                        className="min-h-10 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-subtle)] hover:bg-primary/90 disabled:opacity-40"
                      >
                        {atCatMax ? t.full : t.add}
                      </button>
                    ) : (
                      <div className="flex min-h-10 items-center justify-between rounded-lg border border-border bg-background px-1.5">
                        <button
                          type="button"
                          aria-label={t.decreaseQty}
                          onClick={() => setQuantity(cartItem, qty - 1)}
                          className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/80"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="tabular-nums text-sm font-semibold">{qty}</span>
                        <button
                          type="button"
                          aria-label={t.increaseQty}
                          disabled={atMax || atCatMax}
                          onClick={() => setQuantity(cartItem, qty + 1)}
                          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                        >
                          <Plus className="size-4" />
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

      {/* Floating cart + drawer */}
      {totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 px-4">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mx-auto flex min-h-14 w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-popover px-4 py-3 text-popover-foreground shadow-[var(--shadow-dialog)]"
          >
            <span className="flex items-center gap-3 text-left">
              <span className="relative flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ShoppingCart className="size-5" />
                <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {totalItems}
                </span>
              </span>
              <span>
                <span className="block text-sm font-semibold">{t.reviewOrder}</span>
                <span className="block text-xs text-muted-foreground">
                  {totalItems} {t.cartItems}
                  {totalExtra > 0 && (
                    <span className="ml-2 font-semibold text-[var(--status-danger-fg)]">
                      +฿{totalExtra.toLocaleString('th-TH')}
                    </span>
                  )}
                </span>
              </span>
            </span>
            <span className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              {t.order}
            </span>
          </button>
        </div>
      )}

      <Sheet open={cartOpen && totalItems > 0} onOpenChange={setCartOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[84vh] gap-0 rounded-t-2xl border-border p-0 shadow-[var(--shadow-dialog)]"
        >
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="flex items-center gap-2 pr-8">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ShoppingCart className="size-4" />
              </span>
              <span>{t.cartTitle}</span>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {totalItems} {t.cartItems}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="overflow-y-auto px-4 py-3">
            <div className="space-y-2.5">
              {cartEntries.map((item) => {
                const cartCategory = categories.find((cat) => cat.id === item.categoryId);
                const catLimit = cartCategory?.maxPerSession ?? null;
                const cartQtyForCat = Object.values(items)
                  .filter((ci) => ci.categoryId === item.categoryId)
                  .reduce((s, ci) => s + ci.quantity, 0);
                const atMax = item.maxPerOrder !== null && item.quantity >= item.maxPerOrder;
                const atCatMax = catLimit !== null && cartQtyForCat >= catLimit;
                const lineExtra = item.isBuffet ? 0 : item.extraPrice * item.quantity;

                return (
                  <div
                    key={item.menuItemId}
                    className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-subtle)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight text-foreground">{item.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            item.isBuffet
                              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                              : 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                          }`}>
                            {item.isBuffet ? t.buffet : t.extra}
                          </span>
                          {lineExtra > 0 && (
                            <span className="text-xs font-semibold text-[var(--status-danger-fg)]">
                              +฿{lineExtra.toLocaleString('th-TH')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex min-h-10 shrink-0 items-center gap-3 rounded-full border border-border bg-background px-1.5">
                        <button
                          type="button"
                          aria-label={t.decreaseQty}
                          onClick={() => {
                            if (totalItems <= 1) setCartOpen(false);
                            setQuantity(item, item.quantity - 1);
                          }}
                          className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/80"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="min-w-5 text-center text-sm font-semibold tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={t.increaseQty}
                          disabled={atMax || atCatMax}
                          onClick={() => setQuantity(item, item.quantity + 1)}
                          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border bg-popover px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            <div className="mb-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t.extraTotal}</span>
              <span className="font-semibold text-foreground">
                ฿{totalExtra.toLocaleString('th-TH')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCartOpen(false);
                void handleOrder();
              }}
              disabled={submitting || isClosed || hasUnserved}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground shadow-[var(--shadow-subtle)] hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? t.ordering : hasUnserved ? t.waitingBtn : t.order}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

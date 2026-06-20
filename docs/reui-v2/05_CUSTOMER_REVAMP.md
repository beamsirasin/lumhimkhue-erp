# Phase 12.7 — Customer QR & Login Revamp Plan

> Customer zone: no auth, no payment logic, safe for full redesign.
> Only preserve: server action calls, polling intervals, cart store usage.

---

## Customer Zone Overview

Routes under `(customer)/` are public (no authentication required). They are accessed via QR code scanned at the restaurant table or queue number card.

**Existing components:**
- `components/customer/CustomerMenuPage.tsx` — main ordering interface
- `components/customer/OrderList.tsx` — order status tracking
- `components/customer/QueueStatus.tsx` — queue position display

---

## `/t/[tableToken]` — Table Entry Point

**File:** `app/(customer)/t/[tableToken]/page.tsx`

Currently: basic redirect page after table token validation.

V2 direction:
- Brand landing screen with restaurant logo, table number in large type
- "เข้าสู่เมนู" / "เริ่มสั่งอาหาร" CTA button
- Subtle animation on load (fade in logo → slide up button)

---

## `/t/[tableToken]/s/[sessionToken]` — Customer Ordering Interface

**Component:** `components/customer/CustomerMenuPage.tsx`

This is the flagship customer UX page. Full redesign.

### New Layout Structure

```
┌─────────────────────────────────────────┐
│  Brand Header                            │  56px sticky
│  [Logo] ลำฮิมคือ | โต๊ะ 5 | ⏱ 0:42     │
│                                          │
├─────────────────────────────────────────┤
│  Category Tabs (horizontal scroll)       │  48px sticky
│  [🥩 เนื้อ] [🦐 ทะเล] [🥬 ผัก] [🍜 เส้น] │
├─────────────────────────────────────────┤
│  Menu Grid (2-col)                       │  scrollable
│  ┌──────┐  ┌──────┐                     │
│  │ img  │  │ img  │                     │
│  │ ชื่อ │  │ ชื่อ │                     │
│  │ ฿xxx │  │ ฿xxx │                     │
│  │ [+] │  │ [+] │                     │
│  └──────┘  └──────┘                     │
├─────────────────────────────────────────┤
│  Cart Chip (floating, fixed bottom)      │  56px
│  🛒 3 รายการ  |  ฿420  [สั่งอาหาร →]    │
└─────────────────────────────────────────┘
```

### Cart Interaction

Cart chip at bottom → taps open a Sheet from bottom:
```
Cart Sheet:
  title: รายการที่เลือก
  list: each item with qty ±, remove ×
  total row
  [สั่งอาหาร] button (calls placeOrder())
```

### Category Icons

Use emoji or simple lucide icons per station:
- meat: 🥩 (or `Beef` icon if available)
- seafood: 🦐
- vegetable: 🥬
- noodle: 🍜
- drink: 🥤
- dessert: 🍨
- sauce: 🫙

### Menu Card

```tsx
<div className="rounded-xl overflow-hidden bg-white shadow-sm">
  <div className="relative aspect-square">
    <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
    {item.extraPrice > 0 && (
      <span className="absolute top-2 right-2 bg-primary text-white text-xs px-2 py-0.5 rounded-full">
        +฿{item.extraPrice}
      </span>
    )}
  </div>
  <div className="p-2">
    <p className="text-sm font-medium line-clamp-2">{item.name}</p>
    <div className="flex items-center justify-between mt-1">
      <span className="text-xs text-muted-foreground">{item.nameEn}</span>
      <AddButton item={item} />
    </div>
  </div>
</div>
```

### States to Handle

| State | UI |
|---|---|
| Session active | Normal ordering UI |
| Session closing | Banner: "แจ้งเรียกเก็บเงินแล้ว กรุณารอพนักงาน" |
| Session closed/paid | Banner: "เซสชันนี้ปิดแล้ว" |
| Waiting for kitchen | Warning banner above cart chip |
| Item at max limit | Add button disabled with "ครบแล้ว" label |

---

## `/t/[tableToken]/s/[sessionToken]/orders` — Order Tracking

**Component:** `components/customer/OrderList.tsx`

V2 direction:
- Header: back arrow → return to menu
- Each order as a timeline card:
  ```
  ┌────────────────────────────────────┐
  │  [station icon]  ส่งเมื่อ 12:30   │
  │  ───────────────────────────────   │
  │  ✅ เนื้อวัวหมักซีอิ้ว × 2        │
  │  ⏳ ปลาหมึกย่าง × 1 (กำลังทำ)    │
  └────────────────────────────────────┘
  ```
- Status chips: pending (neutral) / preparing (info) / ready (success) / served (muted)
- Auto-refresh every 10s (existing poll interval — keep as-is)

---

## `/q/[queueToken]` — Queue Status

**Component:** `components/customer/QueueStatus.tsx`

V2 direction:
- Full-screen "waiting room" card design
- Large queue number (very large — 80px+)
- Status: รอ / ถูกเรียก / เข้านั่งแล้ว
- Estimated position indicator
- Auto-refresh every 10s (existing — keep as-is)

```
┌──────────────────────────────────────┐
│        ลำฮิมคือ ชาบูบุฟเฟ่ต์         │
│                                       │
│         หมายเลขคิวของคุณ             │
│                                       │
│              ✦ 042 ✦                 │
│                                       │
│         คุณอยู่ในคิวที่ 3             │
│                                       │
│  สถานะ: [รอเรียก]                    │
│                                       │
│  กรุณารอเจ้าหน้าที่เรียก            │
└──────────────────────────────────────┘
```

---

## Login Page (`/login`)

**Component:** `components/auth/LoginForm.tsx`

V2 direction:
- Full-height centered layout (not just a form, but a branded screen)
- Left side (desktop): brand area with logo + restaurant name
- Right side (desktop): login form card
- Mobile: single centered card with logo above

```
Desktop layout:
┌──────────────────┬─────────────────────┐
│                  │   [Logo]             │
│   Brand          │   เข้าสู่ระบบ        │
│   Background     │   ─────────────      │
│   (navy)         │   อีเมล [______]     │
│                  │   รหัสผ่าน [_____]   │
│   ลำฮิมคือ       │                      │
│   ชาบูบุฟเฟต์    │   [เข้าสู่ระบบ]     │
│                  │                      │
└──────────────────┴─────────────────────┘
```

**Do NOT change:**
- `signIn()` call and its options
- Error display logic
- The `callbackUrl` redirect behavior

---

## Polling Intervals (Preserve Exactly)

| Page | Interval | What |
|---|---|---|
| CustomerMenuPage | 5s | `['unserved', token]` — unserved items check |
| OrderList | 10s | `['session-orders', token]` — order status |
| QueueStatus | 10s | `['queue-status', token]` — queue position |

---

## Cart Store (Preserve Exactly)

Cart state is managed by Zustand in `lib/store/cart.ts`. The `CustomerMenuPage` uses:
- `useCartStore()`
- `selectTotalItems`
- `selectTotalExtra`

Do not change the cart store during V2. The add/remove/clear actions stay identical.

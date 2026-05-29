# Performance Audit Report — Phase 14

> วันที่: 2026-05-30 | สถานะ: Quick Wins ทำแล้ว รอ user approve ก่อน fix ต่อ

---

## Quick Wins ที่ทำไปแล้ว ✅

| # | สิ่งที่ทำ | ไฟล์ | ผลที่คาดหวัง |
|---|-----------|------|-------------|
| QW1 | เพิ่ม `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false` | `components/shared/QueryProvider.tsx` | ลด network requests ที่ไม่จำเป็นเมื่อ switch tab / reconnect |
| QW2 | เพิ่ม `isPending` + `variables` tracking บนปุ่ม toggle/delete ทุกจุด | `MenuPage.tsx`, `StaffPage.tsx`, `PricingTilesPage.tsx` | ผู้ใช้เห็น feedback ทันทีว่า "กำลังประมวลผล", ป้องกัน double-click |
| QW3 | Neon `-pooler` URL — ใช้อยู่แล้ว | `.env.local` | ✅ ไม่ต้องแก้ |

---

## Critical Issues (แก้ก่อน — ทำให้ช้ามาก)

### C1: Missing Database Indexes on `orders` table
**ไฟล์:** `lib/db/schema.ts`  
**ปัญหา:** ตาราง `orders` ไม่มี index บน `sessionId` และ `createdAt` ทั้งที่ทุก query ใช้ทั้งสอง field นี้

ทุก session page, KDS, POS ล้วน query `orders WHERE sessionId = ?` — ไม่มี index = full table scan ทุกครั้ง

```ts
// สิ่งที่ขาดใน schema.ts:
export const orders = pgTable('orders', { ... }, (table) => ({
  // ❌ ไม่มี index บน sessionId และ createdAt
}));
```

**วิธีแก้:**
```ts
(table) => ({
  sessionIdIdx: index('orders_session_id_idx').on(table.sessionId),
  createdAtIdx: index('orders_created_at_idx').on(table.createdAt),
})
```

---

### C2: Missing Index on `payments.paidAt`
**ไฟล์:** `lib/db/schema.ts`  
**ปัญหา:** Dashboard queries (`lib/actions/dashboard.ts`) filter payments by `paidAt` range เพื่อสร้าง revenue report — ไม่มี index = scan ทั้งตาราง

**วิธีแก้:**
```ts
export const payments = pgTable('payments', { ... }, (table) => ({
  paidAtIdx: index('payments_paid_at_idx').on(table.paidAt),
}));
```

---

### C3: N+1 Query ใน Cooldown Check
**ไฟล์:** `lib/actions/orders.ts` บรรทัด ~126  
**ปัญหา:** ทุก item ที่ order มี `cooldownSeconds > 0` จะ query DB แยก 1 ครั้ง ถ้า order 10 items = 10 queries

```ts
// ❌ ปัจจุบัน:
for (const item of items) {
  if (mi.cooldownSeconds > 0) {
    const [recent] = await db  // ← query ใน loop!
      .select(...)
      .from(orderItems)
      ...
  }
}
```

**วิธีแก้:** batch query cooldown items ทั้งหมดก่อน loop:
```ts
// รวบรวม items ที่ต้อง cooldown check ก่อน
const cooldownItems = items.filter(item => menuItemMap.get(item.menuItemId)!.cooldownSeconds > 0);
const menuItemIds = [...new Set(cooldownItems.map(i => i.menuItemId))];

// 1 query สำหรับทุก item
const recentByMenuItemId = await db
  .select({ menuItemId: orderItems.menuItemId, id: orderItems.id })
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .where(and(
    eq(orders.sessionId, session.id),
    inArray(orderItems.menuItemId, menuItemIds),
    gte(orders.createdAt, earliestCooldown),
  ));
const recentSet = new Set(recentByMenuItemId.map(r => r.menuItemId));

// ใน loop ใช้ Set แทน query:
for (const item of items) {
  if (mi.cooldownSeconds > 0 && recentSet.has(item.menuItemId)) {
    // cooldown hit
  }
}
```

---

### C4: Over-Revalidation — `revalidatePath('/', 'layout')` ใน 11 จุด
**ไฟล์:** `lib/actions/tables.ts`, `lib/actions/sessions.ts`, `lib/actions/pos.ts`  
**ปัญหา:** ทุกครั้งที่กดเปิด/ปิดโต๊ะ, เปิด session, หรือชำระเงิน จะ invalidate cache ทั้ง app รวมถึง dashboard, queue, menu ที่ไม่เกี่ยวข้อง

Locations:
- `tables.ts`: lines ~206, ~235, ~275, ~305, ~321
- `sessions.ts`: lines ~141, ~207, ~246, ~264, ~307, ~356
- `pos.ts`: lines ~273-274 (ซ้ำสองครั้ง)

**วิธีแก้:** scope revalidation ให้แคบลง:
```ts
// แทนที่:
revalidatePath('/', 'layout');

// ใช้:
revalidatePath('/tables');
revalidatePath('/pos');
// หรือถ้าต้องการ layout-scope:
revalidatePath('/(staff)', 'layout');
```

---

## High Priority

### H1: Missing Index บน `menuItems.categoryId`
**ไฟล์:** `lib/db/schema.ts`  
**ปัญหา:** ทุก menu query filter by category — ถ้าไม่มี index = scan ทุกครั้ง  
**วิธีแก้:**
```ts
categoryIdIdx: index('menu_items_category_id_idx').on(table.categoryId),
```

---

### H2: `dnd-kit` ไม่ได้ dynamic import
**ไฟล์:** `components/admin/PricingTilesPage.tsx` line 6-20, `components/staff/TableGrid.tsx` line ~1  
**ปัญหา:** `@dnd-kit/core` + `@dnd-kit/sortable` โหลดทุกครั้งที่เข้าหน้า pricing-tiles และ tables แม้ผู้ใช้อาจไม่ได้ใช้ drag-and-drop  
**วิธีแก้:** ยังต้องออกแบบก่อนว่า wrap ที่ level ไหน เพราะ dnd-kit ใช้ context ลึก อาจ complex กว่าจะคุ้ม — **ประเมินก่อนทำ**

---

### H3: `SELECT *` บน queries ที่ใช้บ่อย
**ไฟล์:** `lib/actions/tables.ts` line ~19-20  
**ปัญหา:** ดึงทุก column รวมถึง `positionX`, `positionY`, `width`, `height`, `notes` ที่ table grid ไม่ได้ใช้  
**วิธีแก้:**
```ts
db.select({
  id: tables.id,
  label: tables.label,
  zone: tables.zone,
  status: tables.status,
  qrToken: tables.qrToken,
  capacity: tables.capacity,
}).from(tables).where(...)
```

---

### H4: `SELECT *` บน `pricingTiles` ใน POS
**ไฟล์:** `lib/actions/pos.ts` line ~113-117  
**ปัญหา:** ดึงทุก column รวม `discountType`, `discountValue`, `color`, `notes` ที่ POS session list ไม่ใช้  

---

## Medium Priority

### M1: Missing `staleTime` บน useQuery ที่มี refetchInterval
**ไฟล์:** หลายไฟล์  
**ปัญหา:** Query ที่ไม่มี staleTime จะถือว่า data "stale" ทันที แม้จะเพิ่ง fetch — ทำให้ refetch ซ้ำถี่กว่าที่ตั้ง interval ไว้

Queries ที่ขาด staleTime:
- `components/customer/QueueStatus.tsx` (interval 10s)
- `components/customer/OrderList.tsx` (interval 10s)
- `components/customer/CustomerMenuPage.tsx` (interval 5s)
- `components/staff/QueueBoard.tsx` (interval 5s)
- `components/staff/KdsBoard.tsx` (interval 3s)
- `components/admin/DashboardPage.tsx` (interval 60s)

**วิธีแก้:** เพิ่ม `staleTime` ให้เท่ากับหรือน้อยกว่า `refetchInterval`:
```ts
useQuery({
  queryKey: ['kds-items'],
  refetchInterval: 3000,
  staleTime: 2000,  // ← เพิ่ม
  ...
})
```

---

### M2: Drizzle Query API — `findMany` without column selection
**ไฟล์:** `lib/actions/menu.ts` line ~44, `lib/actions/dashboard.ts`  
**ปัญหา:** `db.query.categories.findMany()` ดึงทุก column รวม `with:` relations ที่อาจไม่จำเป็น  

---

## Low Priority / Nice to Have

### L1: `refetchOnWindowFocus` ยังเปิดอยู่บางที่
Quick Win 1 ปิด global default แล้ว แต่ query บางตัวอาจ override กลับได้ — ตรวจภายหลัง

### L2: `retry: 1` ที่ global
ตั้งแล้วใน Quick Win 1 — ดีแล้ว ไม่ต้องแก้

### L3: Optimistic UI สำหรับ Queue / Order actions
ยังไม่ implement — ทำให้ปุ่มรู้สึกตอบสนองทันที แม้ DB ยังไม่ commit
**Priority:** ทำหลัง critical fixes เสร็จ

---

## สิ่งที่ถูกต้องอยู่แล้ว ✅

- **Neon `-pooler` URL** ใช้อยู่แล้วทั้ง local และ production
- **Session indexes ครบ:** `tableId`, `status`, `sessionToken`, `closedAt`, `parentSessionId`
- **`orderItems` indexes ครบ:** `orderId`, composite `(station, status)` สำหรับ KDS
- **`reservations` indexes ครบ:** `tableId`, `reservedAt`, `status`, `parentReservationId`
- **Queue + audit indexes:** `publicToken`, `createdAt` มีครบ
- **KDS polling 3s** ตาม spec (อาจ aggressive แต่ตั้งไว้แบบนั้น intentionally)
- **Tables grid, POS** มี `staleTime: 2000` อยู่แล้ว
- **StaffForm, ResetPasswordForm** มี `isSubmitting` อยู่แล้ว
- **Most multi-query patterns** ใช้ `Promise.all()` ไม่ใช่ N+1
- **`retry: 1`** ตั้งไว้แล้วก่อน Quick Win

---

## สรุปลำดับ Fix หลัง User Approve

| ลำดับ | Issue | Effort | Impact |
|-------|-------|--------|--------|
| 1 | C1 — Add index `orders(sessionId, createdAt)` | Low | High |
| 2 | C2 — Add index `payments(paidAt)` | Low | High |
| 3 | H1 — Add index `menuItems(categoryId)` | Low | Medium |
| 4 | C4 — Scope revalidatePath (11 จุด) | Medium | High |
| 5 | C3 — Fix N+1 cooldown query | Medium | Medium |
| 6 | H3/H4 — Selective SELECT columns | Medium | Low-Medium |
| 7 | M1 — Add staleTime to all refetchInterval queries | Low | Medium |
| 8 | L3 — Optimistic UI | High | Medium |

Steps 1-3 รวม schema change → `npm run db:push` 1 ครั้ง

---

*หยุดที่นี่ รอ user review ก่อนเริ่ม fix*

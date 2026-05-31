# Polling Audit Report

> วันที่: 2026-05-31 | สถานะ: Audit เสร็จ — รอ user review ก่อนแก้

---

## All useQuery Instances

| # | queryKey | interval | staleTime | enabled | location | scope |
|---|----------|----------|-----------|---------|----------|-------|
| 1 | `['kds-items']` | **3 s** | 1 s | always | `KdsBoard` → `/kds` page | page-only ✅ |
| 2 | `['pos-sessions']` | 5 s | 2 s | always | `PosTerminal` → `/pos` page | page-only ✅ |
| 3 | `['pos-detail', sessionId]` | 10 s | 5 s | always | `DetailPanel` ใน `PosTerminal` → `/pos` | page-only ✅ |
| 4 | `['tables']` | 5 s (0 ใน editMode) | 2 s | always | `TableGrid` → `/tables` page | page-only ✅ |
| 5 | `['queue-list']` | 5 s | 2 s | always | `QueueBoard` → `/queue` page | page-only ✅ |
| 6 | `['dashboard']` | 60 s | 30 s | always | `DashboardPage` → `/dashboard` | page-only ✅ |
| 7 | `['session-orders', token]` | 10 s | 5 s | always | `OrderList` → customer `/t/[token]` | customer-only ✅ |
| 8 | `['unserved', token]` | 5 s | 2 s | always | `CustomerMenuPage` → customer `/t/[token]` | customer-only ✅ |
| 9 | `['queue-status', token]` | 10 s | 5 s | always | `QueueStatus` → customer `/q/[token]` | customer-only ✅ |
| 10 | `['menu-crud']` | — | 30 s (global) | always | `MenuPage` → `/menu` | page-only ✅ |
| 11 | `['staff-list']` | — | 30 s (global) | always | `StaffPage` → `/users` | page-only ✅ |
| 12 | `['pricing-tiles-all']` | — | 30 s (global) | always | `PricingTilesPage` → `/pricing-tiles` | page-only ✅ |
| 13 | `['pricing-tiles']` | — | 30 s (global) | always | `PricingPage` → `/pos` (open dialog) | page-only ✅ |
| 14 | `['pos-tiles']` | — | 60 s | always | `DetailPanel` ใน `PosTerminal` → `/pos` | page-only ✅ |
| 15 | `['store-settings']` | — | 300 s | always | `DetailPanel` ใน `PosTerminal` → `/pos` | page-only ✅ |
| 16 | `['session-detail', id]` | — | 60 s | `!!sessionId` | `SessionDetailDialog` → `/tables` | page-only ✅ |
| 17 | `['payment-history', date]` | — | 30 s | always | `/pos/history` page inline | page-only ✅ |
| 18 | `['session-history', date]` | — | 30 s | always | `/tables/history` page inline | page-only ✅ |
| 19 | `['history-calendar', y, m]` | — | 60 s | always | `HistoryCalendar` → `/tables/history` | page-only ✅ |
| 20 | `['kds-history', date]` | — | 30 s (global) | always | `KdsHistoryPage` → `/kds/history` | page-only ✅ |

**Polling queries (มี refetchInterval): 9 ตัว (queries 1–9)**  
**Static queries (ไม่มี interval): 11 ตัว (queries 10–20)**

---

## Layout/Shared Component Scan

| ไฟล์ | useQuery? | polling? | หมายเหตุ |
|------|-----------|---------|---------|
| `app/layout.tsx` | ❌ | ❌ | Server component |
| `app/(staff)/layout.tsx` | ❌ | ❌ | Server component |
| `app/(admin)/layout.tsx` | ❌ | ❌ | Server component |
| `app/(customer)/layout.tsx` | ❌ | ❌ | Server component |
| `components/shared/SidebarLayout.tsx` | ❌ | ❌ | Client component แต่ไม่มี query |
| `components/shared/AppHeader.tsx` | ❌ | ❌ | Server component |
| `components/shared/QueryProvider.tsx` | ❌ | ❌ | ตั้ง global defaults เท่านั้น |
| `components/shared/ConfirmDialog.tsx` | ❌ | ❌ | UI utility เท่านั้น |

**ไม่มี global/shared polling เลยสักตัว** — ทุก query อยู่ใน page-level component

---

## Anti-patterns Found

### 🔴 Critical — A1: `initialData` ไม่มี `initialDataUpdatedAt`

**ไฟล์:** ทุก polling component (queries 1–6)  
**ปัญหา:** ทุก polling component ใช้ `initialData: initialDataFromSSR` โดยไม่มี `initialDataUpdatedAt`

```ts
// ปัจจุบัน — ทุกตัว:
useQuery({
  queryKey: ['kds-items'],
  queryFn: ...,
  initialData: initialItems,   // ← ปัญหา!
  refetchInterval: 3_000,
  staleTime: 1_000,
});
```

**พฤติกรรมที่เกิดขึ้น:**  
TanStack Query ตั้ง `updatedAt = 0` (unix epoch) สำหรับ `initialData` ที่ไม่มี `initialDataUpdatedAt`  
→ `0 + staleTime(1000ms)` ยังอยู่ในอดีต → data ถูกมองว่า **stale ทันทีที่ mount**  
→ component mount ปุ๊บ → **immediate refetch ทันที** (นอกเหนือจาก interval ปกติ)

**ผลลัพธ์ที่สังเกตได้ใน Network tab:**
- เปิดหน้า /kds → request ยิงทันที (t=0) แล้วอีกครั้งที่ t=3s, t=6s, ...
- เปิดหน้า /tables → request ยิงทันที (t=0) แล้ว t=5s, t=10s, ...
- เปิดหน้า /pos → request ยิงทันที (t=0) แล้ว t=5s, t=10s, ...

เมื่อ user navigate ระหว่างหน้า: แต่ละหน้าที่ mount จะมี immediate refetch เพิ่มมาอีก 1 ครั้ง

---

### 🔴 Critical — A2: React Concurrent Transitions ทำให้มี overlap ช่วงสั้น

**ปัญหา:** Next.js App Router ใช้ React 18 concurrent mode + `startTransition` ในการ navigate  
ระหว่าง transition (เช่น จาก /kds → /tables):

```
t=0ms:  user clicks sidebar → transition starts
t=0ms:  KdsBoard ยัง mounted (fiber ยังอยู่)   → ['kds-items'] interval ยังทำงาน
t=0ms:  TableGrid เริ่ม mount (concurrent render) → ['tables'] interval เริ่ม
t=~50ms: React commits → KdsBoard unmounts → KDS interval หยุด
```

ช่วง 0–50ms มีทั้ง KdsBoard + TableGrid mounted พร้อมกัน → polling ซ้อนกัน  
ถ้า user navigate ผ่าน 4 หน้า (kds→pos→tables→queue) ใน timeframe สั้น:  
→ brief overlap ของทั้ง 4 queries ปรากฏใน Network tab เกือบพร้อมกัน

---

### 🟠 High — A3: staleTime < refetchInterval บน KDS

**ไฟล์:** `KdsBoard.tsx`  
```ts
refetchInterval: 3_000,
staleTime: 1_000,   // ← data เก่าก่อน interval tick ถัดไป 2 วินาที
```

ช่วง t=1s ถึง t=3s หลัง fetch: data ถูกมองว่า stale  
→ ถ้ามี trigger อื่น (เช่น window focus หรือ reconnect ถ้าเปิดไว้) จะ refetch ก่อน interval  
→ ค่าที่สมเหตุสมผล: `staleTime ≥ refetchInterval` หรือ `staleTime ≈ refetchInterval * 0.8`

---

### 🟠 High — A4: queryKey ซ้ำซ้อน — pricing-tiles

**ไฟล์ที่เกี่ยวข้อง:**
- `PricingPage.tsx` → `queryKey: ['pricing-tiles']` (fetch guest tiles only)
- `PricingTilesPage.tsx` → `queryKey: ['pricing-tiles-all']` (fetch all tiles)
- `PosTerminal.tsx (DetailPanel)` → `queryKey: ['pos-tiles']` (fetch all tiles)

สามตัวนี้ fetch pricing tiles แต่ใช้ key ต่างกัน → **cache ไม่ share กัน**  
→ ถ้า user อยู่หน้า /pos แล้ว navigate ไป /pricing-tiles จะ fetch ซ้ำทั้งที่ข้อมูลเดียวกัน

---

### 🟡 Medium — A5: queryKey ซ้ำ — session-history

**ไฟล์ที่เกี่ยวข้อง:**
- `/tables/history/page.tsx` → `queryKey: ['session-history', date]` → calls `getSessionHistory(date)`
- `/pos/history/page.tsx` → `queryKey: ['payment-history', date]` → calls `getSessionHistory(date)`

**ทั้งสองเรียก function เดียวกัน** (`getSessionHistory`) แต่ใช้ queryKey ต่างกัน  
→ ถ้าเปิดทั้งสองหน้าในวันเดียวกัน จะ fetch เนื้อหาเดียวกันสองรอบ และ cache แยกกัน

---

### 🟡 Medium — A6: `pos-detail` poll ทุก 10s ไม่มี `enabled` guard

**ไฟล์:** `PosTerminal.tsx`, line 172–177  
```ts
function DetailPanel({ sessionId, ... }) {
  const { data } = useQuery({
    queryKey: ['pos-detail', sessionId],
    refetchInterval: 10_000,   // ← ยิงตลอดเมื่อ session selected
    staleTime: 5_000,
  });
```

ทุกครั้งที่ user เลือก session บน POS:  
- `['pos-sessions']` poll ทุก 5s  
- `['pos-detail', id]` poll ทุก 10s  
- เกิด 2 concurrent polling บนหน้าเดียว — อาจ overkill ถ้า session detail ไม่ต้องการ real-time ขนาดนี้

---

### 🟢 Low — A7: CustomerMenuPage poll `unserved` ทุก 5s

**ไฟล์:** `CustomerMenuPage.tsx`  
```ts
queryKey: ['unserved', sessionToken],
refetchInterval: 5_000,   // ← ทุก 5s ตลอดเวลาที่ลูกค้าดูเมนู
```

5s อาจถี่เกินไปสำหรับ "มีออเดอร์ค้างอยู่มั้ย" — ลูกค้าไม่ต้องการ real-time ระดับนี้  
10s น่าจะเพียงพอ

---

## Root Cause Hypothesis

### ทำไม network tab เห็น kds + pos + tables + queue พร้อมกัน

**สาเหตุหลัก (A1 + A2 รวมกัน):**

1. **A1 — immediate refetch on mount**: ทุก polling component มี `initialData` โดยไม่มี `initialDataUpdatedAt`  
   → ทุกหน้าที่ mount จะ fire request ทันที (t=0) นอกจาก interval ปกติ  
   → ถ้า user navigate kds→pos→tables→queue ภายใน 3-5 วินาที จะเห็น 4 immediate refetches ใน network ใกล้กัน

2. **A2 — concurrent transition overlap**: React 18 concurrent mode ทำให้มี window ~50ms ที่ทั้ง old+new page component mounted พร้อมกัน  
   → ถ้า navigate หลายหน้าติดกัน: ช่วง overlap ของแต่ละ transition ซ้อนกัน → เห็น requests จากหลาย queries ใน timeframe สั้น

**ไม่ใช่สาเหตุ:**
- ❌ Global polling ใน layout/header — ไม่มีเลย
- ❌ Background tab polling — `refetchIntervalInBackground: false` เป็น default
- ❌ Multiple tabs — user confirm แล้วว่า tab เดียว
- ❌ Multiple observers ใน shared component — ไม่มี polling ใน shared components

---

## Recommended Fixes (ห้าม implement ในรอบนี้)

### Fix 1: เพิ่ม `initialDataUpdatedAt` ทุก polling query (แก้ A1)

```ts
// แก้ทุก polling component (KdsBoard, PosTerminal, TableGrid, QueueBoard, DashboardPage)
useQuery({
  queryKey: ['kds-items'],
  queryFn: ...,
  initialData: initialItems,
  initialDataUpdatedAt: Date.now(),   // ← เพิ่มบรรทัดนี้
  refetchInterval: 3_000,
  staleTime: 1_000,
});
```

**ผลลัพธ์:** ไม่มี immediate refetch ตอน mount — รอ interval tick แรก  
**Impact:** ลด requests ลง ~1 request ต่อ page navigation

### Fix 2: แก้ staleTime บน KDS ให้ ≥ refetchInterval (แก้ A3)

```ts
refetchInterval: 3_000,
staleTime: 2_500,   // ← จาก 1s เป็น 2.5s (เกือบเท่า interval)
```

### Fix 3: รวม pricing-tiles queryKey (แก้ A4)

ให้ `PricingPage`, `PricingTilesPage`, และ `PosTerminal` ใช้ key เดียวกัน:
```ts
queryKey: ['pricing-tiles'],   // ใช้เหมือนกันทุกที่
```

### Fix 4: รวม session-history queryKey (แก้ A5)

```ts
// ทั้งสองหน้าใช้:
queryKey: ['session-history', selectedDate],   // key เดียวกัน → share cache
```

### Fix 5: เพิ่ม `enabled` guard บน pos-detail (แก้ A6)

```ts
useQuery({
  queryKey: ['pos-detail', sessionId],
  enabled: !!sessionId,   // ← ไม่ poll ถ้าไม่ได้เลือก session
  refetchInterval: sessionId ? 10_000 : false,
  ...
})
```

### Fix 6: เพิ่ม interval ของ unserved check (แก้ A7)

```ts
refetchInterval: 10_000,   // จาก 5s → 10s
staleTime: 5_000,
```

---

## สรุป Priority

| Fix | Issue | Effort | Impact |
|-----|-------|--------|--------|
| Fix 1 | initialDataUpdatedAt ทุก polling query | Low | **High** — ลด request burst ต่อ navigation |
| Fix 2 | KDS staleTime | Low | Low |
| Fix 3 | pricing-tiles key รวม | Medium | Low |
| Fix 4 | session-history key รวม | Low | Low |
| Fix 5 | pos-detail enabled guard | Low | Medium |
| Fix 6 | unserved interval 5s→10s | Low | Low |

**Fix 1 เป็น priority สูงสุด** — ตรงกับ root cause หลักที่ทำให้เห็น burst of requests ตอน navigate

---

*หยุดที่นี่ — รอ user review ก่อน implement*

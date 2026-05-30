# Performance Audit Report — Phase 14 (Re-audit)

> วันที่: 2026-05-30 | สถานะ: Phase A เสร็จ — รอ user approve ก่อน fix

---

## สิ่งที่ Fixed แล้วในรอบก่อน ✅ (ไม่ต้องทำซ้ำ)

| Issue | ไฟล์ | สถานะ |
|-------|------|--------|
| orders table indexes (sessionId, createdAt) | schema.ts | ✅ อยู่ใน schema แล้ว |
| payments.paidAt index | schema.ts | ✅ อยู่ใน schema แล้ว |
| menuItems.categoryId index | schema.ts | ✅ อยู่ใน schema แล้ว |
| N+1 cooldown — batch query | orders.ts:119-148 | ✅ Fixed แล้ว |
| revalidatePath scoped (/tables, /pos) | sessions.ts, tables.ts, pos.ts | ✅ Fixed แล้ว |
| staleTime บน useQuery ทุกตัว | components ทุกตัว | ✅ Fixed แล้ว |
| QueryProvider defaults (staleTime 30s, refetchOnWindowFocus: false, retry: 1) | QueryProvider.tsx | ✅ Fixed แล้ว |
| KdsBoard memoized (React.memo, useMemo) | KdsBoard.tsx | ✅ Fixed แล้ว |
| PosTerminal useMemo + useCallback | PosTerminal.tsx | ✅ Fixed แล้ว |
| Neon pooled connection URL | .env.local | ✅ ใช้อยู่แล้ว |

---

## Root Cause Hypothesis (จากการวิเคราะห์ static)

**อาการ:** กดปุ่มอะไรก็ delay 1-2 วินาที — ช้าทั้ง localhost และ production

เนื่องจากช้าทั้ง localhost ด้วย จึงไม่ใช่แค่ Vercel cold start — ต้องเป็นปัญหาที่ DB layer

**สาเหตุหลักที่น่าจะเป็น (มี 2 สาเหตุที่ซ้อนกัน):**

1. **Neon scale-to-zero cold start** — Free tier Neon หยุด compute หลัง 5 นาที ไม่มี activity  
   → first query หลัง idle = 1,000–2,000 ms  
   → ถ้า action มี 3 sequential queries, cold start query แรกทำให้รวม = ~1,500+ ms

2. **Sequential DB round trips ใน hot paths** — Thailand → Singapore Neon ≈ 60–100 ms/query  
   → closeSession: 5 sequential queries = ~400 ms (warm)  
   → processPayment: 7-8 sequential operations = ~600 ms (warm)  
   → เมื่อรวมกับ cold start = ชัดเจนมากว่าช้า

---

## เครื่องมือวัด (Step 2.3) — ต้องรันก่อนแก้

### วัด DB RTT จริง

เรียก endpoint ใหม่ที่สร้างไว้:
- **localhost:** `http://localhost:3000/api/debug/db-rtt`
- **production:** `https://[your-domain].vercel.app/api/debug/db-rtt`

**Interpretation:**
| sample[0] | sample[1-9] avg | ความหมาย |
|-----------|-----------------|----------|
| > 1000 ms | < 100 ms | **Neon cold start ชัดเจน** — สาเหตุหลัก |
| < 200 ms | < 100 ms | ไม่ใช่ cold start — ช้าจาก sequential queries |
| < 200 ms | > 200 ms | Neon ไม่ pooled หรือ compute ช้า |

**บันทึกผลใน PERFORMANCE_BASELINE.md**

---

## Issues ที่ยังค้างอยู่ (เรียงตาม Impact)

---

### 🔴 Critical: Neon Scale-to-Zero Cold Start

**Evidence:** อาการ delay 1-2s เกิด "เป็นพักๆ" ไม่ใช่ทุกครั้ง — pattern ตรงกับ cold start  
**Impact:** first query หลัง idle: **1,000–2,000 ms**  

**ตัวเลือกแก้:**

**Option A: อัปเกรด Neon Pro** (ราคา ~$19/เดือน)
- Disable scale-to-zero → compute ทำงาน 24/7
- เหมาะถ้า production use จริง
- ต้องตัดสินใจจาก user

**Option B: Keep-warm ping (ฟรี ทำได้เลย)**
- เพิ่ม cron job ping `SELECT 1` ทุก 4 นาที เพื่อไม่ให้ compute หลับ
- ใช้ Vercel Cron Jobs (ฟรีใน Hobby plan — max 1 job, every 60 min ไม่เพียงพอ)
- หรือใช้ external cron เช่น cron-job.org (ฟรี, ทำได้ทุก 5 นาที)

**Option C: Neon Pro + Connection Pooling ปิด scale-to-zero**
- Neon Pro มี "suspend compute" setting ที่ disable ได้

---

### 🔴 Critical: No `vercel.json` — Region ไม่แน่ใจ

**ตำแหน่ง:** root directory (ไม่มีไฟล์)  
**ปัญหา:** ไม่ได้ pin region — Vercel อาจ assign Function ไป region อื่นที่ไม่ใช่ Singapore  
Neon อยู่ใน `ap-southeast-1` (Singapore) — ถ้า Vercel Function อยู่ที่ US/EU จะเพิ่ม latency ~200ms ต่อ query  

**วิธีแก้:** สร้าง `vercel.json`:
```json
{
  "regions": ["sin1"]
}
```

**Impact:** ถ้าปัจจุบัน deploy ที่ US/Europe: ประหยัด **150–250 ms ต่อ query**  
**Effort:** 5 นาที  

---

### 🟠 High: Sequential Queries ใน `closeSession` (5 → 3 round trips)

**ไฟล์:** `lib/actions/sessions.ts:168-205`  
**ปัญหา:** 5 sequential DB calls ทั้งที่บาง step ทำพร้อมกันได้

```ts
// ปัจจุบัน — 5 sequential round trips:
// Round 1: get session (tableId, parentSessionId)
// Round 2: get linkedSessions (children of primary)   ← depends only on Round 1
// Round 3: get primarySession tableId                 ← depends only on Round 1 (NOT Round 2)
// Round 4: update sessions status                     ← depends on Round 2+3
// Round 5: update tables status                       ← depends on Round 2+3 (NOT Round 4)
```

**วิธีแก้:**
```ts
// After Round 1: get both children + primary in 1 query
const allSessions = await db
  .select({ id: sessions.id, tableId: sessions.tableId })
  .from(sessions)
  .where(or(
    eq(sessions.id, primaryId),
    eq(sessions.parentSessionId, primaryId),
  ));

// Then run updates in parallel:
await Promise.all([
  db.update(sessions).set({ status: 'closed', closedAt: new Date() }).where(inArray(sessions.id, allSessionIds)),
  db.update(tables).set({ status: 'available' }).where(inArray(tables.id, allTableIds)),
]);
```

**Impact:** 5 → 2 sequential + 1 parallel = ประหยัด **~160 ms (warm) หรือ 2 Neon HTTP calls**

---

### 🟠 High: Sequential Table Updates ใน `moveSession`

**ไฟล์:** `lib/actions/sessions.ts:355-357`  
**ปัญหา:** 2 `UPDATE tables` ที่ update คนละแถว ทำ sequential

```ts
// ปัจจุบัน:
await db.update(tables).set({ status: 'available' }).where(eq(tables.id, oldTableId));
await db.update(tables).set({ status: newTableStatus }).where(eq(tables.id, input.newTableId));
```

**วิธีแก้:**
```ts
await Promise.all([
  db.update(tables).set({ status: 'available' }).where(eq(tables.id, oldTableId)),
  db.update(tables).set({ status: newTableStatus }).where(eq(tables.id, input.newTableId)),
]);
```

**Impact:** ประหยัด **~80 ms**

---

### 🟠 High: Sequential Table Updates ใน `transferPrimary`

**ไฟล์:** `lib/actions/sessions.ts:507-509`  
**ปัญหา:** 2 `UPDATE tables` sequential ที่ update คนละ row

```ts
// ปัจจุบัน:
await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, newPrimSess.tableId));
await db.update(tables).set({ status: 'linked' }).where(eq(tables.id, oldPrimSess.tableId));
```

**วิธีแก้:** รวมเป็น `Promise.all`  
**Impact:** ประหยัด **~80 ms**

---

### 🟠 High: processPayment มี 2 Sequential Queries ก่อน Main Logic

**ไฟล์:** `lib/actions/pos.ts:146-179`  
**ปัญหา:** idempotency check และ session fetch เป็น sequential

```ts
// Round 1: session findFirst (with table, guests, linkedSessions)
const session = await db.query.sessions.findFirst({ ... });

// Round 2: payments findFirst (idempotency check) — ← ไม่ขึ้นกับ Round 1 data!
const existingPayment = await db.query.payments.findFirst({ ... });

// Round 3: orders findMany (depends on linkedSessionIds from Round 1)
```

Round 1 และ Round 2 ไม่ขึ้นต่อกัน สามารถ parallel ได้:
```ts
const [session, existingPayment] = await Promise.all([
  db.query.sessions.findFirst({ where: eq(sessions.id, sessionId), with: { ... } }),
  db.query.payments.findFirst({ where: eq(payments.sessionId, sessionId) }),
]);
```

**Impact:** ประหยัด **~80 ms** ต่อ payment

---

### 🟡 Medium: TableGrid Table Cards ไม่มี React.memo

**ไฟล์:** `components/staff/TableGrid.tsx`  
**ปัญหา:** component ที่ render table cards ไม่ได้ wrap ด้วย `React.memo`  
ทุก 5 วินาทีที่ poll คืนมา → table array ใหม่ → ALL table cards re-render แม้ข้อมูลไม่เปลี่ยน

ต้องตรวจว่า inner card component ชื่ออะไร (ไม่มี export ชัดเจน ต้องดู line 200-500)  

**วิธีแก้:** wrap card render function ด้วย `React.memo` และใช้ `useCallback` สำหรับ handlers

**Impact:** ลด CPU usage และ time-to-paint หลัง poll

---

### 🟡 Medium: H2 — `@dnd-kit` Imported ที่ Top Level

**ไฟล์:** `components/staff/TableGrid.tsx:6-7`  
```ts
import { DndContext, ... } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
```

dnd-kit โหลดทุกครั้งที่เปิดหน้า tables แม้ผู้ใช้ไม่ได้ drag  
**Impact:** เพิ่ม bundle size / parse time, ไม่ใช่สาเหตุ runtime delay

---

### 🟡 Medium: getPosSessionsForPos ใช้ Drizzle Relational API

**ไฟล์:** `lib/actions/pos.ts:25-37`  
```ts
db.query.sessions.findMany({
  with: {
    table: true,
    guests: { with: { pricingTile: true } },
  },
})
```

Drizzle relational query กับ neon-http อาจ batch หลาย queries ใน 1 HTTP call — แต่ถ้าไม่ batch จะเป็น 3 HTTP round trips  
**วิธีตรวจ:** ดู console log ว่ามีกี่ `⏱️` ต่อ 1 poll cycle (หลังติด `withTiming`)

---

### 🟢 Low: H3/H4 — SELECT * บน Queries ที่เรียกบ่อย

**ไฟล์:** `lib/actions/tables.ts:17-18`, `lib/actions/pos.ts:113-117`  
ดึงทุก column รวม column ที่ไม่ใช้  
**Impact:** ต่ำ (Neon ใกล้กัน, overhead น้อย)

---

## สรุปลำดับ Fix ที่แนะนำ (หลัง user approve)

| ลำดับ | Issue | Effort | Impact | ต้องตัดสินใจ? |
|-------|-------|--------|--------|--------------|
| 1 | สร้าง `vercel.json` region = sin1 | 5 นาที | High | ไม่ |
| 2 | วัด DB RTT จาก `/api/debug/db-rtt` บน production | 5 นาที | — (วัดผล) | ไม่ |
| 3 | Parallel Round 2+3 ใน `closeSession` | 30 นาที | High | ไม่ |
| 4 | Parallel table updates ใน `moveSession` + `transferPrimary` | 15 นาที | Medium | ไม่ |
| 5 | Parallel `session + existingPayment` ใน `processPayment` | 15 นาที | Medium | ไม่ |
| 6 | Neon keep-warm strategy | 30 นาที | Critical | **ใช่ — user ต้องเลือก Option A/B/C** |
| 7 | React.memo บน TableGrid table cards | 45 นาที | Medium | ไม่ |
| 8 | dnd-kit dynamic import | 60 นาที | Low-Medium | ไม่ |

Steps 1-5 ทำได้ทันทีหลัง approve  
Step 6 ต้องการ user decision ก่อน

---

## สิ่งที่ยังดีอยู่ ✅

- Neon `-pooler` URL ✅
- DB driver `neon-http` ✅ (ถูกต้องสำหรับ serverless)
- JWT auth strategy — `auth()` ไม่ hit DB ✅
- Session + orderItems indexes ครบ ✅
- Polling intervals ตาม spec ✅
- QueryProvider global defaults ✅
- KdsBoard, PosTerminal memoized ✅
- revalidatePath scoped ✅
- N+1 cooldown query fixed ✅
- optimizePackageImports (recharts, lucide-react, date-fns) ✅

---

*หยุดที่นี่ — รอ user review และ approve ลำดับ fix ก่อนเริ่ม Phase D*

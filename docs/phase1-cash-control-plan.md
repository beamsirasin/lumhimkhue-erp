# Phase 1 Implementation Plan — Cash Control & Security

*วันที่วิเคราะห์: 17 มิ.ย. 2569 | Read-only audit — ยังไม่มีการแก้โค้ดใดๆ*

---

## 1. Current Risky Files

### Critical (HIGH)

| File | ปัญหา | ความเสี่ยง |
|------|--------|------------|
| `app/api/print/network/route.ts` | ไม่มี auth เลยสักบรรทัด — รับ IP + port + raw base64 แล้วต่อ TCP ไปยัง printer | ใครก็สั่ง print จาก LAN ได้โดยไม่ต้อง login |
| `app/api/debug/db-rtt/route.ts` | ไม่มี auth เลย — run 10 sequential queries แล้วตอบ RTT กลับ | เปิด DB performance fingerprint ให้คนนอก |
| `lib/actions/history.ts` (`deletePaymentRecord`, `reopenSessionForPayment`) | เช็คแค่ `process_payment` ทั้งคู่, ไม่เขียน audit log, ลบ record จริงๆ ออกจาก DB | cashier ลบ payment ได้โดยไม่มีร่องรอย |

### Medium

| File | ปัญหา |
|------|--------|
| `lib/auth/permissions.ts` | `process_payment` ครอบทุกอย่างตั้งแต่รับเงิน → void → reopen ไม่แยก granularity |
| `lib/db/schema.ts` | ไม่มี `cashier_shifts`, `payment_voids`, `payment_adjustments` tables |
| `components/staff/PosTerminal.tsx` | ไม่มี UI guard สำหรับ void/discount approval — ปุ่ม void อยู่ที่ history page ใครผ่าน `process_payment` เข้าได้ทำได้เลย |

---

## 2. Proposed Permission Matrix

### Actions ใหม่ที่ต้องเพิ่มใน `permissions.ts`

```
payment:process      — รับชำระเงิน
payment:void         — ยกเลิก payment ที่ผ่านแล้ว
payment:refund       — คืนเงิน
payment:reopen       — เปิด session กลับมาจาก paid
payment:delete       — ลบ payment record (hard delete, owner only)
discount:apply       — ใช้ส่วนลดในการชำระ
discount:approve     — อนุมัติส่วนลดที่เกิน limit
order:cancel         — ยกเลิก order item
order:cancel:approve — อนุมัติ cancel ที่เกิน limit
cashier_shift:manage — เปิด/ปิดรอบแคชเชียร์
```

### Role Policy Matrix

| Action | owner | manager | cashier | kitchen |
|--------|:-----:|:-------:|:-------:|:-------:|
| payment:process | ✓ | ✓ | ✓ | ✗ |
| payment:void | ✓ | ✓ | ✗ (ต้องขออนุมัติ) | ✗ |
| payment:refund | ✓ | ✓ (≤ limit) | ✗ | ✗ |
| payment:reopen | ✓ | ✓ | ✗ | ✗ |
| payment:delete | ✓ | ✗ | ✗ | ✗ |
| discount:apply | ✓ | ✓ | ✓ (≤ limit) | ✗ |
| discount:approve | ✓ | ✓ (≤ limit) | ✗ | ✗ |
| order:cancel | ✓ | ✓ | ✓ (เฉพาะ pending/preparing) | ✓ (เฉพาะ pending) |
| order:cancel:approve | ✓ | ✓ | ✗ | ✗ |
| cashier_shift:manage | ✓ | ✓ | ✓ (เฉพาะของตัวเอง) | ✗ |
| manage_tables | ✓ | ✓ | ✓ | ✗ (เอา kitchen ออก) |
| view_reports | ✓ | ✓ (limited) | ✗ | ✗ |

> **หมายเหตุ kitchen:** ปัจจุบัน `manage_tables` ให้ kitchen ด้วย — ต้องเอาออก

### Discount Limit Config (เก็บใน `store_settings` JSONB)

```jsonc
{
  "discountPolicy": {
    "cashierMaxDiscountPercent": 5,
    "cashierMaxDiscountFixed": 50,
    "managerMaxDiscountPercent": 20,
    "managerMaxDiscountFixed": 500
  }
}
```

---

## 3. Proposed Database Schema Additions

### 3.1 `cashier_shifts` table (ใหม่)

```sql
CREATE TABLE cashier_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  cashier_id      UUID NOT NULL REFERENCES users(id),
  opened_by       UUID NOT NULL REFERENCES users(id),
  closed_by       UUID REFERENCES users(id),

  status          TEXT NOT NULL DEFAULT 'open',  -- open | closed | reviewed
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,

  opening_float   NUMERIC(10,2) NOT NULL DEFAULT 0,  -- เงินทอนตั้งต้น
  expected_cash   NUMERIC(10,2),  -- คำนวณจาก payments ในรอบ
  actual_cash     NUMERIC(10,2),  -- นับจริงตอนปิดรอบ
  cash_difference NUMERIC(10,2),  -- actual - expected
  difference_reason TEXT,

  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON cashier_shifts (cashier_id, opened_at);
CREATE INDEX ON cashier_shifts (branch_id, status);
```

### 3.2 เพิ่มคอลัมน์ใน `payments` table

```sql
ALTER TABLE payments
  ADD COLUMN shift_id    UUID REFERENCES cashier_shifts(id),
  ADD COLUMN status      TEXT NOT NULL DEFAULT 'completed',  -- completed | voided | refunded
  ADD COLUMN voided_at   TIMESTAMPTZ,
  ADD COLUMN voided_by   UUID REFERENCES users(id),
  ADD COLUMN void_reason TEXT;
```

> **สำคัญมาก:** ห้ามลบ payment record ออกจาก DB — ใช้ `status = 'voided'` แทนทุกกรณี

### 3.3 `payment_adjustments` table (ใหม่ — immutable ledger)

```sql
CREATE TABLE payment_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES payments(id),
  shift_id        UUID REFERENCES cashier_shifts(id),
  type            TEXT NOT NULL,  -- void | refund | discount_correction
  amount          NUMERIC(10,2) NOT NULL,  -- บวก = คืนเงิน, ลบ = เพิ่มเงิน
  reason          TEXT NOT NULL,
  requested_by    UUID NOT NULL REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.4 `discount_approvals` table (ใหม่)

```sql
CREATE TABLE discount_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES dining_sessions(id),
  requested_by    UUID NOT NULL REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  discount_type   TEXT NOT NULL,  -- percentage | fixed
  discount_value  NUMERIC(10,2) NOT NULL,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.5 Audit Log Actions ที่ต้อง track (เพิ่มใน `audit_logs.action`)

```
process_payment     (มีแล้ว)
void_payment        (ใหม่)
refund_payment      (ใหม่)
reopen_session      (ใหม่)
delete_payment      (ใหม่, owner only)
apply_discount      (ใหม่)
approve_discount    (ใหม่)
cancel_order        (ใหม่)
approve_cancel      (ใหม่)
close_table         (ใหม่)
print_bill          (ใหม่)
shift_open          (ใหม่)
shift_close         (ใหม่)
shift_review        (ใหม่)
```

---

## 4. Proposed Server Action Changes

### 4.1 ปิด Public API — 2 ไฟล์

**`app/api/print/network/route.ts`**
- เพิ่ม `const session = await auth()` บรรทัดแรกของ handler
- Guard: `if (!session) return 401`
- Guard: `if (!can(session.user.role, 'manage_settings')) return 403`
- เพิ่ม `writeAuditLog({ action: 'print_bill', ... })`

**`app/api/debug/db-rtt/route.ts`**
- เพิ่ม auth check: owner เท่านั้น
- ถ้า `NODE_ENV === 'production'` → return 404 ทันที ไม่ต้องเช็ค auth

### 4.2 แก้ `deletePaymentRecord()` — `lib/actions/history.ts`

ปัจจุบัน: ลบจริง, ไม่มี audit log, เช็คแค่ `process_payment`

เปลี่ยนเป็น:
1. เช็ค `payment:void` permission (ไม่ใช่ `process_payment`)
2. ต้องรับ `reason: string` parameter (required)
3. ห้าม `DELETE` — เปลี่ยนเป็น `UPDATE payments SET status='voided', voided_by=..., void_reason=...`
4. Insert record ใน `payment_adjustments` (type='void')
5. เขียน audit log: `action='void_payment'`
6. ถ้า cashier ขอ → return `{ ok: false, requiresApproval: true }`

### 4.3 แก้ `reopenSessionForPayment()` — `lib/actions/history.ts`

ปัจจุบัน: ลบ payment แล้ว revert session, ไม่มี audit log, เช็คแค่ `process_payment`

เปลี่ยนเป็น:
1. เช็ค `payment:reopen` permission
2. ต้องรับ `reason: string` parameter (required)
3. Soft-void payment ก่อน (status='voided') แล้วค่อย revert session/table
4. เขียน audit log: `action='reopen_session'`

### 4.4 แก้ `processPayment()` — `lib/actions/pos.ts`

เพิ่ม:
1. ตรวจ active shift ของ cashier ก่อน process — ถ้าไม่มี shift เปิดอยู่ → error
2. เชื่อม `shiftId` ไปที่ payment record
3. Validate discount ไม่เกิน policy limit ตาม role

### 4.5 Server Actions ใหม่ที่ต้องสร้าง

```
lib/actions/shifts.ts
  openShift(openingFloat, branchId)       → cashier_shifts INSERT
  closeShift(shiftId, actualCash, reason) → UPDATE + คำนวณ cash_difference
  reviewShift(shiftId, reviewNotes)       → UPDATE status='reviewed'
  getActiveShift(cashierId)               → SELECT WHERE status='open'

lib/actions/discounts.ts
  requestDiscountApproval(sessionId, discountType, discountValue, reason)
  approveDiscountRequest(approvalId)
  rejectDiscountRequest(approvalId, reason)

lib/actions/voids.ts
  requestVoid(paymentId, reason)
  approveVoid(adjustmentId)
  rejectVoid(adjustmentId, reason)
```

---

## 5. Proposed UI Changes

### 5.1 Cashier Shift — `/pos` หน้าหลัก

**ShiftBanner component (ด้านบน PosTerminal):**
- แสดง: รอบที่ N | เปิดเมื่อ HH:mm | เงินทอนตั้งต้น ฿XXX
- ปุ่ม "ปิดรอบ" → modal กรอกเงินสดจริง + เหตุผล
- ถ้าไม่มีรอบเปิดอยู่ → OpenShiftModal บังคับก่อนเข้า POS

**`/pos/shifts` page (ใหม่):**
- ประวัติรอบทั้งหมด
- cash_difference แต่ละรอบ
- owner/manager กด "Review" + notes ได้

### 5.2 Void/Reopen — `/pos/history`

- cashier กด Void/Reopen → modal "ส่งขออนุมัติ" (กรอก reason)
- manager/owner กด → confirm + reason modal ปกติ
- badge สถานะ: pending approval / approved / rejected

### 5.3 Discount — PosTerminal

- cashier apply discount เกิน limit → toast "ส่วนลดเกินสิทธิ์ ขออนุมัติจาก Manager"
- สร้าง pending approval record
- Manager เห็น notification badge บน `/pos`

### 5.4 Audit Log — `/reports/audit` (ใหม่, owner only)

- Filter: action type, user, date range
- Columns: เวลา, ผู้ทำ, action, entity, before/after
- Export CSV

---

## 6. Migration Risk

| Risk | ระดับ | วิธีรับมือ |
|------|-------|------------|
| ADD COLUMN `status` ใน `payments` (DEFAULT 'completed') | LOW | Online alter, ข้อมูลเก่าได้ 'completed' อัตโนมัติ |
| ADD COLUMN `shift_id` FK nullable ใน `payments` | LOW | Nullable FK ไม่กระทบข้อมูลเก่า (shift_id = NULL) |
| เอา `kitchen` ออกจาก `manage_tables` | MEDIUM | kitchen ที่ login อยู่เห็น UI หายไปทันที ต้องแจ้งล่วงหน้า |
| บังคับ active shift ก่อน processPayment | HIGH | ถ้าไม่เปิดรอบ รับเงินไม่ได้ — ต้องเทรน staff ก่อน deploy |
| soft void แทน hard delete | MEDIUM | queries ที่ดึง payments ต้อง filter `status != 'voided'` |

---

## 7. Exact Implementation Order

```
Step 1  — ปิด Public API                                    (~30 min, zero DB change)
          1a. เพิ่ม auth guard ใน /api/print/network/route.ts
          1b. เพิ่ม auth guard + NODE_ENV check ใน /api/debug/db-rtt/route.ts
          1c. deploy + smoke test ทันที

Step 2  — เพิ่ม permissions ใน permissions.ts               (~1 hr, zero DB change)
          2a. เพิ่ม action strings ใหม่ทั้งหมด
          2b. กำหนด role matrix ตาม section 2
          2c. เอา kitchen ออกจาก manage_tables
          ⚠️ แจ้ง kitchen staff ล่วงหน้าก่อน deploy

Step 3  — DB migration                                       (~1 hr)
          3a. CREATE TABLE cashier_shifts
          3b. CREATE TABLE payment_adjustments
          3c. CREATE TABLE discount_approvals
          3d. ALTER TABLE payments: status, shift_id, voided_at, voided_by, void_reason
          ⚠️ backup Neon DB ก่อน run migration

Step 4  — แก้ existing actions                               (~2 hr)
          4a. history.ts: soft void + audit log ใน deletePaymentRecord
          4b. history.ts: audit log ใน reopenSessionForPayment
          4c. pos.ts: processPayment เช็ค active shift + link shiftId

Step 5  — สร้าง shift actions                               (~2 hr)
          5a. lib/actions/shifts.ts (openShift, closeShift, reviewShift, getActiveShift)
          5b. lib/validations/shifts.ts (Zod schemas)

Step 6  — สร้าง void/discount approval flow                  (~3 hr)
          6a. lib/actions/voids.ts
          6b. lib/actions/discounts.ts
          6c. lib/validations/voids.ts + discounts.ts

Step 7  — UI: Cashier Shift                                  (~3 hr)
          7a. ShiftBanner component
          7b. OpenShiftModal
          7c. CloseShiftModal
          7d. /pos/shifts page

Step 8  — UI: Void/Discount Approval                         (~2 hr)
          8a. แก้ void/reopen buttons ใน /pos/history
          8b. DiscountApprovalBadge + manager notification
          8c. Approval modal สำหรับ manager/owner

Step 9  — Audit Log UI                                       (~2 hr)
          9a. /reports/audit page (owner only)
          9b. Filter, table, CSV export

Step 10 — QA + E2E test ทุก role
```

**ประมาณเวลารวม:** ~16–18 ชั่วโมง (แยก deploy ได้หลัง Step 1 และหลัง Step 4)

---

## 8. Tests ที่ควรเพิ่ม

### Unit Tests — `lib/auth/permissions.ts`

```
✓ cashier ไม่ได้ payment:void
✓ manager ได้ payment:void
✓ owner ได้ payment:delete
✓ kitchen ไม่ได้ manage_tables (หลัง Step 2)
✓ cashier ได้ discount:apply เฉพาะไม่เกิน limit
```

### Integration Tests — server actions

```
✓ deletePaymentRecord → soft void ไม่ hard delete
✓ deletePaymentRecord → เขียน audit log action='void_payment'
✓ reopenSessionForPayment → เขียน audit log action='reopen_session'
✓ processPayment โดยไม่มี active shift → error
✓ processPayment กับ active shift → payment.shift_id ถูก set
✓ discount เกิน limit → return requiresApproval: true
✓ void จาก cashier → return requiresApproval: true
```

### E2E Scenarios

```
✓ cashier เปิดรอบ → รับเงิน → ปิดรอบ → กรอก actual cash → owner review
✓ cashier ขอ discount 30% → manager เห็น notification → approve → discount ใช้ได้
✓ cashier พยายาม void → ระบบปฏิเสธ → ส่งขออนุมัติ → manager approve → session เปิด
✓ GET /api/print/network (no token) → 401
✓ GET /api/debug/db-rtt (no token) → 401
✓ GET /api/debug/db-rtt (production, owner token) → 404
```

---

## 9. สิ่งที่ห้ามแตะใน Phase 1

| สิ่งที่ห้ามแตะ | เหตุผล |
|----------------|--------|
| `processPayment()` core logic (idempotency, split, loyalty) | ทำงานดีแล้ว การแตะอาจทำให้ชำระเงินผิดพลาด |
| Customer QR ordering flow (`/t/[tableToken]`) | Phase 1 เน้น staff-side เท่านั้น |
| Schema เก่าทั้งหมด (alter only, never drop columns) | backward compat กับ data ที่มีอยู่ |
| Auth.js JWT session structure | ถ้าเปลี่ยน field ต้องให้ทุกคน re-login พร้อมกัน |
| KDS polling flow | ไม่เกี่ยวกับการเงิน |
| Loyalty points calculation | ไม่อยู่ใน scope Phase 1 |
| `lib/db/seed.ts` | seed guard ป้องกันอยู่แล้ว |
| `proxy.ts` middleware matcher | เปลี่ยนอาจ expose routes โดยไม่ตั้งใจ |
| Report CSV export (ของเดิม) | อย่าแตะจนกว่า audit log UI พร้อม |

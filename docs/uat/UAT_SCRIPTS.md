# Lum Him Khue ERP — Manual UAT Scripts (Phase 16F)

> **Purpose:** human-executable acceptance tests for the Phase 16 hardening (16B idempotency,
> 16C atomic money writes, 16C-C3 tax invoice race fix) plus smoke tests for the rest of the app.
> **Environment:** dev server (`npm run dev`) against the checked database, or a Neon branch.
> ⚠️ The current `DATABASE_URL` contains real service data — use a dedicated **test table**
> (e.g. create table "TEST") and delete test payments afterwards via the (fixed) delete flow.
> **After every block:** run `npm run reconcile:payments` — expected: 0 critical, 0 high
> (the known R7a legacy WARN with 6 rows is acceptable and should not grow).
>
> Seed logins: `owner@shabu.local` / `cashier@shabu.local` / `kitchen@shabu.local`
> / `host@shabu.local` (all `password123`).
> Record results in the Pass/Fail and Notes columns; sign and date the bottom.

---

## Block A — POS payment core (16B + 16C-C1)

| ID | Setup | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|---|
| A-01 open + guests | Test table available; cashier logged in; shift open | Tables → open test table → add 2 adults (266) + 1 child (159) + 1 free type if configured → save | Session opens, table occupied, saved bill = ฿691; POS card shows ฿691 | | |
| A-02 addon + save | A-01 session active | POS → session → add 1 addon (e.g. ฿25) → บันทึก | Toast บันทึกแล้ว; POS card total = ฿716; reopening the panel shows the addon quantity restored | | |
| A-03 penalty | **Only if** `db:check-migrations` shows penalty enum APPLIED; a ค่าปรับ tile exists | Add penalty tile ฿50 to the bill → save | Total = ฿766; penalty appears as positive charge line | ☐ skipped (enum pending) | |
| A-04 full QR payment | A-02 bill saved (use a fresh session) | ชำระเงิน → full/close-all → QR PromptPay row for the full amount → confirm | Success screen; exactly 1 payment + 1 payment_row; session → paid; table → paid; receipt auto-prints once | | |
| A-05 full cash | Fresh session, bill ฿532 | Cash row, tendered ฿1000 → confirm | Change ฿468 shown and on receipt; 1 payment, 1 cash row (amount 532, tendered 1000, change 468) | | |
| A-06 split QR+cash | Fresh session, bill ฿691 | Row 1: QR ฿400 (account A) → Row 2: cash ฿291 → confirm | 1 payment, 2 payment_rows; sum = ฿691 | | |
| A-07 account lock | During A-06 style checkout | Try adding row 1 on บัญชี A and row 2 on บัญชี B | Rejected: "รอบชำระเดียวกันต้องใช้บัญชีรับเงินเดียวกัน" | | |
| A-08 double-tap | Fresh session ready to pay | Tap the confirm button twice as fast as possible | Exactly 1 payment; second tap is a no-op (or shows "รายการชำระนี้ถูกบันทึกแล้ว"); **no second auto-print** | | |
| A-09 item/partial | Fresh session, 2 adults + 1 child saved | ชำระตามรายการ → select 1 adult only → pay ฿266 → then close-all for remainder | Partial payment recorded (remaining ฿425 shown); final closes exactly; allocations cover all heads | | |
| A-10 reconcile | After A-block | `npm run reconcile:payments` | PASSED; R1–R6 clean; R7a count unchanged | | |

## Block B — Payment delete/reopen (16C-C2A)

| ID | Setup | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|---|
| B-01 delete final payment | A-04 payment exists; **owner** login | POS history → delete payment → enter reason | Payment + rows + line items + allocations all gone; session state per rule (closed, or closing if balance remains); adjustment ledger row exists with snapshot | | |
| B-02 delete WITH allocations | A-09 style payment (has allocations) | Delete it as owner | **No FK error** (this was the fixed bug); full delete; allocations preserved inside the adjustment snapshot | | |
| B-03 reopen | A-06 payment exists; owner/manager | Reopen session for payment | Payment removed, session → closing, table → occupied; POS shows the bill again | | |
| B-04 reason required | Payment inside a **closed** shift | Attempt delete without reason | Blocked: ต้องระบุเหตุผล; with reason (owner) succeeds; manager blocked on closed shift | | |
| B-05 cashier blocked | Cashier login | Attempt delete/reopen | Blocked (owner-only delete / owner+manager reopen) | | |
| B-06 audit preserved | After B-01/B-02 | Reports → audit + payment adjustments report | delete/reopen actions present with actor, reason, snapshot | | |
| B-07 reconcile | After B-block | `npm run reconcile:payments` | PASSED; R2/R4a clean (no orphans from deletes) | | |

## Block C — Session/table flows (16C-C2B)

| ID | Setup | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|---|
| C-01 open session | Available test table | Open with 2 adults | Session active, table occupied, charge lines created — all together | | |
| C-02 open on occupied | Same table while occupied | Try opening again | Rejected "โต๊ะ … ไม่พร้อมใช้งาน"; **nothing mutated** | | |
| C-03 update guests | C-01 active | Change to 3 adults + add addon → save | Guest list AND charge lines update together; POS total matches | | |
| C-04 allocation guard | Session with a partially-paid head (A-09) | Try reducing paid guest type below paid count | Blocked: ไม่สามารถลดจำนวนต่ำกว่าจำนวนที่ชำระแล้ว; nothing changed | | |
| C-05 linked tables | Two available tables | Open with linked table | Parent active + child session on linked table (status linked); pay parent → both close | | |
| C-06 close + status | Paid session | Close/free table via tables UI | Table → available; no drift (R12) | | |
| C-07 reconcile | After C-block | `npm run reconcile:payments` | PASSED; R5/R12a/R12b clean | | |

## Block D — Tax invoice (16C-C3)

| ID | Setup | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|---|
| D-01 normal invoice | Session with tax invoice requested (company name/tax id entered) | Final payment | `sessions.tax_invoice_number` set; format `{prefix}{MMyy}{seq4}` (e.g. LHK07260001); receipt shows buyer info | | |
| D-02 rapid two-tab | Two browser tabs, two sessions both requesting tax invoice | Pay both finals as near-simultaneously as possible | Two **distinct** invoice numbers, sequential | ☐ keep minimal — burns 2 legal numbers | |
| D-03 reconcile R9 | After D-block | `npm run reconcile:payments` | R9 duplicate tax invoice numbers: PASS | | |

## Block E — Queue / KDS / QR ordering smoke

| ID | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| E-01 queue | Add walk-in → call → admit → seat to table | Statuses advance; queue history records it | | |
| E-02 QR order | Scan table QR (or open customer URL) → add items → order | Order appears on KDS within ~3s | | |
| E-03 KDS | Prepare → ready → served on the order | Status transitions; customer tracking page updates within ~10s | | |
| E-04 customer tracking | Customer orders page | Shows order timeline; no errors | | |

## Block F — Reports smoke (no accounting assertions beyond current behavior)

| ID | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| F-01 | /reports/revenue with today's range | Loads; KPI cards + collection table render; guest-count filter works (display-only) | | |
| F-02 | /reports/tables | Loads; today's test sessions visible | | |
| F-03 | /reports/queue | Loads; E-01 entry counted | | |
| F-04 | /reports/kitchen | Loads; E-02 items counted | | |
| F-05 | /reports/audit | Loads; A/B block actions present | | |

## Block G — Roles / permissions smoke

| ID | Login | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|---|
| G-01 owner | owner@shabu.local | Visit /dashboard, /reports/revenue, /hr, /pos | All accessible | | |
| G-02 manager | (create/assign if none) | Visit /pos (ok), /dashboard (blocked → unauthorized) | Role routes enforced | | |
| G-03 cashier | cashier@shabu.local | /pos ok; /reports blocked; delete payment blocked | Enforced | | |
| G-04 kitchen | kitchen@shabu.local | /kds ok; /pos blocked | Enforced | | |
| G-05 deactivated | Owner deactivates a test user | That user's login attempt | Login rejected | | |
| G-06 module removal | Owner removes `pos` from a cashier's allowedModules | Cashier visits /pos | Blocked on next navigation (fresh DB read) | | |

---

## Sign-off

| Block | Result | Tested by | Date |
|---|---|---|---|
| A POS payments | | | |
| B Delete/reopen | | | |
| C Session/tables | | | |
| D Tax invoice | | | |
| E Queue/KDS/QR | | | |
| F Reports | | | |
| G Roles | | | |

Final `npm run reconcile:payments` after the full pack: ☐ PASSED (0 critical / 0 high)

Cleanup: delete test payments (via B-flow), free the test table, note any burned tax-invoice numbers.

# Phase 16C-A — Money Write Transaction Strategy (Audit)

> **Status:** Audit complete (2026-07). No runtime behavior changed in this phase.
> **Scope of this doc:** evidence on the DB driver, inventory of multi-write actions,
> failure-mode analysis of `processPayment`, strategy options, recommendation, and the
> implementation/rollback plan for the next phases.

---

## 1. DB Driver Facts (verified in installed packages)

| Fact | Evidence |
|---|---|
| Current client is **`drizzle-orm/neon-http`** over `@neondatabase/serverless` `neon()` | `lib/db/index.ts` |
| `db.transaction()` **throws at runtime**: `"No transactions support in neon-http driver"` | `node_modules/drizzle-orm/neon-http/session.js` (`NeonHttpSession.transaction`, `NeonTransaction.transaction`) |
| `db.batch([...])` **IS supported** on neon-http and executes all statements via Neon's HTTP `transaction()` — a single **non-interactive but atomic** transaction | `node_modules/drizzle-orm/neon-http/session.js` line ~131 (`this.client.transaction(builtQueries)`) |
| `drizzle-orm/neon-serverless` (WebSocket `Pool`/`Client`) is **already installed** and implements real interactive transactions (`BEGIN`/`COMMIT`/`ROLLBACK` + savepoints) | `node_modules/drizzle-orm/neon-serverless/session.js` lines 178–210 |
| WebSocket driver needs a WebSocket constructor on **Node ≤ 21**; **Node ≥ 22 has a global WebSocket** (no `ws` package needed) | `@neondatabase/serverless` README |
| Local dev runs **Node v24** → no new dependency for a driver switch locally | `node -v` = v24.16.0 |
| Vercel: Node 22.x runtime → global WebSocket available; **must verify project runtime setting before any switch**. Edge runtime would need per-request connections (not currently used — server actions run on Node runtime) | Vercel + Neon docs (verify at implementation time) |
| No project code currently calls `db.transaction()` — the 3 grep hits are comments documenting the limitation (`orders.ts:85`, `history.ts:780`, `history.ts:985`) | grep |

**Conclusion:** two viable atomicity mechanisms exist **without installing anything**:
(a) `db.batch()` on the current driver, (b) a second Drizzle client on
`drizzle-orm/neon-serverless` for interactive transactions.

---

## 2. Multi-Write Action Inventory

"Writes" = sequential DB mutations that can partially fail (neon-http, no transaction).
Fire-and-forget `writeAuditLog` excluded (non-blocking by design).

### Critical — wrong money/payment/shift/session state possible

| Action (file) | Write sequence | Mid-failure result | Idempotency (16B) | Tx needed |
|---|---|---|---|---|
| `processPayment` (`pos.ts`) | 1 INSERT payments → 2 INSERT payment_rows (or legacy backfill) → 3 INSERT payment_allocations → 4 INSERT payment_line_items → 5 tax-invoice seq UPSERT + UPDATE sessions.taxInvoiceNumber → 6 UPDATE sessions status/closedAt (group) → 7 UPDATE tables status → 8 loyalty INSERT visit + UPDATE customers | See §3 matrix | Yes — same-key retry returns already-processed (+ best-effort row repair), but **does NOT resume steps 2–8** | **Yes** |
| `deletePaymentRecord` (`history.ts:711`) | 1 INSERT payment_adjustments (snapshot) → 2 DELETE payment_rows → 3 DELETE payment_line_items → 4 DELETE payments → 5 UPDATE sessions → 6 UPDATE tables | **Latent defect:** `payment_allocations.payment_id` is an enforced FK (`schema.ts:401`) and is **never deleted** → step 4 FK-violates on any allocation-bearing payment, leaving the payment stripped of rows/lineItems but undeletable | No | **Yes** (+ bug fix) |
| `reopenSessionForPayment` (`history.ts:903`) | Same pattern as delete (adjustment → deletes → session/table reopen) | Same FK defect; partial reopen possible | No | **Yes** (+ bug fix) |
| `updateSessionGuests` (`sessions.ts:364`) | 1 DELETE session_guests → 2 INSERT session_guests → 3 UPDATE charge lines (void) → 4..n per-item UPDATE/INSERT buffet_charge_lines | Canonical saved bill (charge lines) inconsistent with guests; since 1c5221f the charge-line total **is the payment subtotal** → wrong bill total possible | No | **Yes** |
| `openSession` (`sessions.ts:31`) | INSERT session → INSERT linked sessions → INSERT session_guests → INSERT charge lines → UPDATE tables (occupied/linked) | Has **manual compensating rollback** (deletes + table restore on failure, lines ~91–96) — best-effort, itself non-atomic | No | Yes (would replace hand-rolled rollback) |

### High — operational mismatch, recoverable

| Action | Writes | Mid-failure result |
|---|---|---|
| `closeSingleSession` / `moveSession` / `transferPrimary` / `createContinuationSession` (`sessions.ts`) | 2–4 UPDATEs/INSERTs (sessions + tables) | Table status out of sync with session; staff can repair via tables UI |
| `generateTaxInvoiceNumber` (`tax-invoice.ts`) | UPSERT counter, then **separate SELECT** of `lastNumber` | **Race defect:** two concurrent finals in the same month can read the same number → duplicate tax invoice numbers (legal document). Fix: use `.returning()` on the upsert. Single-statement, so a *transaction* isn't the fix — flagged for its own bug fix |
| `awardLoyaltyPoints` (`customers.ts:75`) | INSERT customer_visits → UPDATE customers | Points/visit mismatch; reconstructable from payments |
| `placeOrder` (`orders.ts:78`) | INSERT orders → INSERT order_items | Header-only order visible to KDS; customer retries |
| `receiveOrder` (`inventory.ts:983`) | INSERT goods_receipts → per-item INSERT receipt_items + UPDATE po_items + UPDATE ingredients (lastCost) → UPDATE purchase_orders.status | Partial receipt recorded; PO status may disagree with received quantities; affects future COGS inputs |

### Medium — admin/back-office, rare during service

| Action | Writes |
|---|---|
| `createPayrollCycle` (`hr.ts:444`) | INSERT cycle → loop INSERT payroll_items (partial cycle if interrupted; recoverable by delete/recreate) |
| `saveStockCount` (`inventory.ts:362`) | UPDATE/INSERT stock_counts → DELETE + INSERT stock_count_items |
| `updatePurchaseOrder` (`inventory.ts:915`) | UPDATE po → DELETE items → INSERT items (delete-then-insert gap) |
| `deleteStockCount`, `deleteEmployee`, HR deduction/absence ops | Correctly ordered child→parent deletes; 1–3 writes |

### Low — single-write or atomic-by-construction (no action needed)

`openShift` / `closeShift` / `reviewShift` (each **one** INSERT/UPDATE — verified `shifts.ts`),
all `queue.ts` actions (single UPDATE each), discount approvals (single INSERT/UPDATE),
menu/pricing/branch/user CRUD, `incrementReceiptCounter` (**race-safe**: single UPDATE
with CASE + `RETURNING`), `markBillPrinted`, `setTableAvailable`.

Note on `closeShift`: single write, but `expectedCash` is computed from a read then
written (check-then-act). A payment landing between read and write skews the snapshot
by that payment — reconciliation query R7 detects it; interactive tx or re-check would
eliminate it (16C-D).

---

## 3. processPayment Failure-Mode Matrix (post-16B)

Write order and what each interruption leaves behind:

| Fails at | DB state | Detected by | Recovery today |
|---|---|---|---|
| 1 INSERT payments | Nothing written — clean | — | Cashier retries (same key) |
| after 1, before 2 (rows) | Payment exists, **no payment_rows** → shift `expectedCash` (sums rows) undercounts vs payment history | R1 | Same-key retry → already-processed + `ensurePaymentRowsForLegacyPayment` backfills **one summary row** (multi-row split detail lost) |
| after 2, before 3 (allocations) | Item-mode "paid heads" tracking missing; per-line remaining wrong in head-mode UI | R4 | Manual; no auto-repair |
| after 4, before 6 (session close) | **Money fully recorded but session still `closing`, table occupied.** Same-key retry returns already-processed **without resuming the close** | R5 | Staff force-close via tables UI |
| at 5 (tax invoice) | Sequence incremented, session lacks number (skipped number — acceptable) or duplicate number under race (see §2) | R9 | Manual |
| after 6, before 7 (tables) | Session paid, table stuck non-available | R6 | Staff sets table available |
| at 8 (loyalty) | Payment complete; points not awarded | R8 | Manual credit |
| duplicate key conflict branch | `ON CONFLICT DO NOTHING` → 0 rows → winner's result returned, loser writes nothing after the insert. If the pre-generated flow (16C-C) is adopted, later batch statements FK-fail and the **whole batch rolls back** — clean | — | By design |
| two devices, **different keys**, same session | Both read the same `paidBefore` → both pass the balance guard in a ~100 ms window → **double full payment**. Idempotency keys do not help across devices | R3 | Only interactive tx (or DB-level guard) truly closes this — 16C-D |

Key 16B interaction: idempotency makes retries **safe** (never a second payment) but not
**complete** (a retry never resumes steps 2–8). Atomicity is what removes the partial
states entirely — that is 16C-B/C/D scope.

---

## 4. Strategy Options

### Option A — Full driver switch to `drizzle-orm/neon-serverless` (interactive transactions)

- **Change:** `lib/db/index.ts` swaps `neon()`/`neon-http` for `Pool` + `drizzle-orm/neon-serverless`; wrap the Critical actions in `db.transaction(async (tx) => …)`.
- **Dependencies:** none locally (Node 24) **if** Vercel runtime is Node ≥ 22; otherwise add `ws` + `neonConfig.webSocketConstructor` (needs explicit approval).
- **Files:** `lib/db/index.ts` + every Critical/High action that adopts `tx`.
- **Benefit:** real transactions everywhere, including read-inside-tx patterns (closes the two-device race and `closeShift` snapshot skew).
- **Risk: HIGH-MEDIUM.** Every query in the app changes transport (HTTP → WebSocket): different latency profile (connection setup per serverless invocation), different failure modes (socket drops), pool lifecycle in serverless. One config error affects **all** reads, not just money writes. No test harness exists yet (16D) to catch regressions.
- **Rollback:** revert `lib/db/index.ts` (single-file switch back) + revert `tx` wrappers; no schema involvement. Simple but only after incidents are noticed.

### Option B — Keep neon-http + fail-safe ordering + `db.batch()` + reconciliation

- **Change:** restructure Critical actions so all statements are computable up-front, then execute them in **one `db.batch([...])`** (atomic on the server). For `processPayment`: pre-generate the payment UUID server-side (`crypto.randomUUID()` — `payments.id` accepts explicit values), then batch statements 1–4 + 6–7 (+ `sessions.taxInvoiceNumber`). Tax-sequence increment runs *before* the batch (failure = skipped number, acceptable); loyalty runs *after* (recoverable).
- **Constraint:** batch statements cannot read earlier results — all values must be known before the batch. `processPayment` already computes everything before writing (verified), so this fits. Same for `updateSessionGuests`, delete/reopen flows, `openSession`.
- **What remains unsafe:** check-then-act races (two devices/different keys; `closeShift` snapshot) — batch is atomic but not interactive.
- **Risk: MEDIUM-LOW.** Zero driver/transport change; blast radius = only the rewritten actions; reads untouched.
- **Rollback:** revert the action file(s) — transport unchanged.

### Option C — Hybrid staged (reconciliation → batch-atomic money writes → optional driver switch after tests) ⭐ RECOMMENDED

1. **16C-B — Reconciliation first (read-only):** implement §5 queries as an owner-run script/report. Establishes a baseline (how much partial state already exists in prod) and becomes the verification tool for every later step. Also fixes nothing = zero risk.
2. **16C-C — Batch-atomic money writes (Option B mechanics)** on the current driver, in priority order: `processPayment` → `deletePaymentRecord`/`reopenSessionForPayment` (bundling the missing-allocations FK **bug fix**) → `updateSessionGuests` → `openSession`. Each verified with the reconciliation script + manual UAT.
3. **16C-D — Optional interactive-tx client, dual-client pattern (deferred until after 16D tests):** add a *second* Drizzle client (`neon-serverless` Pool) exported alongside the HTTP client, used **only** inside actions that need read-inside-transaction semantics (two-device race, `closeShift` snapshot). Reads and all other actions stay on neon-http. Do this only once the 16D money-math test harness exists to validate it.

### Recommendation and reasoning

**Option C.** It reaches the actual goal — atomic money writes — with the smallest
possible blast radius and no dependency/transport change, and it sequences the risky
transport work (16C-D) to *after* the test harness (16D) exists. Option A solves
slightly more (interactive races) but converts a payment-path fix into an all-queries
transport migration with no tests in place — exactly the kind of broad change the
hardening freeze exists to prevent. The two-device race that batch cannot fix is
low-likelihood (single-cashier operation is the norm) and is caught by reconciliation
R3 until 16C-D lands.

---

## 5. Reconciliation Query Plan (read-only — NOT implemented in this phase)

Proposed as `scripts/reconcile-payments.ts` (SELECT-only, prints findings) in 16C-B.
FK-impossible states (orphan payment_rows/allocations) are omitted — the constraints
already guarantee them.

| # | Check | Sketch |
|---|---|---|
| R1 | Completed payments with no payment_rows | `payments p LEFT JOIN payment_rows r ON r.payment_id = p.id WHERE p.status='completed' AND r.id IS NULL` |
| R2 | `sum(payment_rows.amount)` ≠ `payments.total` (completed, non-voided rows) | group + `HAVING` on cents mismatch |
| R3 | Session over-payment: `sum(payments.total)` > latest `bill_total_at_payment` per session | detects double-pay incl. two-device race |
| R4 | Payments with allocations expected but missing: sessions with non-voided charge lines fully paid via head-mode where allocated qty < line qty on paid sessions | join charge lines ↔ allocations |
| R5 | Fully-paid-but-open: sessions with `status IN ('active','closing')` where `sum(completed payments) ≥ bill_total_at_payment` of the latest final payment | stuck-session detector |
| R6 | Paid sessions whose table is not `paid`/`available` (and tables `paid` with no paid session) | session↔table status join |
| R7 | Completed **cash** payment_rows with `shift_id IS NULL` (or pointing at a shift closed before `paid_at`) | shift-linkage gaps affecting `expectedCash` |
| R8 | Final-paid sessions with `customer_id` but no `customer_visits` row | loyalty step lost |
| R9 | Duplicate `receipt_no` per day; duplicate `sessions.tax_invoice_number` | legal-number integrity |
| R10 | Payments with `idempotency_key IS NULL` after the 16B deploy date | legacy-caller detector, should trend to zero |

---

## 6. Implementation Phases, Safety, Rollback, UAT

### Phase sequence
| Phase | Content | Risk |
|---|---|---|
| 16C-B | Reconciliation script (read-only) + prod baseline run | None (SELECT-only) |
| 16C-C | `db.batch()` conversion of Critical actions + delete/reopen allocations FK bug fix + tax-invoice `.returning()` fix | Medium-low, per-action |
| 16D | Money-math test harness (unchanged from roadmap) | — |
| 16C-D (optional, after 16D) | Dual-client interactive tx for two-device race + `closeShift` snapshot | Medium |

### Driver/batch safety notes (for 16C-C/D)
- `db.batch()` needs no env/config change; it uses the existing HTTP endpoint.
- Dual-client (16C-D): same `DATABASE_URL`; Vercel Node runtime must be ≥ 22 **or** add `ws` (explicit approval needed); WebSocket adds ~1 connection RTT per invocation on tx-using actions only; verify Neon connection limits vs. serverless concurrency (Pool per invocation, `pool.end()` in `waitUntil`/finally).
- Never mix the two clients inside one logical operation.

### Rollback plans
- 16C-B: delete script — nothing else to roll back.
- 16C-C: `git revert` the per-action commit; transport/config unchanged; schema unchanged.
- 16C-D: remove the second client + revert wrapped actions; `lib/db/index.ts` HTTP client was never touched.

### Manual UAT after 16C-C (minimum)
1. Full QR payment → session paid, table paid, rows/allocations present (R1–R6 clean).
2. Item-mode partial then final close → allocations complete, session closes exactly once.
3. Split tender (QR+cash, account lock) → one payment, N rows, totals match (R2).
4. Delete a payment **with allocations** → payment, rows, lineItems, allocations all gone; adjustment ledger row present; session/table reopened correctly.
5. Reopen-for-payment flow → same integrity.
6. Kill network mid-payment (dev tools offline just after submit) → either nothing written or everything written; retry behaves per 16B; reconciliation script clean afterwards.
7. Tax-invoice final payment ×2 concurrent (two tabs) → distinct invoice numbers.

---

## 7. Latent Defects Found During Audit (fix in named phases, NOT here)

1. **`deletePaymentRecord` / `reopenSessionForPayment` never delete `payment_allocations`** — enforced FK makes the payments DELETE fail after rows/lineItems are already deleted. Any allocation-bearing payment is undeletable and ends half-stripped. → fix inside 16C-C batch conversion.
2. **`generateTaxInvoiceNumber` upsert-then-select race** → duplicate legal invoice numbers under concurrency. Fix: `.returning({ lastNumber })` on the upsert (single statement). → 16C-C.
3. `closeShift` expectedCash check-then-act snapshot skew (minor) → 16C-D or accept + R7.

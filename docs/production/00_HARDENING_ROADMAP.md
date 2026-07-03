# Phase 16 — Production Hardening Roadmap

> **Status:** Phase 16A (clean working tree + governance resync) complete.
> **Feature freeze:** ACTIVE. No new feature modules until Phase 16F is signed off.
> Companion doc: `01_PROTECTED_FILES_POLICY.md` (which files are frozen and how to unfreeze them).

---

## Why the Feature Freeze Is Active

A production-readiness audit (2026-07) found that the product surface is functionally complete
for a single-branch shabu restaurant — POS, Tables, Queue, KDS, Reports, Pricing Tiles,
multi-row Payments, Cashier Shifts, Receipt/Printer (incl. Android bridge), plus HR and
Inventory basics. Nothing needs rebuilding.

What is **not** ready is the safety layer around real money:

- money writes are not atomic,
- money math has zero automated tests,
- the production schema cannot be reproduced from the repo,
- governance docs had drifted three phases behind the code.

Every new feature added before these are fixed increases the surface that must be hardened
later. Therefore: **hardening first, features after Phase 16F.**

---

## Critical Risks (verified in code)

| # | Risk | Evidence | Consequence |
|---|---|---|---|
| 1 | **Non-atomic money writes** | DB client is Drizzle **neon-http** (`lib/db/index.ts`), which does not support `db.transaction()` (see comment in `lib/actions/orders.ts`). `processPayment` performs ~5 sequential writes: insert `payments` → `paymentRows` → `paymentAllocations` → `paymentLineItems` → update `sessions`. | A failure mid-sequence leaves orphaned payments, allocations without a closed session, or a paid session on an occupied table. Same exposure in shift close and session close. |
| 2 | **No automated money tests** | Playwright was removed in Phase 12.0 and nothing replaced it; zero `*.test.ts` files in the project. | Bill totals, VAT, change, mixed-payment splits, shift reconciliation, and payroll math are protected only by convention. |
| 3 | **No migration baseline** | `drizzle/` contains no SQL migrations. Schema state = accumulated `db:push` runs + 8 ad-hoc tsx scripts (`migrate_v12/v13`, phase1, payment-foundation, phase6b, phase8b1, phase15q, phase15bill). | Production schema is not reproducible; no record of which scripts ran against prod. New enum values (e.g. `tile_category = 'penalty'`) need a tracked migration path. |
| 4 | **Stale governance docs** | CLAUDE.md claimed "Phase 12, business logic frozen" while the repo was at Phase 15+ and "frozen" files were being edited. | Agents work from wrong constraints; freeze rules become unenforceable. (Fixed in 16A; must be kept in sync.) |
| 5 | **Double-submit / idempotency risk** | `processPayment` has no idempotency key; POS runs on touchscreens where double-taps are routine. | One checkout can plausibly record two payments. |

---

## Hardening Phases

Each phase below requires its own explicit phase prompt before work begins.

### Phase 16B — Payment Idempotency + Double-Submit Protection ✅ IMPLEMENTED (UAT pending)
- **Client** (`PosTerminal.tsx`): synchronous `submitLockRef` re-entry lock on all three
  submit paths (draft rows, legacy, split rounds) — closes the same-frame double-tap gap
  that `submitting` state alone cannot; per-attempt `idempotencyKey` (nanoid 24) kept
  across failures, rotated only after the server confirms the attempt; auto-print skipped
  and "รายการชำระนี้ถูกบันทึกแล้ว" shown on already-processed responses.
- **Server** (`processPayment`): early lookup by `idempotencyKey` returns the existing
  payment (`alreadyProcessed: true`) before any other guard; the insert uses
  `ON CONFLICT (idempotency_key) DO NOTHING` so a concurrent duplicate that races past
  the lookup cannot create a second `payments` row.
- **Migration** (`npm run db:migrate-phase16b` — **NOT YET RUN on any database**; required
  before running this code, POS payments fail without it):
  ```sql
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(64);
  CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uq ON payments (idempotency_key);
  ```
- **Known limit (16C scope):** writes after the payment insert (rows/allocations/session
  close) are still non-atomic. If they fail mid-sequence, a same-key retry returns
  already-processed and best-effort backfills payment rows via
  `ensurePaymentRowsForLegacyPayment` — durable atomicity arrives with transactions in 16C.
  Two *different* devices submitting the same session concurrently use different keys;
  the remaining-balance guard protects the sequential case, the concurrent race is 16C.

### Phase 16C — Money Write Transaction Strategy
- **16C-A (audit) ✅ COMPLETE** — see `02_TRANSACTION_STRATEGY.md` for the full evidence,
  inventory, failure-mode matrix, and options. Key findings:
  - `db.transaction()` throws on the current neon-http driver (verified in node_modules),
    but **`db.batch()` IS atomic** on neon-http (Neon HTTP non-interactive transaction) —
    real atomicity is available **without a driver change**.
  - `drizzle-orm/neon-serverless` (interactive tx) is already installed; Node ≥ 22 needs
    no `ws` dependency (local dev is Node 24; verify Vercel runtime before any switch).
  - Latent defects found: delete/reopen payment flows never delete `payment_allocations`
    (enforced FK → mid-sequence failure, payment left half-stripped); tax-invoice number
    generator has an upsert-then-select race (possible duplicate legal numbers).
- **Recommended path (Option C, staged):**
  - **16C-B ✅ IMPLEMENTED** — read-only reconciliation script `scripts/reconcile-payments.ts`
    (`npm run reconcile:payments`, checks R1–R12, exit 1 on critical/high findings; see
    `03_RECONCILIATION.md`). Run it against prod for a baseline before starting 16C-C.
  - **16C-C** — convert Critical money writes to atomic `db.batch()` on the current driver:
    - **16C-C1 ✅ IMPLEMENTED (UAT pending)** — `processPayment` write phase is one atomic
      `db.batch()`: payments + tender rows (draft or pre-resolved legacy row) + allocations
      (pre-generated ids) + line items + tax-invoice number + session/table close commit
      together or not at all. Duplicate idempotency key now aborts the whole batch via the
      unique index (23505) and returns the winner — same 16B behavior, cleaner mechanism.
      Remaining post-batch by design: loyalty award (recoverable), tax-invoice counter
      increment pre-batch (failure = skipped number, acceptable).
    - **16C-C2A ✅ IMPLEMENTED (UAT pending)** — `deletePaymentRecord` and
      `reopenSessionForPayment` are batch-atomic: adjustment ledger insert + child deletes
      (**now including `payment_allocations` — the latent FK bug is fixed**) + payment
      delete + session/table updates commit together or not at all. Delete-flow remaining
      balance is computed pre-batch by excluding the deleted payment (same result).
      Snapshots now also preserve allocations. Approach C upgraded: a ledger row exists
      iff the mutation actually committed.
    - **16C-C2B ✅ IMPLEMENTED (UAT pending)** — `updateSessionGuests` and `openSession`
      are batch-atomic. openSession pre-generates the session id; the hand-rolled
      compensating cleanup and post-insert verification counts (both non-atomicity
      mitigations) are replaced by the transaction. updateSessionGuests: guest
      delete/re-insert + every charge-line void/update/insert commit together — the
      canonical saved bill can no longer diverge from the guest list mid-write.
    - **16C-C3 ✅ IMPLEMENTED (UAT pending)** — `generateTaxInvoiceNumber` reads the
      incremented sequence from `RETURNING` on the atomic upsert itself; the separate
      SELECT that could race under concurrent finals (duplicate legal numbers) is gone.
      Invoice format and first/subsequent-of-month behavior unchanged.

  **All 16C-C sub-phases are implemented.** Remaining before 16C closes: manual UAT
  passes for C1/C2A/C2B/C3 and a production baseline run of `npm run reconcile:payments`.
  - **16D** — money math test harness (unchanged, before any transport change).
  - **16C-D (optional, after 16D)** — dual-client `neon-serverless` transactions only for
    read-inside-tx cases (two-device same-session race, closeShift snapshot).
- A full immediate driver switch (Option A) was evaluated and **not recommended** before
  the 16D test harness exists — it converts a payment-path fix into an all-queries
  transport migration with no safety net.

### Phase 16D — Money Math Test Harness ✅ IMPLEMENTED
- **Run: `npm run test:money`** — 70 tests, ~0.3s, no DB. Runner is Node's built-in
  `node:test` via the already-installed `tsx` — zero new dependencies.
- Pure money formulas extracted as golden-behavior copies into
  `lib/payments/money-math.ts` (+ `hasMixedAccountGroups` in `account-group.ts`) and the
  runtime actions (`pos.ts`, `foundation.ts`, `sessions.ts`, `shifts.ts`) now import them —
  tests exercise the real production formulas.
- Covered: bill totals/charge lines/penalty, discounts (percentage/fixed/loyalty, zero
  floor), split-tender cash/non-cash rules, remaining-balance & partial/final settlement
  rules, account A/B lock, shift expected-cash. Honest gaps (VAT in frozen receipt/report
  files, DB-coupled row validation, payroll) documented in `04_MONEY_TEST_HARNESS.md`.
- Run `test:money` alongside typecheck/lint/reconcile before any money-path merge.

### Phase 16E — Migration Baseline & Schema Governance ✅ IMPLEMENTED
- **`npm run db:check-migrations`** — read-only introspection that verifies every
  table/column/index/enum the current code needs, grouped by originating migration;
  **exit 1 blocks deploy** when a critical group is missing.
- Baseline verified 2026-07-03 against the current DATABASE_URL: **11/12 groups APPLIED**
  (v12 → 15BILL → 16B incl. `payments.idempotency_key`); the only gap is the
  `tile_category 'penalty'` enum value (WARNING — penalty tiles fail until applied;
  exact SQL documented, NOT executed).
- Governance: `docs/architecture/MIGRATIONS.md` — no `db:push` for production; every
  schema change = phase name + idempotent tsx script + Neon snapshot + run record +
  rollback notes + check-script group in the same commit. Full 9-script historical
  inventory with verified applied-status included.
- Note: retrofitting drizzle-kit SQL history was evaluated and deliberately skipped
  (high risk against a live DB, low value vs. the verifiable check above).

### Phase 16F — UAT + Go-Live Runbook ✅ DOCS COMPLETE (execution pending)
- `docs/uat/UAT_SCRIPTS.md` — executable UAT pack, blocks A–G (POS payments incl.
  double-tap/split/item-mode, delete/reopen incl. the fixed allocations case, session/table
  flows, tax invoice incl. two-tab race, queue/KDS/QR smoke, reports smoke, roles) with
  pass/fail columns, reconcile checkpoints after every block, and a sign-off table.
- `docs/ops/GO_LIVE_CHECKLIST.md` — gated: pre-push → migrations → deploy → rollback.
- `docs/ops/RUNBOOK.md` — Thai staff-facing daily operations (shifts, payments, print
  failures, stuck-payment procedure, daily close, สิ่งที่ห้ามทำ).
- `docs/ops/INCIDENT_PLAYBOOK.md` — 11 incidents with symptoms / actions / don'ts /
  commands / approval levels / recovery / audit steps.
- **Phase 16 is NOT closed yet.** Human gates: manual UAT execution (blocks A–D minimum),
  Vercel `DATABASE_URL` confirmation, penalty-enum decision. Push/deploy blocked until
  `GO_LIVE_CHECKLIST.md` Gate 1 is fully checked.

---

## Deferred (do not build during Phase 16)

- **Food Cost / COGS** — deferred until accounting, stock counting, and recipe costing are reliable.
- Multi-branch switching, loyalty redemption UI, table reservations UI, password reset,
  CSV/Excel export, queue wait-time estimates, KDS sounds, allergen/cooldown display
  (see `docs/reui-v2/06_MISSING_FEATURE_BACKLOG.md`).

---

## Exit Criteria for Phase 16 Overall

- Money writes are atomic (or provably recoverable) — 16C.
- Duplicate payments are impossible from UI double-submission — 16B.
- `npm test` exists and covers money math — 16D.
- Schema is reproducible from the repo and future changes are migration-tracked — 16E.
- UAT signed off with zero open critical/high bugs; runbook exists — 16F.

Only after all five may the feature backlog thaw (first candidate: POS inline discount-approval status display).

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
- **Recommended:** switch `lib/db/index.ts` from `drizzle-orm/neon-http` to the Neon
  WebSocket/Pool driver (`drizzle-orm/neon-serverless`) — same `@neondatabase/serverless`
  package, no new dependency — then wrap `processPayment`, `closeShift`, `closeSession`,
  `updateSessionGuests`, goods receipts, and payroll calculation in real transactions.
- **NOT started in 16A by design.** Driver change touches every query path and needs its own
  phase with full UAT.
- Fallback if driver change is rejected: fail-safe write ordering + orphan-detection
  reconciliation script.

### Phase 16D — Money Math Test Harness
- **NOT started in 16A by design** (no test framework installed yet — new dependency needs approval).
- Extract pure calculation logic (bill subtotal/discount/VAT, change, mixed-payment splits,
  shift expected-cash, payroll gross→net) into testable functions.
- Add a lightweight runner (e.g. vitest or `node:test`) and cover the extracted functions.
- `npm test` becomes part of the standard verification workflow next to typecheck/lint.

### Phase 16E — Migration Baseline
- Generate a Drizzle migration snapshot matching current production schema.
- Record which historical tsx migration scripts have run against prod (inventory in `docs/architecture/MIGRATIONS.md`).
- Adopt `db:generate` / `db:migrate` for all future schema changes; retire `db:push` for prod.
- Includes the pending migration for `tile_category` enum value `'penalty'`
  (`ALTER TYPE tile_category ADD VALUE 'penalty'`) — committed in code during 16A but **not yet applied to any database**.

### Phase 16F — UAT + Go-Live Runbook
- Full UAT scripts: happy-path service day ×3, payment edge cases (mixed, partial, void,
  refund, discount approval, linked tables), failure cases (printer offline, wifi loss
  mid-payment, double-tap), shift over/short, report-vs-hand-calculation checks.
- Ops runbook (open/close day, printer troubleshooting, "printed but not saved" recovery) — staff-readable, Thai.
- Go-live checklist (env, seeds, cron, backups/Neon PITR) + incident playbook.

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

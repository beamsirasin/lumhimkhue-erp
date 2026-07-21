# Schema Migrations — Governance & Inventory (Phase 16E)

> **Status check:** `npm run db:check-migrations` (READ-ONLY, exits 1 when the connected
> database is missing anything the current code requires — **deployment is blocked while
> that command fails against the target database**).

---

## 1. Current reality (honest history)

This project has **no drizzle-kit SQL migration history** (`drizzle/` is empty). The
production schema is the accumulation of:

1. dev-time `drizzle-kit push` runs (untracked), and
2. nine ad-hoc, hand-written tsx migration scripts in `lib/db/` (inventory in §3).

That worked while one person ran everything, but it means the schema cannot be rebuilt
from the repo alone. Phase 16E does **not** retrofit drizzle-kit history (high risk, low
value against a live DB); instead it makes the state **verifiable** (the check script)
and future changes **governed** (§2).

## 2. Policy from Phase 16E onward

- **`db:push` is banned for production.** Dev experimentation on a Neon branch is fine;
  the shared/production database only changes via a reviewed migration script.
- Every schema change ships as a **tsx migration script** in `lib/db/`
  (`migrate-phase<NN>.ts`, following the existing pattern: dotenv + raw `neon()`,
  idempotent statements — `IF NOT EXISTS` / `ON CONFLICT` / guarded checks), plus a
  `package.json` script entry (`db:migrate-phase<NN>`).
- A migration may only run against production with, in this order:
  1. the **phase name** authorizing it,
  2. a **Neon snapshot/branch** taken immediately before,
  3. the exact command, and afterwards
  4. a **run record** appended to §5 of this file (who/when/database/result), and
  5. `npm run db:check-migrations` + `npm run reconcile:payments` green afterwards.
- Every migration script's header must state **rollback notes** (what to restore from
  snapshot vs. what is safely reversible in place).
- The status check script (`scripts/check-migration-status.ts`) must be extended with the
  new requirement group **in the same commit** as the schema change — that is what turns
  the deploy gate on for it.

## 3. Historical migration inventory (all 9 scripts, verified 2026-07-03)

"Applied?" = verified by read-only introspection against the current `DATABASE_URL`
(`ep-noisy-sun-…/neondb`) via `db:check-migrations`.

| Script (`lib/db/`) | Purpose | Idempotent? | Applied? | Still needed? |
|---|---|---|---|---|
| `migrate_v12.ts` | Phase 12: table shapes/labels/positions, session_guests, drop packages/pricing columns | Partially (single transaction, some destructive DROPs) | ✅ yes | Historical only — never re-run (contains DROPs) |
| `migrate_v13.ts` | Phase 13: manager role, `tile_category`/`discount_type` enums, pricing_tiles (+data migration), parent_session_id, payment_line_items, reservations | Mostly guarded | ✅ yes | Historical only |
| `migrate-phase1-cash-control.ts` | cashier_shifts, discount_approvals, payment_adjustments (no-FK paymentId), payments status/void/shift columns, indexes | Guarded / safe-to-ignore-errors | ✅ yes | Historical only |
| `migrate-payment-foundation.ts` | payment_methods, receiving_accounts, payment_method_accounts, payment_rows + default seeds | Yes (tolerates already-exists) | ✅ yes | Keep — seeds defaults, re-runnable |
| `migrate-phase6b-partial-payments.ts` | payments settlement_type / bill_total_at_payment / paid_before / remaining_after + indexes | Yes (IF NOT EXISTS) | ✅ yes | Historical only |
| `migrate-phase8b1-buffet-charge-lines.ts` | buffet_charge_lines, payment_allocations, session_guests.unit_price + backfills | Yes (explicitly) | ✅ yes | Historical only |
| `migrate-phase15q.ts` | queue_status enum values (waiting_suitable_table/admitted/skipped/cancelled) + 9 queue_entries columns + backfill | Yes (IF NOT EXISTS + enum guards) | ✅ yes (columns AND enum values) | Historical only |
| `migrate-phase15bill.ts` | store_settings.bill_account_configs + Thai renames of default methods/accounts | Yes | ✅ yes | Historical only |
| `migrate-phase16b.ts` | payments.idempotency_key + unique index `payments_idempotency_key_uq` — **required for all 16B+ payment code** | Yes | ✅ yes (on this DB; verify per environment) | Keep — must run on any environment before deploying 16B+ code |

Related non-migration scripts: `scripts/backfill-payment-rows.ts` (one-time row backfill,
keep), `scripts/verify-payment-foundation.ts` (read-only verify), `scripts/reconcile-payments.ts`
(read-only, 16C-B), `scripts/check-migration-status.ts` (read-only, 16E), `scripts/archive/*`
(completed one-offs, reference only). `tax_invoice_sequence` and `sessions.tax_invoice_number`
arrived via dev-time `db:push` (no script) — present and verified.

## 4. Pending migrations

### 4.1 `tile_category` enum value `'penalty'` — PENDING (the only gap)

- **Introduced by:** Phase 16A commit `74f758a` (penalty pricing tiles). `lib/db/schema.ts`
  declares it; **the database does not have it** (verified: `db:check-migrations` WARNING).
- **Impact while missing:** deploy is safe; creating a ค่าปรับ tile in Pricing Tiles fails
  at insert time. Everything else works.
- **Exact plan (verified type name `tile_category` via `pg_type`/`pg_enum`) — NOT executed:**
  ```sql
  ALTER TYPE tile_category ADD VALUE IF NOT EXISTS 'penalty';
  ```
  Notes: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on older Postgres —
  run it as a single standalone statement; it is irreversible in place (removing an enum
  value requires type rebuild — rollback = Neon snapshot). Should be shipped as
  `lib/db/migrate-phase16e-penalty.ts` + `db:migrate-phase16e-penalty` when explicitly
  approved, then §5 updated and the check script's `penalty-tile-enum` group promoted.

### 4.2 `manager_approval_codes` table — APPLIED (Phase 17POS-AUTH-A1)

- **Introduced by:** Phase 17POS-AUTH-A1 (Manager Approval Code / รหัสอนุมัติ foundation).
  `lib/db/schema.ts` declares `managerApprovalCodes`. Applied via
  `npm run db:migrate-phase17pos-auth-a1` on the current `DATABASE_URL`
  (verified: `db:check-migrations` group `phase17pos-auth-a1-approval-codes` — APPLIED).
  If a different environment's database is targeted, run the same migration there first
  (after a snapshot) and re-verify with `db:check-migrations`.
- What it created: `CREATE TABLE IF NOT EXISTS manager_approval_codes` (status is
  `varchar`, not a pg enum — deliberately, to avoid the `ALTER TYPE ADD VALUE` friction
  documented in §4.1) + 4 `CREATE INDEX IF NOT EXISTS` statements. Fully idempotent,
  additive only, no data migration/backfill.
  Rollback: `DROP TABLE manager_approval_codes` — safe, loses only approval-code
  history, never payment/session data (nothing else FKs into this table).
- **Scope note:** A1 was foundation only (generate/revoke/view/audit). Phase 17POS-AUTH-A2
  wired code *consumption* into `updateSessionGuests` for saved guest-count edits only
  (reopen/delete payment explicitly deferred) using the `usedAt`/`usedByUserId`/
  `usedForAction`/`usedEntityType`/`usedEntityId` columns already reserved in this table —
  **no schema change was needed for A2, A2B, or A2C.** A2B changed which roles the gate
  applies to; A2C changed the self-approval policy (owner-only self-redeem). Both are
  application-level policy changes reusing the existing `generatedByUserId`/`usedByUserId`
  columns — no data model change.

### 4.3 `store_business_days` table — PENDING (Phase 17POS-AUTH-A5)

- **Introduced by:** Phase 17POS-AUTH-A5 (Store Day Closing). The table stores
  one row per Bangkok calendar date and records close/reopen approval ownership,
  timestamps, and reasons. A missing row means the date is open.
- **Required before deploy:** create a Neon snapshot, then run
  `npm run db:migrate-phase17pos-auth-a5` against the target `DATABASE_URL`
  and verify `phase17pos-auth-a5-store-business-days` with
  `npm run db:check-migrations`.
- The migration is additive and idempotent: one table, one unique index, one
  status index, and nullable foreign keys to users/approval-code history.
  It does not rewrite payment, session, or cashier-shift data.
- Rollback after disabling the A5 application code:
  `DROP TABLE store_business_days`. This removes only day-close history.

### 4.4 Phase 17A.1 procurement/stock integrity — PENDING, NOT RUN

- **Script:** `lib/db/migrate-phase17a-procurement-stock.ts`.
- **Dependency:** `store_business_days` from Phase 17POS-AUTH-A5 must exist first; the
  script aborts before mutation when that dependency is missing.
- **Safety:** a read-only preflight reports null/zero/positive planning prices, PO states,
  receipt rows, invalid quantities, and sample record IDs. Schema changes, backfills,
  constraints, and the migration-ledger write execute in one Neon transaction.
- **Conservative price backfill:** null/zero planning prices become pending; positive
  planning prices become estimated. A receipt becomes confirmed only when it already has
  a positive, provable actual receipt cost. Confirmed totals derive only from non-void
  receipt-level actual prices; historical quantities and physical counts are unchanged.
- **Cost metadata decision:** reviewed quantity snapshots are immutable. Late price
  confirmation recalculates only cached cost status/value/timestamp fields in one batched
  write with before/after audit evidence. The helper loads affected counts and receipts in
  bulk to avoid list-page N+1 queries.
- **Production status:** **not executed by Phase 17A/17A.1 implementation work**. A
  disposable PostgreSQL concurrency/migration run and manual UAT are required before an
  explicit staging migration approval. Never use the primary/shared Neon database for
  this verification.
- **Rollback:** disable the Phase 17A application code and restore the pre-run database
  snapshot. Do not drop confirmation history or restore NOT NULL constraints in place
  without first resolving pending-price/null-supplier rows.
### 4.4b Phase 17B inventory init & reorder draft — PENDING, NOT RUN

- **Script:** `lib/db/migrate-phase17b-inventory-init-reorder.ts` (`npm run db:migrate-phase17b`).
- **Dependency:** the Phase 17A.1 ledger key (`phase17a1_procurement_stock_integrity`) must be
  present in `app_migrations`; the script aborts before mutation otherwise.
- **Scope (additive only, no row values changed):**
  - `stock_counts.count_type varchar(16) NOT NULL DEFAULT 'daily'` + CHECK `('daily','initial_setup')`.
    Existing counts stay `daily`. `initial_setup` marks the first physical-truth count whose
    stored usage fields are all zero (`quantity_on_hand` = counted physical).
  - `purchase_orders.reorder_generation_key text` + unique index
    `purchase_orders_reorder_gen_key_uq` (NULLs distinct → manual/emergency POs unaffected).
    Idempotency tag `base_key:supplier_id` so a double "generate draft" click resolves to the
    already-created drafts instead of duplicating them.
  - `purchase_order_items.reorder_*` snapshot columns (all nullable): reviewed count date,
    physical stock, par level, on-time incoming, delayed incoming, recommended stock qty,
    recommended purchase qty. NULL on manually-entered lines; structural (never note-parsed).
- **Safety:** read-only preflight reports reviewed-count and PO counts. All DDL/backfill/
  constraint/ledger writes run in one Neon transaction; every statement is `IF NOT EXISTS`
  / idempotent and the ledger gate stops a rerun.
- **Production status:** **not executed by Phase 17B implementation work.** Requires a
  disposable PostgreSQL migration run + manual flow UAT before any staging approval. Never
  run against the primary/shared Neon database in this phase.
- **Rollback:** disable Phase 17B application code; the additive columns/index are inert when
  unused and may be left in place or dropped after restoring a pre-run snapshot.

### 4.5 `payments.idempotency_key` — applied here, **verify per environment**

- Applied on the current `DATABASE_URL` (verified). If the Vercel production deployment
  points at a **different** database, run `npm run db:migrate-phase16b` there (after a
  snapshot) **before** deploying any commit ≥ `1827806`, then run `db:check-migrations`
  against that URL.

## 5. Run records

| Date | Migration | Database | Run by | Result |
|---|---|---|---|---|
| ≤ 2026-07-01 | phases v12 → 15BILL + 16B (historical; exact dates unrecorded) | ep-noisy-sun-…/neondb | owner (pre-governance) | Verified applied via `db:check-migrations` 2026-07-03 |
| 2026-07-14 | `migrate-phase17pos-auth-a1.ts` (`manager_approval_codes`) | ep-noisy-sun-…/neondb | Claude (agent, explicit approval given) | Applied; verified via `db:check-migrations` same day |
| 2026-07-16 | `migrate-phase17ui-emp-dept.ts` (`employees.department`, additive text column) | ep-noisy-sun-…/neondb | Claude (agent, explicit approval given via AskUserQuestion) | Applied; `db:check-migrations` green (penalty-enum warning only, pre-existing) |
| 2026-07-16 | `migrate-phase17ui-hr-options.ts` (`hr_lookup_options` table + 2 indexes, additive) | ep-noisy-sun-…/neondb | Claude (agent, explicit approval given via AskUserQuestion) | Applied; `db:check-migrations` green (penalty-enum warning only, pre-existing) |
| 2026-07-16 | `migrate-phase17ui-emp-sort.ts` (`employees.sort_order`, additive integer column) | ep-noisy-sun-…/neondb | Claude (agent, explicit approval given via AskUserQuestion) | Applied; `db:check-migrations` green (penalty-enum warning only, pre-existing) |

*(Append a row here for every future production migration run.)*

## 6. Deploy gate

Before any push/deploy of this repo to an environment:

```bash
npm run db:check-migrations   # exit 0 required (warnings acceptable, read them)
npm run test:money            # 70/70
npm run reconcile:payments    # no critical/high
npm run typecheck && npm run lint
```

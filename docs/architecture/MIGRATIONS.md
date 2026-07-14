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

### 4.3 `payments.idempotency_key` — applied here, **verify per environment**

- Applied on the current `DATABASE_URL` (verified). If the Vercel production deployment
  points at a **different** database, run `npm run db:migrate-phase16b` there (after a
  snapshot) **before** deploying any commit ≥ `1827806`, then run `db:check-migrations`
  against that URL.

## 5. Run records

| Date | Migration | Database | Run by | Result |
|---|---|---|---|---|
| ≤ 2026-07-01 | phases v12 → 15BILL + 16B (historical; exact dates unrecorded) | ep-noisy-sun-…/neondb | owner (pre-governance) | Verified applied via `db:check-migrations` 2026-07-03 |
| 2026-07-14 | `migrate-phase17pos-auth-a1.ts` (`manager_approval_codes`) | ep-noisy-sun-…/neondb | Claude (agent, explicit approval given) | Applied; verified via `db:check-migrations` same day |

*(Append a row here for every future production migration run.)*

## 6. Deploy gate

Before any push/deploy of this repo to an environment:

```bash
npm run db:check-migrations   # exit 0 required (warnings acceptable, read them)
npm run test:money            # 70/70
npm run reconcile:payments    # no critical/high
npm run typecheck && npm run lint
```

# Payment Reconciliation (Phase 16C-B)

> **Script:** `scripts/reconcile-payments.ts` · **Run:** `npm run reconcile:payments`
> **READ-ONLY** — the script only SELECTs. It never repairs, migrates, or writes.
> It connects using `DATABASE_URL` from `.env.local` (raw neon HTTP client with explicit
> column lists, so it works whether or not the 16B idempotency migration has run).

---

## When to run

| Moment | Why |
|---|---|
| **Before 16C-C** (batch-atomic conversion) | Baseline: know which inconsistencies already exist so new ones are attributable |
| **After 16C-C** | Prove the conversion introduced no drift; partial-write findings should stop growing |
| **Before go-live** | Gate: must be clean (or all findings explained and accepted in writing) |
| **After any payment incident** | Printer failure mid-checkout, network loss, crash — verify DB state before trusting the day's numbers |
| **Daily during the first go-live week** | Early-warning while trust in the money path is being established |

## Exit codes & result policy

| Result | Meaning | Exit |
|---|---|---|
| `RECONCILIATION PASSED` | Every check PASS/SKIPPED | 0 |
| `RECONCILIATION PASSED WITH WARNINGS` | Only WARN-level findings (R7a null-shift cash, R10 migration-not-run) | **0** — warnings inform, they don't block; review them in the output |
| `RECONCILIATION FAILED` | ≥ 1 CRITICAL or HIGH finding | 1 |
| Script itself errored | e.g. no DATABASE_URL | 1 |

Individual check errors (e.g. a table missing on an old database) mark that check
`SKIPPED` with the error message instead of crashing the run.

## Severity definitions

- **CRITICAL** — money/legal-document state is wrong or untrustworthy (missing tender rows, total mismatches, double payment, duplicate tax invoice numbers).
- **HIGH** — operationally wrong and affects money-adjacent processes (shift attribution, allocation drift, status drift), recoverable with manual action.
- **WARN** — expected under current design or informational; watch trends.

## Checks

| # | What it finds | Severity | If it fails |
|---|---|---|---|
| R1 | Completed payments with zero `payment_rows` (tender breakdown lost — shift expectedCash undercounts) | CRITICAL | Verify payment is real (receipt/audit log) → backfill rows via `payments:backfill` logic |
| R2 | `payment_rows` with missing parent payment (FK should prevent) | CRITICAL | Investigate — indicates constraint bypass/corruption |
| R3 | `payments.total` ≠ Σ completed `payment_rows.amount` (tolerance ฿0.01 for satang rounding) | CRITICAL | Compare with printed receipt + audit log; fix rows in a supervised phase |
| R4a | Allocations referencing missing payment/session/charge line (FK-protected) | CRITICAL | Investigate |
| R4b | Payments with allocations where Σ allocations ≠ payment total (item-mode interrupted) | HIGH | Reconstruct allocations from receipt; head-mode remaining counts are wrong meanwhile |
| R5 | Completed FINAL payment (`remaining_after ≤ 0`) but session still active/closing — the session-close write was lost. Partials and active unpaid sessions are **not** flagged | CRITICAL | Force-close via tables UI after confirming no double charge |
| R6 | Σ payments > latest `bill_total_at_payment` (+฿0.01), or > 1 FINAL payment per session. Legacy rows with `bill_total_at_payment = 0` excluded (limitation) | CRITICAL | Likely pre-16B double submission — verify receipts, then void/refund via supervised fix |
| R7a | Completed **cash** rows with `shift_id NULL` | **WARN** (deviation from "High" — deliberate: `STRICT_SHIFT_CASH` is off and the system explicitly permits cash without an open shift, with a cashier toast) | Watch the trend; if it grows during service, retrain on shift-open or enable `STRICT_SHIFT_CASH` |
| R7b | Cash rows paid > 1 min after their linked shift **closed** (money attributed to an already-counted drawer) | HIGH | Review that shift's cash difference |
| R8 | Duplicate `receipt_no` within 300 days (numbers embed `ddMM` but no year → ~1-year repeats are expected wraparound, not flagged) | HIGH | Same-day duplicates = counter race or manual reuse — verify both receipts |
| R9 | Duplicate `sessions.tax_invoice_number` (sequential legal documents; 16C-A found a generator race) | CRITICAL | Notify owner/accountant; generator fix lands in 16C-C |
| R10 | Completed payments with NULL `idempotency_key` **after** 16B went live. Cutoff = earliest `paid_at` among payments that have a key. Pre-cutoff NULLs are legacy → ignored. Column missing → WARN "migration not run"; column present but no keys yet → SKIPPED | HIGH | Find the code path bypassing idempotency — every POS payment must send a key |
| R11 | Line items referencing missing payment/pricing tile. Amount re-validation is **not implemented** (percentage discounts + price snapshots make historical re-derivation unreliable — documented limitation) | CRITICAL | Investigate |
| R12a | Finished (paid/closed) primary session, table still `occupied`, no other live session on that table | HIGH | Free the table; frequent findings = lost table-update writes (16C-C) |
| R12b | Live (active/closing) primary session on an `available` table | HIGH | Re-occupy table or close session |

## Reading the output

Each check prints `PASS / FAIL / WARN / SKIPPED`, the finding count, an explanation,
up to 10 sample rows (ids/amounts/timestamps only — no customer names/phones), and a
suggested next action. The summary at the top counts checks (not rows) per severity.

## Boundaries

- The script **never fixes anything**. Repairs happen in supervised phases with their own
  prompts (16C-C for the atomicity causes; data fixes case-by-case).
- The two known latent bugs from 16C-A (delete/reopen missing-allocations FK failure,
  tax-invoice generator race) are **detected** here (R2/R4a aftermath, R9) but fixed in 16C-C.

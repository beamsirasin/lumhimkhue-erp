# Money Math Test Harness (Phase 16D)

> **Run:** `npm run test:money` (~0.3s, no DB, no env vars needed)
> **Runner:** Node's built-in `node:test` executed through the already-installed `tsx`
> — **zero new dependencies**. Vitest was considered and rejected for this phase because
> it would add a dependency (requires explicit approval) for no capability we need yet.

---

## What this is

Pure money calculations were extracted from the payment/session/shift actions into
**`lib/payments/money-math.ts`** (plus `hasMixedAccountGroups` in
`lib/payments/account-group.ts`) as **golden-behavior copies**: logic, error strings,
and rounding are byte-faithful to the original call sites, and the runtime actions now
import these helpers, so the tests exercise the *actual* production formulas — not copies.

Any future change to money behavior must keep `npm run test:money` green, or change the
tests knowingly in an approved phase.

## What is covered (70 tests)

| File | Rules |
|---|---|
| `tests/money/bill-total.test.ts` | Canonical subtotal (saved charge lines authoritative, legacy fallback), bill total zero-floor, charge-line totals (adult 266 / child 159 / free 0 / penalty 50, string prices, satang), addon amounts |
| `tests/money/discounts.test.ts` | Percentage vs fixed tile discounts (incl. null-type fallthrough), percentage base (`discountBaseSoFar`), loyalty points→baht, discounts can never make the bill negative, penalty is add-only |
| `tests/money/payment-rows.test.ts` | `toCents`/`fromCents` (satang, float artifacts, string/null inputs), cash tender rules (exact, overpay+change, short, missing tendered, wrong change), non-cash rules (no change allowed, tendered must equal amount, welfare behaves as non-cash), split QR+cash row-sum shape |
| `tests/money/remaining-balance.test.ts` | Prior-payment guards (none/partial/fully-paid/over-paid), final must equal remaining exactly, partial strictly below remaining, overpay always rejected, zero/negative rejected, partial→final sequence, legacy cash change |
| `tests/money/account-lock.test.ts` | `_a`/`_b` group derivation (bank + welfare), case-insensitivity, ungrouped exemption (`legacy_unknown`, `cash_drawer`), A+B mix rejected, welfare follows the same lock |
| `tests/money/shift-cash.test.ts` | `expectedCash = openingFloat + cashRows`, over/short difference, string float from DB, net-of-change semantics |

## What is NOT covered (honest gaps — do not assume coverage)

- **VAT math** — the VAT-included split (`total × vat / (100 + vat)`) lives in
  `lib/printer/thermal-layout.ts` (receipt rendering) and, in report form, in
  `lib/actions/reports/vat-report.ts`; PO VAT-added math lives in `lib/actions/inventory.ts`.
  All three files were off-limits this phase (receipts/reports/frozen). **Needs later
  extraction** in a phase allowed to touch them; testing an unwired copy would be fake coverage.
- **Which rows count** for shift cash (SQL filter: completed, cash-type, shift-linked) —
  only the pure formula is tested; the selection is validated operationally by R7a/R7b.
- **Row-sum-equals-total and requires-reference checks** — still inline in
  `validateCheckoutPaymentRowsForTotal` (DB-coupled per-row method/account resolution);
  only the tender rules were extractable safely.
- **allowOverpay flag semantics** per payment method (DB-driven, validated in foundation).
- Payroll, inventory receiving, and report aggregation math — out of 16D scope.
- Anything requiring the DB or concurrency (idempotency, batch atomicity) — that is
  covered by `npm run reconcile:payments` and manual UAT, not unit tests.

## Known limitations

- `toCents` is `Math.round(value × 100)` — half-away-from-zero on exact halves subject to
  float representation. This is **golden behavior**, locked as-is; do not "fix" rounding
  without an approved phase.
- Tests assert Thai/English error strings verbatim — renaming a message is a test change
  by design (those strings are cashier-facing behavior).

## Why E2E is deferred

Playwright was removed in Phase 12 and reintroducing browser E2E is explicitly out of
scope for hardening (heavy, flaky on POS touch flows, needs seeded DB state). The layered
strategy: unit tests (this harness) → read-only reconciliation (16C-B) → manual UAT
scripts (16F) cover correctness, integrity, and real-hardware behavior respectively.

## How this supports 16C and go-live

- 16C's batch-atomic rewrites moved code around the money formulas; this harness pins the
  formulas themselves so future refactors (incl. the optional 16C-D driver work) can't
  silently change totals.
- Run `npm run test:money` before every merge touching `lib/actions/pos.ts`,
  `lib/payments/*`, `lib/actions/sessions.ts`, or `lib/actions/shifts.ts` — alongside
  `typecheck`, `lint`, and `reconcile:payments`.

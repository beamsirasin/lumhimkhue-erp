# Protected Files Policy (Production Freeze)

> Effective from Phase 16A. Supersedes the "V2 Protected Files" freeze scope in spirit;
> the file lists in CLAUDE.md → "Protected Files — Production Freeze" are kept in sync with this doc.

The system handles real money on real restaurant hardware. The files below encode the
money path, the schema, and the receipt output. History shows freezes fail silently when
the rule is only "do not touch" — so this policy defines **how** a legitimate change gets in.

---

## High-Risk (Frozen) Files

### Money path
- `lib/db/schema.ts`
- `lib/actions/pos.ts` (processPayment, POS session data)
- `lib/actions/sessions.ts` (session lifecycle, updateSessionGuests, charge lines)
- `lib/actions/shifts.ts` (cashier shifts, cash reconciliation)
- `lib/actions/payment-settings.ts`, `lib/actions/discounts.ts`, `lib/actions/tax-invoice.ts`
- `lib/payments/foundation.ts`
- `lib/validations/pos.ts`, `lib/validations/pricing.ts` (input contracts for money actions)

### Receipt / printer
- `lib/printer/*` (escpos, bitmap, service, transports, templates)
- `lib/utils/billConfig.ts`
- `app/api/print/network/route.ts`
- `android-pos-app/` bridge protocol (the JS↔native print contract)

### Auth / infrastructure
- `lib/auth/config.ts`, `lib/auth/permissions.ts`, `proxy.ts`, `auth.ts`
- `lib/db/index.ts` (DB driver — changes only in Phase 16C)
- `package.json` dependencies, `next.config.ts`, `vercel.json`, `drizzle.config.ts`

### Report calculations
- `lib/actions/reports/*.ts` — calculation logic frozen. Additive, display-supporting
  queries (new SELECT-only fields) are allowed with justification; changing an existing
  computation is not.

---

## How to Change a Protected File

Every change to a file above requires an explicit phase prompt containing all four:

1. **Phase name** — e.g. "Phase 16B — Payment Idempotency". No drive-by edits from
   unrelated UI tasks.
2. **Reason** — the verified bug or hardening goal. "While I was in there" is not a reason.
3. **Verification** — at minimum `npm run typecheck` + `npm run lint` pass; once Phase 16D
   lands, `npm test` too. State explicitly whether business logic changed.
4. **Manual UAT steps** — concrete steps a human runs on the real app (e.g. "open table,
   save 2 adults + 1 addon, pay mixed cash+QR, verify receipt total and shift expected cash").

Additionally:

- Schema changes must ship with a tracked migration (Phase 16E workflow) — never rely on
  an untracked `db:push` for production.
- Money-path changes must be their own commit, not mixed with UI polish.
- If a working-tree change to a protected file is discovered without a phase record,
  stop and surface it (as in Phase 16A) rather than committing it silently alongside other work.

## What Does NOT Require This Process

- Admin UI zone changes that don't import from frozen action internals (display components,
  layout, styling) — normal V2 UI contract rules apply.
- Docs, seeds for local dev, `scripts/` utilities that only read data.
- Copy/label changes in client components (not in receipt builders).

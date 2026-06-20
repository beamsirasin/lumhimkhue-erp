# POS Payment Architecture Analysis Handoff

Use this file as a handoff prompt/context for the next GPT/Codex session. This is analysis only; no implementation has been done yet.

## A. Executive Summary

Current readiness: partially ready for a simple cashier flow, not ready for flexible payment/account reporting.

The app already has a strong POS surface, buffet guest pricing via `pricing_tiles`, cashier shifts, payment history, audit logs, and payment adjustment snapshots. However, the current payment model is not flexible enough for the target architecture because `payments.sessionId` is unique, so one session/bill can only have one stored payment row.

Biggest blockers:

- No `payment_methods`, `receiving_accounts`, or method-account mapping tables.
- No government welfare payment method.
- Split payment is simulated in UI and notes, not stored as separate payment rows.
- Receiving account is hardcoded as `main` / `secondary` UI state and saved only in `payments.notes`.
- Shift cash closing only counts `paymentMethod = 'cash'`, so `cash_qr` cash portions are missed.
- Reports sum `payments.total` by one enum method and cannot produce receiving-account or account x method matrix reports.
- Historical price snapshots for guest bill items are not preserved.

Recommended next step: implement a database/payment foundation phase first, keeping the existing POS flow intact while introducing payment rows, configurable methods, receiving accounts, and backward-compatible reporting.

## B. Current Architecture Map

Database/ORM:

- Drizzle ORM with PostgreSQL/Neon.
- Main schema: `lib/db/schema.ts`.
- Drizzle config: `drizzle.config.ts`.

POS:

- POS route: `app/(staff)/pos/page.tsx`.
- Main touchscreen UI: `components/staff/PosTerminal.tsx`.
- Shift banner: `components/staff/ShiftWidget.tsx`.
- Payment history: `app/(staff)/pos/history/page.tsx` and `components/staff/PaymentHistoryTable.tsx`.

Server actions:

- `lib/actions/pos.ts` handles POS reads and `processPayment`.
- `lib/actions/sessions.ts` opens/closes sessions and creates continuation sessions for partial split flows.
- `lib/actions/history.ts` handles payment history, delete/reopen, audit reports.
- `lib/actions/shifts.ts` handles cashier shifts.

Reports:

- `lib/actions/dashboard.ts`
- `lib/actions/reports/daily-closing.ts`
- `lib/actions/reports/vat-report.ts`
- `components/admin/ReportsPage.tsx`
- `components/admin/AuditReportPage.tsx`

Settings/admin:

- Store/bill settings exist at `/settings`.
- Pricing/guest master data exists at `/pricing-tiles`.
- No payment settings section currently exists.

Audit/history:

- `audit_logs` exists.
- `payment_adjustments` exists and stores snapshots for delete/reopen flows.
- Current delete/reopen hard-delete the live payment row after writing an adjustment snapshot.

## C. Relevant Files Found

Database/schema:

- `lib/db/schema.ts` - Drizzle schema for sessions, guests, payments, shifts, audit logs, adjustments.
- `drizzle.config.ts` - Drizzle config, PostgreSQL dialect.
- `lib/db/seed.ts` - default guest pricing tiles.
- `lib/db/migrate_v13.ts` - migration that created `pricing_tiles`.

POS checkout:

- `app/(staff)/pos/page.tsx` - POS route entrypoint.
- `components/staff/PosTerminal.tsx` - main bill/payment/split UI.
- `components/staff/ShiftWidget.tsx` - open/close shift UI.

Payment actions:

- `lib/actions/pos.ts` - `processPayment`.
- `lib/validations/pos.ts` - payment validation schema.
- `lib/actions/history.ts` - history, delete payment, reopen session.

Reports:

- `lib/actions/dashboard.ts`
- `lib/actions/reports/daily-closing.ts`
- `lib/actions/reports/vat-report.ts`
- `components/admin/ReportsPage.tsx`
- `components/admin/AuditReportPage.tsx`

Settings/admin:

- `app/(admin)/settings/page.tsx`
- `components/admin/StoreSettingsForm.tsx`
- `app/(admin)/pricing-tiles/page.tsx`
- `components/admin/PricingTilesPage.tsx`
- `lib/actions/pricing.ts`
- `lib/actions/store.ts`

Shift:

- `lib/actions/shifts.ts`
- `lib/validations/shifts.ts`
- `components/staff/ShiftsHistoryClient.tsx`
- `components/staff/ShiftHistoryTable.tsx`

Audit/history:

- `lib/actions/audit.ts`
- `lib/actions/history.ts`
- `app/(admin)/reports/audit/page.tsx`
- `components/staff/SessionDetailDialog.tsx`

## D. Current Data Model Analysis

`pricing_tiles`:

- Purpose: guest types, addons, discounts, loyalty tiles.
- Important fields: `code`, `name`, `category`, `price`, `vatRate`, `vatIncluded`, `sortOrder`, `isActive`.
- VAT included pricing: yes.
- Price snapshots: no; sessions reference live tile price.
- Risk: old bills can change if a pricing tile changes.

`sessions`:

- Purpose: table session, effectively current bill container.
- Important fields: `tableId`, `parentSessionId`, `status`, `closedAt`, `taxInvoiceRequested`, `billPrintedAt`.
- Supports multiple payments: no direct support.
- Risk: no dedicated `bills` table.

`session_guests`:

- Purpose: guest counts per session.
- Important fields: `sessionId`, `pricingTileId`, `quantity`.
- Supports price snapshots: no.
- Risk: historical totals depend on live `pricing_tiles`.

`orders` / `order_items`:

- Purpose: food orders and items.
- Important fields: `sessionId`, `menuItemId`, `itemName`, `quantity`, `status`.
- Price snapshots: partial name snapshot only; extra price comes from live menu item.

`payments`:

- Purpose: final payment record for a session.
- Important fields: `sessionId unique`, `subtotal`, `discount`, `total`, `paymentMethod`, `receivedAmount`, `changeAmount`, `processedBy`, `shiftId`, `status`, `voidedAt`.
- Supports multiple payments per bill: no.
- Supports payment method: partial enum only.
- Supports receiving account: no, only notes hack.
- Supports cashier/shift: yes via `processedBy` and nullable `shiftId`.
- Risk: `cash_qr` conflates two methods into one row.

`payment_line_items`:

- Purpose: checkout addons/discounts/loyalty applied to a payment.
- Important fields: `paymentId`, `pricingTileId`, `quantity`, `amount`.
- Risk: not full bill items; guest items are not stored here.

`cashier_shifts`:

- Purpose: cashier open/close/review cycle.
- Important fields: `cashierId`, `openedBy`, `closedBy`, `openingFloat`, `expectedCash`, `actualCash`, `cashDifference`, `reviewedBy`.
- Risk: expected cash only counts pure `cash` payments.

`payment_adjustments`:

- Purpose: audit snapshot for void/refund/delete/reopen.
- Important fields: `paymentId`, `sessionId`, `shiftId`, `type`, `amount`, `reason`, `paymentSnapshot`, `requestedBy`, `approvedBy`, `status`.
- Risk: `paymentId` intentionally has no FK because current flow deletes live payment rows.

`audit_logs`:

- Purpose: action audit trail.
- Risk: future payment/account events need richer structured metadata.

## E. Current POS Checkout Flow

1. `/pos` loads sessions through `getPosSessionsForPos`.
2. Cashier selects a session/table.
3. `getPosSessionDetail` calculates base guest amount from `session_guests` and current `pricing_tiles`.
4. Extra order amount comes from non-cancelled, non-buffet order items using live `menuItems.extraPrice`.
5. Cashier can edit guest counts, add addons/discounts, choose payment method.
6. Payment methods shown: QR PromptPay, cash, QR + cash.
7. Receiving account UI is hardcoded `main` / `secondary`.
8. `processPayment` inserts one payment row and marks sessions paid.
9. Receipt is printed.
10. Table/session can then be finished/closed.

Current limitations:

- No true multi-row payment ledger.
- No configurable methods/accounts.
- No welfare payment.
- No account validation.
- No payer labels.
- No paid/remaining fields based on payment rows.
- No partial paid status; partial split creates continuation sessions instead.
- Price/VAT snapshots are incomplete.

## F. Current Payment Flow

Where payment is created:

- `lib/actions/pos.ts` in `processPayment`.

What data is stored:

- One row in `payments`.
- Optional rows in `payment_line_items`.
- Payment method enum.
- Total/subtotal/discount/received/change.
- Cashier via `processedBy`.
- Shift via nullable `shiftId`.
- Account only as text inside `notes`.

Payment status:

- Once `processPayment` succeeds, session status becomes `paid`.
- There is no partial/remaining calculation from payment rows.

Split payment:

- UI supports split rounds.
- Database collapses rounds into one payment row.
- `cash_qr` stores a combined method and puts cash/QR details in notes or derived fields.

Partial payment:

- UI can shrink the current session to paid guests and create a continuation session for remaining guests.
- This is operationally useful but not a true partial payment on one bill.

Void/refund/edit:

- Edit/reopen and delete exist in `components/staff/SessionDetailDialog.tsx`.
- `deletePaymentRecord` and `reopenSessionForPayment` write `payment_adjustments`, then delete payment rows.
- No real refund flow found.
- No reason is collected in the current UI, despite actions accepting optional reason.

## G. Current Report Flow

Existing reports:

- Dashboard revenue and payment method breakdown.
- Reports page sales summary.
- Daily closing report.
- VAT report.
- Audit report.
- Shift report.
- Payment adjustment report.
- POS payment history.

Source of report data:

- Mostly `payments.total`, grouped by `payments.paymentMethod`.
- VAT report computes output VAT from payment totals.
- Shift close computes expected cash from payments linked to shift.

Problems:

- Reports are only accurate for the current one-row model.
- `cash_qr` cannot be separated cleanly into QR and cash.
- Receiving account reports do not exist.
- Welfare reports do not exist.
- Reports generally do not filter `payments.status = 'completed'`, so future soft void/refund rows would be overcounted unless fixed.
- If multiple payment rows are added, joins from payments to sessions/guests can overcount bills and guest counts unless carefully refactored.

## H. Current Settings/Admin Pattern

Existing settings pages:

- `/settings` for receipt/store settings.
- `/pricing-tiles` for guest/addon/discount/loyalty master data.

Best pattern to reuse:

- `PricingTilesPage` + `lib/actions/pricing.ts`.
- It uses server actions, Zod validation, `can()` permission guards, dialogs, enable/disable, sort order, and audit logs.

Recommended payment settings pattern:

- `lib/db/schema.ts` tables.
- `lib/validations/payment-settings.ts`.
- `lib/actions/payment-settings.ts`.
- `components/admin/PaymentSettingsPage.tsx`.
- Owner/manager guard, likely `manage_settings` or new payment-settings permission.
- Audit every create/update/disable/mapping change.

## I. Touchscreen POS UX Review

Current strengths:

- Large buttons.
- Large numpad.
- Quick cash amounts.
- Change display.
- Split-by-item/person rounds.
- Visible shift banner.

Weak points:

- Receiving account labels are hardcoded and not tied to valid payment methods.
- No welfare method.
- No explicit payment rows ledger on checkout.
- No paid/remaining summary for true multi-payment.
- Split rounds are collapsed when saved.
- Dangerous edit/delete actions do not require reason entry.
- Account selection is hidden later inside notes.

Recommended UI direction:

- Keep current two-panel layout and numpad.
- Replace hardcoded method enum buttons with configurable method buttons.
- Show receiving accounts filtered by selected method.
- Show added payment rows.
- Show paid and remaining totals.
- Add optional `payer_label`.
- Add welfare as a first-class method.
- Confirm void/remove payment rows with reason.

## J. Gap Analysis Table

| Area | Current state | Target state | Gap | Severity | Recommended fix | Likely files affected |
|---|---|---|---|---|---|---|
| Guest type pricing | `pricing_tiles` guest category | `guest_types` or equivalent active master data | Mostly exists | Medium | Reuse `pricing_tiles` or alias concept clearly | `schema.ts`, `pricing.ts`, `PricingTilesPage.tsx` |
| VAT included pricing | `vatRate`, `vatIncluded` on pricing tiles | VAT snapshots per bill item | Master only | High | Store VAT rate/net/vat snapshots on bill items | `schema.ts`, POS actions |
| Bill item price snapshots | Guest rows reference live price | Historical item snapshots | Missing | Critical | Add bill/bill item snapshot model or payment bill items | `schema.ts`, `pos.ts`, reports |
| Payment method model | enum on `payments` | configurable `payment_methods` | Hardcoded | High | Add table and seed defaults | `schema.ts`, new actions/UI |
| Receiving account model | hardcoded UI state saved in notes | `receiving_accounts` table | Missing | Critical | Add receiving account table | `schema.ts`, payment settings |
| Payment method/account mapping | none | mapping table | Missing | Critical | Add mapping and validation | `schema.ts`, payment actions |
| Multiple payment rows per bill | blocked by unique `payments.sessionId` | many payment rows per bill | Missing | Critical | Remove/replace unique model safely | `schema.ts`, migrations, reports |
| Partial payment | continuation-session workaround | bill status partially paid | Partial only | High | Add paid/remaining/status fields | `pos.ts`, schema |
| Split payment | UI rounds collapse to one row | separate payment rows | Partial | High | Save each payment row separately | `PosTerminal.tsx`, `pos.ts` |
| Split-by-person label | notes/continuation only | `payer_label` | Missing | Medium | Add optional label on payments | schema/UI |
| Cash tendered/change | exists for cash | per cash payment row | Partial | High | Store `amount_tendered` and `change_amount` per row | schema/actions |
| Government welfare payment | not present | method + welfare accounts | Missing | Critical | Add method type `welfare` and account restrictions | schema/settings/POS |
| Payment linked to cashier | `processedBy` | cashier on each payment row | Exists for one row | Medium | Preserve on new rows | `pos.ts` |
| Payment linked to shift | nullable `shiftId` | shift required where appropriate | Partial | High | Require/open shift policy and link every row | `pos.ts`, `shifts.ts` |
| Payment void/refund | adjustment snapshot + hard delete | status void/refund ledger | Partial/risky | High | Prefer soft void/refund rows and immutable adjustments | `history.ts`, reports |
| Payment audit log | exists but incomplete reason flow | full audit for all sensitive actions | Partial | High | Require reason, metadata, permissions | `history.ts`, `SessionDetailDialog.tsx` |
| Daily report by method | grouped by enum | grouped by payment method table | Partial | High | Report from completed payment rows | `dashboard.ts`, reports |
| Daily report by receiving account | none | account totals | Missing | Critical | Add account grouping reports | reports |
| Matrix account x method report | none | account x method matrix | Missing | Critical | Add query/UI | reports |
| Shift closing by account/method | cash-only expected | cash/QR/welfare by account | Missing | High | Shift report from payment rows grouped by method/account | `shifts.ts`, report UI |
| Dashboard integration | sums `payments.total` | bill and payment KPIs separated | Partial | Medium | Update dashboard queries | `dashboard.ts` |
| Admin payment settings | none | methods/accounts/mapping CRUD | Missing | High | Add settings pages/actions | new files, nav config |
| Touchscreen checkout UX | good base, wrong data model | row-based split payment UI | Partial | Medium | Extend current UI, avoid rewrite | `PosTerminal.tsx` |
| Permissions | granular payment permissions exist | settings and payment controls guarded | Partial | Medium | Add payment settings permissions; require reasons | `permissions.ts`, actions |
| Data migration/compatibility risk | one payment per session | multi-row payment ledger | Significant | Critical | Backfill existing payments into new structure carefully | migrations, scripts, reports |

## K. Recommended Phased Implementation Plan

### Phase 1: Database/payment foundation

- Goal: Add data structure for multiple payment rows, methods, receiving accounts, and mappings.
- Scope: Add tables; keep existing POS behavior working.
- Files likely affected: `lib/db/schema.ts`, migration files, `lib/db/seed.ts`, `scripts/*`, report actions.
- Database/model changes: add `payment_methods`, `receiving_accounts`, `payment_method_accounts`; introduce new payment-row structure or evolve `payments`; add `payer_label`, `amount_tendered`, `receiving_account_id`.
- Server actions/API: add validation helpers for method/account mapping.
- UI changes: none or minimal hidden compatibility.
- Risks: existing `payments.sessionId unique`, old reports overcounting, old data backfill.
- Verification: script comparing old payment totals to new migrated totals.
- Suggested tests: split payments sum to bill total, account mapping rejects invalid combinations, old payments still report same totals.

### Phase 2: POS checkout split payment UI

- Goal: Make checkout support multiple payment rows on touchscreen.
- Scope: Add payment-row add/remove flow, remaining amount, cash tender/change, welfare method.
- Files likely affected: `components/staff/PosTerminal.tsx`, `lib/actions/pos.ts`, `lib/validations/pos.ts`.
- Database/model changes: use new payment rows.
- Server actions/API: `addPayment`, `voidPaymentRow`, `finalizeBillIfPaid`.
- UI changes: method buttons, receiving account buttons, payment rows list, paid/remaining display.
- Risks: cashier confusion during transition.
- Verification: QR full, cash full, QR+cash split, welfare+QR uneven split.
- Suggested tests: no overpay, cash change correct, invalid welfare account rejected.

### Phase 3: Back-office Payment Settings

- Goal: Owner/manager can manage methods, accounts, mappings.
- Scope: CRUD pages for payment methods, receiving accounts, method-account mappings.
- Files likely affected: new `components/admin/PaymentSettingsPage.tsx`, new actions/validations, `components/shared/nav-config.ts`, admin route.
- Database/model changes: same Phase 1 tables.
- Server actions/API: create/update/toggle/reorder methods/accounts/mappings.
- UI changes: settings tabs.
- Risks: disabling a method/account used by old payments.
- Verification: inactive methods hidden from POS but historical reports still resolve names.
- Suggested tests: default mapping, duplicate code rejection, cannot delete used records.

### Phase 4: Reports/dashboard integration

- Goal: Reports read completed payment rows where money collection is reported.
- Scope: method report, receiving account report, matrix report, dashboard cards.
- Files likely affected: `lib/actions/dashboard.ts`, `lib/actions/reports/daily-closing.ts`, `components/admin/ReportsPage.tsx`.
- Database/model changes: none beyond Phase 1.
- Server actions/API: grouped report queries.
- UI changes: account/method tables and filters.
- Risks: joining payments to bill items can duplicate VAT/guest counts.
- Verification: one bill with three payments counts one bill but three payment rows.
- Suggested tests: voided payments excluded, account totals equal completed payment total.

### Phase 5: Shift closing/audit/fraud controls

- Goal: Reliable cashier shift closing by method/account.
- Scope: cash expected vs counted, QR expected by bank account, welfare expected by welfare account, void/refund logs.
- Files likely affected: `lib/actions/shifts.ts`, `components/staff/ShiftWidget.tsx`, `components/staff/ShiftHistoryTable.tsx`, `components/admin/AuditReportPage.tsx`, `lib/actions/history.ts`.
- Database/model changes: possibly shift close count rows by account/method.
- Server actions/API: close shift summary query, void/refund approval flow.
- UI changes: shift close report by account/method.
- Risks: old payments with null shift.
- Verification: shift totals equal payment rows linked to shift.
- Suggested tests: cash/QR split produces correct cash expected; void after shift close appears in audit.

### Phase 6: Touchscreen UI polish

- Goal: Make checkout fast and mistake-resistant on POS/tablet.
- Scope: larger controls, numpad refinements, quick amount buttons, landscape/tablet layout, confirmations.
- Files likely affected: `components/staff/PosTerminal.tsx`, shared UI components.
- Database/model changes: none.
- Server actions/API: none unless adding cashier presets.
- UI changes: dedicated payment rows panel, account filtering, warning states.
- Risks: too much UI change at once.
- Verification: manual cashier scenarios on desktop/tablet viewport.
- Suggested tests: Playwright checkout flows and responsive checks.

## L. Questions / Unknowns

- Should the future bill model be a new `bills` table, or should `sessions` remain the bill container?
- Should `pricing_tiles` remain the guest type source, or should guest types move to a dedicated `guest_types` table?
- Should existing `payments` be migrated into a new `bill_payments` table, or should `payments` be altered in place?
- Should old hard-deleted payment flows be replaced with soft void before or after multi-payment migration?
- Are Bank/Cash Account A/B actual bank accounts, cashier drawers, or reporting buckets?
- Should cash always require an open shift, or only warn as it does now?
- Should government welfare require a reference number/slip?
- Should partial payment keep one bill open, or is continuation-session behavior still desired for table operations?
- Should VAT be calculated from guest bill items only, or include addons/order extras as taxable line items too?

## M. Minimal Safe Next Implementation Prompt

Analyze the current payment architecture report above and propose a minimal Phase 1 implementation plan before editing code. Focus only on the database/payment foundation needed to support multiple payment rows, configurable payment methods, receiving accounts, and method-account mappings. Do not edit files until you have listed the exact schema changes, migration/backfill strategy, compatibility approach for existing `payments`, affected reports, validation rules, and verification scripts. Then wait for approval before implementation.


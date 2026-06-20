# Missing Feature Backlog

> Features identified during the V2 audit that are not yet built.
> These are NOT part of Phase 12 (V2 UI Revamp).
> They are logged here for future planning (Phase 13+).
> Do not implement these during V2 phases without explicit approval.

---

## UI / UX Gaps Found During Audit

| # | Area | Gap | Priority |
|---|---|---|---|
| 1 | Admin nav | `navLayout` (custom nav order per user) is never loaded at login — bug in `auth.ts` `authorize()` return | Medium |
| 2 | Dashboard | No low-stock alert count shown on dashboard StatCards | Medium |
| 3 | POS | No inline discount approval status display — cashier can't see pending discount requests | High |
| 4 | POS | Mixed payment UI (cash + QR) is present but UX could be improved | Medium |
| 5 | Queue | No estimated wait time calculation | Low |
| 6 | Queue | No queue count limit per session | Low |
| 7 | Customer | No allergen display on menu cards (field exists in schema but not shown) | Medium |
| 8 | Customer | No order cooldown timer display (cooldownSeconds field exists but timer not shown) | Medium |
| 9 | KDS | No station-level sound notification | Low |
| 10 | Reports | No Excel/CSV export for any report | Medium |
| 11 | Inventory | No automated reorder suggestion notifications | Low |
| 12 | HR | Payment proof upload exists but download/view is not accessible in UI | Low |
| 13 | Tables | No table reservation flow (reserved status exists in schema but no UI to set it) | Medium |
| 14 | Auth | Password reset flow (Resend is installed but not wired to any reset flow) | Medium |
| 15 | System | No branch-switching for multi-branch owners | High (future) |

---

## Business Logic Gaps

| # | Area | Gap |
|---|---|---|
| 1 | Payroll | WHT calculation formula not exposed in UI for verification |
| 2 | Inventory | `ingredients.yieldPercent` not shown in recipe costing UI |
| 3 | Payment | Partial payment (deposit) flow exists in schema but no dedicated POS UI |
| 4 | Loyalty | Customer loyalty points redemption exists in schema but no dedicated customer UI |
| 5 | Reports | P&L report uses recipe cost but ingredients without recipes are excluded from COGS |

---

## Technical Debt (Non-V2)

| # | Item |
|---|---|
| 1 | `navLayout` bug: never loaded at initial login (see AUDIT_POS_ARCHITECTURE.md in archive) |
| 2 | `lib/payments/display-labels.ts` — check if still used or can be removed |
| 3 | Migration scripts in `lib/db/migrate_*.ts` — consider moving to `scripts/migrations/` |
| 4 | `lib/perf.ts` — verify if used anywhere or can be removed |
| 5 | `app/(admin)/pricing/page.tsx` — legacy redirect, can be cleaned up |

---

## Notes

- This backlog is a living document. Add items here during V2 implementation when gaps are discovered.
- Do not attempt to fix items on this list during V2 UI phases — open a separate planning discussion first.
- Items marked High priority should be the first candidates for Phase 13.

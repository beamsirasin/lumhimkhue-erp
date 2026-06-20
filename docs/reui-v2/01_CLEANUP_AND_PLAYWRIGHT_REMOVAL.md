# Phase 12.0 — Cleanup & Playwright Removal

> **Status:** COMPLETE (2026-06-20)

---

## What Was Done

### Playwright Removal

| Action | File |
|---|---|
| Deleted | `playwright.config.ts` |
| Deleted | `tests/e2e/auth.spec.ts` |
| Deleted | `tests/e2e/fixtures.ts` |
| Deleted | `tests/e2e/inventory-hr.spec.ts` |
| Deleted | `tests/e2e/permissions-responsive-accessibility.spec.ts` |
| Deleted | `tests/e2e/pos-tables.spec.ts` |
| Deleted | `scripts/e2e-seed.ts` |
| Removed from `package.json` scripts | `e2e:seed`, `test:e2e`, `test:e2e:ui` |
| Removed from `package.json` devDependencies | `@playwright/test`, `@axe-core/playwright` |

**Rationale:** Playwright was installed but never wired to CI. No `.github/workflows/` exists. Tests were aspirational, not maintained. Removing them simplifies the dependency tree and eliminates ~2 MB of devDependencies. No production code depended on Playwright.

### Root Temp Files Deleted

| File | Reason |
|---|---|
| `verify_bill_temp.mjs` | One-off bill layout verify script, was left at root accidentally. Also imported Playwright. |
| `verify_render_temp.ts` | One-off receipt render test, left at root. |
| `C:UsersUserAppDataLocalTempverify_tables.mjs` | Windows temp path accidentally materialized as a filename in the project root. |
| `shabu-erp-prompt.md` | Original Thai-language project spec from the initial build prompt. Fully superseded by `CLAUDE.md`. |

### Root Audit Docs Moved to `docs/archive/`

| File | Was at |
|---|---|
| `AUDIT_POS_ARCHITECTURE.md` | root → `docs/archive/` |
| `PERFORMANCE_AUDIT.md` | root → `docs/archive/` |
| `PERFORMANCE_BASELINE.md` | root → `docs/archive/` |
| `POLLING_AUDIT.md` | root → `docs/archive/` |

### Old Docs Moved to `docs/archive/`

| File | Was at |
|---|---|
| `docs/reui-polish/*` (7 files) | `docs/reui-polish/` → `docs/archive/reui-polish/` |
| `docs/auth-navigation-architecture.md` | `docs/` → `docs/archive/` |
| `docs/phase1-cash-control-plan.md` | `docs/` → `docs/archive/` |
| `docs/pos-payment-architecture-analysis-for-gpt.md` | `docs/` → `docs/archive/` |

### Scripts Moved to `scripts/archive/`

These were not referenced by any `package.json` script:

| File |
|---|
| `scripts/audit-phase1-final.ts` |
| `scripts/audit-phase1-flow.ts` |
| `scripts/audit-phase1-shift-link.ts` |
| `scripts/audit-phase1-shifts.ts` |
| `scripts/verify-phase1-schema.ts` |
| `scripts/migrate-images.ts` |

**Not moved** (still referenced in package.json):
- `scripts/backfill-payment-rows.ts` → `payments:backfill`
- `scripts/verify-payment-foundation.ts` → `payments:verify`

### Config Files Updated

| File | Change |
|---|---|
| `.gitignore` | Added: `/playwright-report/`, `/test-results/`, `verify_*_temp.*` patterns |
| `eslint.config.mjs` | Removed: temp file ignore entries. Added: `scripts/archive/**`, `docs/archive/**` |
| `package.json` | Removed: 3 E2E scripts + 2 Playwright devDependencies |

### CLAUDE.md Rewritten

Full V2 rewrite. Major additions over V1:
- Phase 12 progress tracker
- V2 Design Philosophy section (updated from "ReUI Direction")
- V2 Admin Page Skeleton standard
- V2 Component Standards table (Sheet, EmptyState, Skeleton, StatCard rules)
- Full `components/ui/` inventory with role of each component
- V2 Protected Files list (critical / high-risk / infrastructure)
- Root Hygiene Rules section
- "Not installed / not used" updated: added `Playwright`

---

## Verification

After phase completion:
- `npm run typecheck` — passed ✅
- `npm run lint` — passed ✅
- No business logic files modified ✅
- No UI components modified ✅
- No schema modified ✅

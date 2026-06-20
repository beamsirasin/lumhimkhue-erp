# ReUI / shadcn Admin Polish — Master Plan

## Goal

Polish the ERP/POS webapp admin and back-office UI using the existing `components/ui` design-system primitives first, following the new `CLAUDE.md` rules.

This is **not** a full redesign and **not** a POS rewrite.

## Core Direction

- shadcn/ui remains the base UI system.
- ReUI is treated as a supplementary pattern/block source for admin/back-office/data-heavy pages.
- Prefer existing `components/ui` primitives before copying new ReUI components.
- Do not install dependencies unless explicitly approved.
- Do not migrate React/Tailwind.
- Do not change database schema.
- Do not change server actions.
- Do not change POS payment/session/table logic.

## Strictly Protected Areas

Do not modify unless a phase explicitly says so and the user approves:

```txt
components/staff/PosTerminal.tsx
app/(staff)/pos/*
lib/actions/pos.ts
lib/actions/sessions.ts
lib/actions/shifts.ts
lib/actions/tables.ts
lib/actions/history.ts
lib/db/schema.ts
lib/printer/*
package.json
package-lock.json
drizzle.config.ts
next.config.ts
```

## Recommended Execution Style

Do not do all pages in one giant commit.

Use this pattern:

```txt
1 phase = 1 small UI scope = 1 commit
```

For every phase:

```bash
git status --short
npm run typecheck
npm run lint
git diff --name-only
```

Only commit files that belong to that phase.

## Phase Order

| Phase | Scope | Risk | Why |
|---|---:|---:|---|
| Phase 1 | Payment Settings | Low-Medium | Data-heavy settings page, not checkout flow |
| Phase 2 | Cashier Shifts UI | Medium | Important finance/audit UI, but do not change shift logic |
| Phase 3 | Inventory Admin | Medium | Large admin CRUD area, good UI payoff |
| Phase 4 | HR & Payroll Admin | Medium | Data-heavy, forms/tables, owner-only |
| Phase 5 | Dashboard + Reports polish | Low-Medium | Visual consistency and KPI polish |
| Phase 6 | Final UI Consistency Audit | Low | Cleanup only, no business logic |

## Global Claude Code Prompt Prefix

Use this at the top of every phase prompt:

```txt
Read CLAUDE.md first.

Follow the ReUI/shadcn admin polish rules from CLAUDE.md.

This is a UI-only polish task.
Do not change business logic.
Do not change database schema.
Do not change server actions.
Do not change auth/module guards.
Do not install dependencies.
Do not migrate React or Tailwind.
Do not touch POS checkout/payment/session/table logic.
Do not touch printer logic.
Reuse existing components/ui primitives before copying anything new.

After changes:
- Run npm run typecheck
- Run npm run lint
- Report files changed
- Explicitly confirm: business logic changed: NO
```

## Commit Message Pattern

```txt
refactor(ui): polish <area> admin UI
```

Examples:

```txt
refactor(ui): polish payment settings admin UI
refactor(ui): polish cashier shifts UI
refactor(ui): polish inventory admin UI
```

## Final Success Criteria

The project should feel visually consistent across admin/back-office pages while preserving the special custom UX of:

- POS cashier
- KDS
- Queue
- Tables/floor plan
- Customer QR ordering

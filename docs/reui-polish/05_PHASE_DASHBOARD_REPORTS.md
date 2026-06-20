# Phase 5 — Dashboard & Reports UI Polish

## Target

Polish admin dashboard and reports pages.

Likely routes:

```txt
app/(admin)/dashboard
app/(admin)/reports
app/(admin)/reports/audit
```

Audit report already has first-pass polish. Do not redo it unless final consistency audit finds a real issue.

## Goal

Improve visual consistency for:

- KPI cards
- Charts
- Report hub
- Revenue panels
- Filter/date controls
- Empty/loading states
- Report tables

## Risk Level

Low-Medium.

Mostly visual, but reports are finance-sensitive. Do not alter query logic or calculations.

## Allowed UI Changes

Use existing primitives:

```txt
PageHeader
DataCard / SectionCard
StatCard
Table
StatusBadge
EmptyState
Skeleton
Tabs
Input
Label
Button
Select
```

Allowed changes:

- Improve page hierarchy.
- Make stat cards consistent.
- Improve report hub cards.
- Improve loading/empty states.
- Improve chart container consistency.
- Replace raw cards/tables with design-system components.

## Forbidden Changes

Do not change:

```txt
lib/actions/dashboard.ts
lib/actions/history.ts
lib/actions/reports/*
```

Do not alter:

- KPI calculations
- Revenue calculations
- VAT/WHT/SSF report logic
- Audit filters
- Payment method totals
- Date range behavior

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Target: Dashboard and reports UI polish.

Start with dashboard/report hub only. Do not modify report server actions.

Rules:
- UI layer only.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not change KPI, revenue, VAT, WHT, SSF, collection, or audit calculations.
- Do not install dependencies.
- Reuse existing components/ui primitives before adding anything new.
- Prefer PageHeader, DataCard/SectionCard, StatCard, Table, StatusBadge, EmptyState, Skeleton, Tabs, Input, Label, Button, Select if already available.
- Replace raw HTML containers/tables/buttons/empty states with existing design-system components where safe.
- Keep all existing data fetching, state, validations, and mutations unchanged.
- Add accessibility improvements where appropriate.

Before editing:
1. Locate dashboard and report hub page/component files.
2. List files you plan to modify.
3. Confirm no report/server action changes.

After editing:
- Run npm run typecheck.
- Run npm run lint.
- Show git diff --name-only.
- Summarize files changed.
- Explicitly confirm: business logic changed: NO.
```

## Verification Checklist

```txt
[ ] Dashboard still loads
[ ] KPI numbers unchanged
[ ] Charts still render
[ ] Report hub links still work
[ ] Audit report still works
[ ] No report action files changed
[ ] No schema changed
[ ] typecheck passes
[ ] lint has 0 errors
```

## Commit Message

```txt
refactor(ui): polish dashboard and reports UI
```

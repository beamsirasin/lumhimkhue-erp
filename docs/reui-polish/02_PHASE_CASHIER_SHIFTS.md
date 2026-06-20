# Phase 2 — Cashier Shifts UI Polish

## Target

Polish the cashier shift management UI.

Likely route:

```txt
app/(staff)/pos/shifts
```

Likely protected logic:

```txt
lib/actions/shifts.ts
lib/actions/pos.ts
lib/actions/history.ts
```

## Goal

Improve the UI for:

- Active shift summary
- Opening float
- Expected cash
- Actual cash
- Cash difference
- Shift history
- Review status
- Method/account breakdown
- Staleness warning after close

## Risk Level

Medium.

This page is finance/audit-sensitive. UI polish is okay, but shift calculations and server actions must not change.

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
Input
Label
Button
Dialog
Alert
```

Allowed changes:

- Improve layout and sections.
- Make cash difference visually clearer.
- Use `StatusBadge` for open/closed/reviewed/stale statuses.
- Improve shift history table readability.
- Improve empty/loading states.
- Improve confirmation dialogs if they already exist.

## Forbidden Changes

Do not change:

```txt
lib/actions/shifts.ts
lib/actions/pos.ts
lib/actions/history.ts
lib/db/schema.ts
components/staff/PosTerminal.tsx
```

Do not change:

- Expected cash calculation
- Actual cash save behavior
- Shift close/review logic
- Difference reason rules
- Shift status transitions
- Payment-row aggregation

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Target page: POS cashier shifts UI only.

This is a UI-only polish task for the shift management page, not POS checkout.

Rules:
- Do not change business logic.
- Do not change server actions.
- Do not change database schema.
- Do not change expected cash / actual cash / cashDifference calculations.
- Do not change shift open, close, or review behavior.
- Do not touch components/staff/PosTerminal.tsx.
- Do not touch lib/actions/shifts.ts unless you only inspect it.
- Do not install dependencies.
- Reuse existing components/ui primitives first.
- Prefer PageHeader, DataCard/SectionCard, StatCard, Table, StatusBadge, EmptyState, Skeleton, Alert, Input, Label, Button, Dialog if available.
- Replace raw markup only where safe.
- Keep all existing state, data fetching, validations, and mutations unchanged.
- Add accessibility improvements only where appropriate.

Before editing:
1. Locate the shift page/component files.
2. List files you plan to modify.
3. Confirm no business/server action changes.

After editing:
- Run npm run typecheck.
- Run npm run lint.
- Show git diff --name-only.
- Summarize files changed.
- Explicitly confirm: business logic changed: NO.
```

## Expected Files Changed

Ideally only UI page/component files.

Do not modify `lib/actions/shifts.ts`.

## Verification Checklist

```txt
[ ] Active shift still loads
[ ] Open shift still works
[ ] Close shift still works
[ ] Review shift still works
[ ] Expected cash unchanged
[ ] Actual cash unchanged
[ ] Difference reason behavior unchanged
[ ] typecheck passes
[ ] lint has 0 errors
[ ] no POS checkout component changed
```

## Commit Message

```txt
refactor(ui): polish cashier shifts UI
```

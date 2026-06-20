# Phase 4 — HR & Payroll UI Polish

## Target

Polish HR and payroll admin pages.

Likely routes:

```txt
app/(admin)/hr
app/(admin)/hr/employees
app/(admin)/hr/schedule
app/(admin)/hr/time
app/(admin)/hr/payroll
app/(admin)/hr/payroll/[id]
app/(admin)/hr/settings
```

## Goal

Improve HR/admin page consistency:

- Employee directory
- Schedule cycle UI
- Time entries
- Payroll list
- Payroll detail
- HR settings
- Status badges
- Empty/loading states
- Forms and dialogs

## Risk Level

Medium.

HR/payroll has sensitive calculations. Do not alter payroll math or server actions.

## Suggested Sub-phases

```txt
4A — employee directory polish
4B — schedule + time entry UI polish
4C — payroll list/detail UI polish
4D — HR settings UI polish
```

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
Select
Textarea
Alert
```

Allowed changes:

- Improve table layout/readability.
- Improve form grouping.
- Make payroll status and deduction display clearer.
- Improve empty/loading states.
- Use consistent badges and cards.

## Forbidden Changes

Do not change:

```txt
lib/actions/hr.ts
lib/db/schema.ts
```

Do not alter:

- Payroll calculation
- SSF calculation
- Withholding tax calculation
- Deduction logic
- Attendance/time logic
- Schedule unique constraints
- Payroll snapshots

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Target: HR & Payroll admin UI polish.

Start with only one safe sub-scope:
Phase 4A — employee directory UI.

Rules:
- UI layer only.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not change payroll calculation, SSF, WHT, deduction, schedule, or time-entry logic.
- Do not install dependencies.
- Reuse existing components/ui primitives before adding anything new.
- Prefer PageHeader, DataCard/SectionCard, StatCard, Table, StatusBadge, EmptyState, Skeleton, Input, Label, Button, Dialog, Select, Textarea if already available.
- Replace raw HTML containers/tables/buttons/empty states with existing design-system components where safe.
- Keep all existing data fetching, state, validations, and mutations unchanged.
- Add accessibility improvements where appropriate.

Before editing:
1. Locate HR employee directory page/component files.
2. List files you plan to modify.
3. Confirm no server actions or schema changes.

After editing:
- Run npm run typecheck.
- Run npm run lint.
- Show git diff --name-only.
- Summarize files changed.
- Explicitly confirm: business logic changed: NO.
```

## Verification Checklist

```txt
[ ] Employee list still loads
[ ] Employee create/edit still works
[ ] Schedule pages unaffected
[ ] Payroll pages unaffected unless targeted
[ ] No HR action file changed
[ ] No schema changed
[ ] typecheck passes
[ ] lint has 0 errors
```

## Commit Messages

```txt
refactor(ui): polish HR employee UI
refactor(ui): polish HR schedule and time UI
refactor(ui): polish payroll UI
refactor(ui): polish HR settings UI
```

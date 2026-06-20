# Phase 1 — Payment Settings UI Polish

## Target

Polish the staff/admin payment settings page.

Likely route:

```txt
app/(staff)/payment-settings
```

Likely components:

```txt
components/staff/*
components/admin/*
components/ui/*
```

Actual files must be discovered by Claude Code before editing.

## Goal

Improve layout consistency for:

- Payment methods
- Receiving accounts
- Payment method/account mappings
- Status badges
- Empty states
- Loading states
- Forms/dialogs if already present

## Why This Phase First

This page is important but is not the live POS checkout screen. It is a safer data-heavy page to continue the ReUI-style/shadcn polish after the audit report.

## Allowed UI Changes

Use existing primitives such as:

```txt
PageHeader
DataCard / SectionCard
Table
Tabs
StatusBadge
EmptyState
Skeleton
Input
Label
Button
Dialog
Select
Switch
```

Allowed changes:

- Replace raw div/card/table markup with existing UI primitives.
- Improve section hierarchy.
- Improve spacing and table readability.
- Replace hardcoded status colors with `StatusBadge` or CSS variable tokens.
- Add accessible labels/aria attributes.
- Add loading and empty states where missing.

## Forbidden Changes

Do not touch:

```txt
lib/actions/payment-settings.ts
lib/actions/pos.ts
lib/actions/history.ts
lib/db/schema.ts
components/staff/PosTerminal.tsx
package.json
package-lock.json
```

Do not change:

- Payment method behavior
- Receiving account behavior
- Default account mapping logic
- Validation rules
- Server action signatures
- Auth/module guards

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Continue the same safe admin UI polish approach used in components/admin/AuditReportPage.tsx.

Target page: payment-settings.

Rules:
- UI layer only.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not change auth/module guards.
- Do not touch POS payment processing, sessions, shifts, tables, KDS, queue, or printer logic.
- Do not install dependencies.
- Reuse existing components/ui primitives before adding anything new.
- Prefer PageHeader, DataCard/SectionCard, Table, Tabs, StatusBadge, EmptyState, Skeleton, Input, Label, Button, Dialog, Select, Switch if already available.
- Replace raw HTML containers/tables/buttons/empty states with existing design-system components where safe.
- Replace hardcoded status colors with CSS variable tokens or existing StatusBadge variants.
- Keep all existing data fetching, state, validations, and mutations unchanged.
- Add accessibility attributes only where appropriate.

Before editing:
1. Identify the route and component files for payment-settings.
2. Summarize what files you plan to modify.
3. Confirm you will not touch server actions or database schema.

After editing:
- Run npm run typecheck.
- Run npm run lint.
- Show git diff --name-only.
- Summarize files changed.
- Explicitly confirm: business logic changed: NO.
```

## Expected Files Changed

Ideally only 1–3 UI files.

Examples:

```txt
components/staff/PaymentSettingsPage.tsx
components/admin/PaymentSettingsPage.tsx
```

Avoid touching server action files.

## Verification Checklist

```txt
[ ] git diff --name-only contains only expected UI files
[ ] typecheck passes
[ ] lint has 0 errors
[ ] payment methods still load
[ ] receiving accounts still load
[ ] create/edit/toggle still works
[ ] default mappings still work
[ ] no POS checkout files changed
```

## Commit Message

```txt
refactor(ui): polish payment settings UI
```

# Phase 6 — Final UI Consistency Audit

## Target

Audit all admin/back-office polished pages for consistency.

Do not start new feature work in this phase.

## Goal

Find and fix small UI inconsistencies only:

- Spacing mismatch
- Mixed card styles
- Mixed table styles
- Hardcoded status colors
- Missing empty states
- Missing loading skeletons
- Inconsistent page headers
- Missing aria labels
- Inconsistent Thai labels

## Risk Level

Low, if kept to UI cleanup only.

## Scope

Allowed areas:

```txt
components/admin/*
components/ui/*
app/(admin)/*
app/(staff)/payment-settings
app/(staff)/pos/shifts
```

Avoid:

```txt
components/staff/PosTerminal.tsx
app/(staff)/pos main checkout flow
app/(staff)/kds
app/(staff)/queue
app/(staff)/tables
lib/actions/*
lib/db/schema.ts
lib/printer/*
package.json
package-lock.json
```

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Perform a final UI consistency audit for admin/back-office pages only.

Rules:
- UI cleanup only.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not change auth/module guards.
- Do not install dependencies.
- Do not touch POS checkout, KDS, Queue, Tables, customer QR, printer, payment processing, sessions, or shifts logic.
- Focus only on consistency of PageHeader, DataCard/SectionCard, Table, StatusBadge, EmptyState, Skeleton, Tabs, Input, Label, Button, Dialog usage.
- Replace remaining hardcoded status colors with StatusBadge or CSS variable tokens.
- Add missing aria-labels for icon-only buttons.
- Add missing empty/loading states only where simple and safe.
- Do not redesign layouts that already work.

Before editing:
1. List all candidate files.
2. Group proposed edits by risk.
3. Only apply low-risk UI consistency fixes.

After editing:
- Run npm run typecheck.
- Run npm run lint.
- Show git diff --name-only.
- Summarize files changed.
- Explicitly confirm: business logic changed: NO.
```

## Final Verification Checklist

```txt
[ ] git diff contains only UI files
[ ] no lib/actions files changed
[ ] no db schema changed
[ ] no package files changed
[ ] no POS checkout files changed
[ ] typecheck passes
[ ] lint has 0 errors
[ ] admin pages visually consistent
[ ] touch/POS pages remain custom and untouched
```

## Commit Message

```txt
refactor(ui): finalize admin UI consistency
```

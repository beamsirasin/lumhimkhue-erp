# Lum Him Khue ERP - Agent Instructions

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Read First

Before making changes, read:

- `CLAUDE.md`
- `docs/reui-v2/GPT_PROJECT_CONTEXT.md`
- `docs/reui-v2/02_DESIGN_SYSTEM.md`
- `docs/reui-v2/03_ADMIN_REVAMP.md`
- `docs/reui-v2/04_OPERATIONAL_REVAMP.md`
- `docs/reui-v2/05_CUSTOMER_REVAMP.md`

If `docs/reui-v2/08_UI_DEVELOPMENT_CONTRACT.md` exists in a future branch, read it as the mandatory UI contract before editing UI.

## Mandatory UI Rule

All new UI must follow the V2 UI Development Contract embodied in `CLAUDE.md` and the `docs/reui-v2/*` plans.

- Admin/back-office supports dark mode and must use premium SaaS V2/ReUI-inspired patterns.
- Staff POS/KDS/Tables/Queue must stay light-first with large touch targets.
- Customer QR must stay light-only and mobile-first.
- Auth/login should stay clean and light unless explicitly requested.
- Use existing shared components, `components/ui/*`, and CSS tokens.
- Avoid hardcoded Tailwind color families; prefer semantic tokens and existing variants.
- Do not add new dependencies unless explicitly approved.

## Business Logic Safety

Do not change business logic unless explicitly requested.

Protected areas:

- `lib/actions/*`
- `lib/db/schema.ts`
- payment/session/shift logic
- POS/KDS/Tables/Queue live behavior
- customer QR ordering/token/polling behavior
- printer core logic
- report calculations
- inventory/payroll calculations

## Standard Workflow

Before coding:

- Check the current branch.
- Inspect relevant files and docs.
- List intended files to modify.
- Identify no-touch business logic.

After coding:

- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `git diff --check`.
- Report changed files.
- State whether business logic changed.
- State whether admin/staff/customer theme rules were respected.

## Prompt Reminder

When adding or changing UI, follow this instruction:

> Follow the V2 UI Development Contract. New UI must use existing ReUI-inspired shared components and tokens. Admin supports dark mode; staff/customer stay light-first.

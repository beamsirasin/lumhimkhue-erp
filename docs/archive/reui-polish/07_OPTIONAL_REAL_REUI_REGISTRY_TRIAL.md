# Optional Phase 7 — Real ReUI Registry Trial

## Important

Do this only after Phases 1–6 are stable and committed.

This phase is optional. The project may already achieve enough polish using existing `components/ui` primitives.

## Goal

Evaluate whether copying any actual ReUI components/blocks into the project adds value beyond the existing shadcn/ui component set.

## When to Do This

Only if the existing design system lacks a specific reusable pattern, such as:

- Advanced data table filter bar
- Better date range selector
- Better stat card variants
- Advanced empty state
- Advanced settings layout

## Forbidden

Do not install a dependency blindly.

Do not migrate Tailwind or React.

Do not apply ReUI to POS/KDS/Tables/Queue.

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Optional ReUI trial.

Goal:
Evaluate whether copying a small ReUI-style component/block would improve admin/back-office pages beyond our existing components/ui.

Rules:
- Do not install dependencies.
- Do not migrate React.
- Do not migrate Tailwind.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not touch POS, KDS, Queue, Tables, customer QR, printer, payment processing, sessions, or shifts logic.
- Inspect existing components/ui first.
- If an existing component already covers the need, use that instead.
- If copying a ReUI-style component, copy it into components/ui or components/admin and adapt it to project CSS variables.
- Replace hardcoded colors with theme tokens.
- Keep it small: one component or one block only.

Before editing:
1. Identify the exact UI gap.
2. Explain why existing components/ui is not enough.
3. Propose one component/block to copy or adapt.
4. Ask for approval before making changes.

Do not make changes until I approve the exact component/block.
```

## Verification Checklist

```txt
[ ] Existing components/ui checked first
[ ] One component/block only
[ ] No package install
[ ] No Tailwind/React migration
[ ] CSS variables used
[ ] typecheck passes
[ ] lint has 0 errors
```

## Commit Message

```txt
feat(ui): add reusable admin UI component
```

# Phase 3 — Inventory Admin UI Polish

## Target

Polish inventory admin pages.

Likely routes:

```txt
app/(admin)/inventory
app/(admin)/inventory/ingredients
app/(admin)/inventory/suppliers
app/(admin)/inventory/count
app/(admin)/inventory/orders
app/(admin)/inventory/orders/new
app/(admin)/recipes
```

## Goal

Improve data-heavy inventory pages using consistent admin UI patterns.

Focus on:

- Page headers
- Data cards
- Ingredient/supplier tables
- Purchase order lists
- Stock count entry layout
- Status badges
- Empty states
- Loading states
- Forms/dialogs

## Risk Level

Medium.

Inventory has business rules around stock counts, PO status, partial receiving, and recipe costing. Do not alter calculations or server actions.

## Suggested Sub-phases

To reduce risk, split this phase into smaller commits:

```txt
3A — ingredients + suppliers list polish
3B — stock count UI polish
3C — purchase orders UI polish
3D — recipes UI polish
```

## Allowed UI Changes

Use existing primitives:

```txt
PageHeader
DataCard / SectionCard
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
Badge
Alert
```

Allowed changes:

- Replace raw tables with `Table`.
- Replace raw cards with `DataCard`/`SectionCard`.
- Improve filter/search bars.
- Make PO/stock count statuses consistent.
- Improve empty and loading states.
- Improve form readability while preserving fields and validation.

## Forbidden Changes

Do not change:

```txt
lib/actions/inventory.ts
lib/actions/recipes.ts
lib/actions/reorder.ts
lib/actions/inventory-variance.ts
lib/db/schema.ts
```

Do not alter:

- Stock count calculations
- Quantity on hand calculation
- Purchase order status transitions
- Partial receiving behavior
- Recipe costing
- Yield percent logic
- Supplier/ingredient validation

## Claude Code Prompt

```txt
Read CLAUDE.md first.

Target: Inventory admin UI polish.

Start with only one safe sub-scope:
Phase 3A — ingredients and suppliers list pages.

Rules:
- UI layer only.
- Do not change business logic.
- Do not change database schema.
- Do not change server actions.
- Do not change inventory calculations.
- Do not change purchase order, stock count, recipe, or receiving logic.
- Do not install dependencies.
- Reuse existing components/ui primitives before adding anything new.
- Prefer PageHeader, DataCard/SectionCard, Table, StatusBadge, EmptyState, Skeleton, Input, Label, Button, Dialog, Select, Textarea if already available.
- Replace raw HTML containers/tables/buttons/empty states with existing design-system components where safe.
- Keep all existing data fetching, state, validations, and mutations unchanged.
- Add accessibility improvements where appropriate.

Before editing:
1. Locate inventory ingredient and supplier pages/components.
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
[ ] Ingredient list still loads
[ ] Supplier list still loads
[ ] Create/edit actions still work
[ ] Status display is correct
[ ] No inventory action files changed
[ ] No schema changed
[ ] typecheck passes
[ ] lint has 0 errors
```

## Commit Messages

```txt
refactor(ui): polish inventory ingredient and supplier UI
refactor(ui): polish stock count UI
refactor(ui): polish purchase order UI
refactor(ui): polish recipe admin UI
```

# Phase 12 — V2 UI Revamp: Master Plan

> **Status:** Phase 12.0 (Cleanup) complete. Phase 12.1 not started.
> **Business logic:** Frozen. Do not modify server actions, schema, or payment logic during V2.
> **Scope:** UI + UX only, except Phase 12.0 which is cleanup only.

---

## Goal

Transform the ERP/POS webapp from a functional-but-inconsistent UI into a unified, polished product with a strong "new product" feeling — without breaking any existing business logic.

---

## Design Pillars

| Pillar | Meaning |
|---|---|
| **Unified admin shell** | Every admin page shares the same sidebar, page skeleton, and component patterns |
| **Sheet-based forms** | All create/edit in admin use right-side Sheet drawers (not Dialogs, not full-page) |
| **DataTable everywhere** | Every admin list page uses `data-table.tsx` with consistent filter bars |
| **Semantic status** | `StatusBadge` with CSS token variants — no ad-hoc colored divs |
| **Empty states always** | Zero-data states always show `EmptyState` component |
| **Skeleton loading always** | Every async section shows `LoadingSkeleton` while fetching |
| **Touch stays touch** | POS/KDS/Queue/Tables receive cosmetic improvements only — no layout changes |
| **Mobile customer redesign** | QR ordering gets a brand-level mobile redesign |

---

## Phase Map

### Phase 12.0 — Cleanup ✅ COMPLETE
- Remove Playwright (config, tests, devDeps, scripts)
- Delete root temp files and superseded spec files
- Move audit docs to `docs/archive/`
- Move old scripts to `scripts/archive/`
- Update `.gitignore` and `eslint.config.mjs`
- Rewrite `CLAUDE.md` for V2
- Create `docs/reui-v2/` phase plan files

### Phase 12.1 — Admin App Shell
**Scope:** `components/shared/StandardSidebarLayout.tsx`, `components/shared/SidebarLayout.tsx`

- Sidebar with collapsible rail at md (768px), expanded at lg (1024px)
- Logo strip in `--sidebar-header` area
- Nav groups: collapsible with expand/collapse per section
- Active nav item uses `--sidebar-active` / `--sidebar-active-foreground` tokens
- Badge counts on nav items (low stock, pending PO approval)
- User info + logout at sidebar bottom
- Mobile: side Sheet triggered by hamburger

**Risk:** Medium — layout-only, does not touch page content or business logic.

### Phase 12.2 — Admin Core Pages
**Scope:** Dashboard, Menu, Users/Staff, Store Settings

- Dashboard: 4-col StatCard grid, period selector tabs, chart improvements
- Menu: image-grid list view, Sheet-based edit with image crop, Sheet-based create
- Users/Staff: DataTable with role filter, Sheet edit, deactivate confirm
- Settings: tabbed form (Store / Bill / Tax), live bill preview panel

**Risk:** Low — display and form components only.

### Phase 12.3 — Admin Inventory Module
**Scope:** `/inventory/*`, `/recipes`

- Inventory dashboard: better StatCard summary with stock-health indicators
- Ingredients: DataTable with stock-level color (red = below min, amber = below par), Sheet edit
- Suppliers: DataTable + Sheet edit
- Purchase orders: status-filtered DataTable, approval action in row menu
- Stock count: preserve specialized UI, polish spacing and badges only
- Recipes: split-pane ingredient assignment

**Risk:** Low-Medium — PO status machine is complex, display-only changes only.

### Phase 12.4 — Admin HR & Payroll Module
**Scope:** `/hr/*`

- HR overview: StatCard grid (headcount, this period payroll total, open schedule entries)
- Employees: DataTable with type filter (full_time / part_time), Sheet edit
- Schedule: calendar grid polish (keep structure, improve cell rendering)
- Time entries: DataTable with date filter
- Payroll list: status badges, better action row
- Payroll detail: structured payslip with gross → deductions → net breakdown
- HR Settings: clean form layout

**Risk:** Low — display improvements only, payroll calculation untouched.

### Phase 12.5 — Admin Reports & Remaining Pages
**Scope:** `/reports/*`, `/branches`, `/pricing-tiles`, `/system`

- Reports hub: tile-based navigation (not a list), each tile shows report name + description
- Individual reports: unified filter bar (date range + method) + DataTable + print/export row
- Audit log: expandable rows for before/after detail
- Pricing tiles: tile preview cards + drag reorder (dnd-kit already wired)
- Branches: DataTable + Sheet edit

**Risk:** Low.

### Phase 12.6 — Operational Staff Polish
**Scope:** `/pos/shifts`, `/payment-settings`, KDS visual, Tables side panel, Queue cards

- POS: **cosmetic only** — session list cards, payment method Sheet instead of Dialog
- Cashier shifts: better open/close form layout, cleaner history table
- Payment settings: already partially polished; Sheet edit for methods/accounts
- KDS: station card upgrade (elapsed timer badge, status color tokens)
- Tables: side Sheet for table actions instead of Dialog (keep floor-plan canvas)
- Queue: card layout polish, better "called" state visual

**Risk:** Medium — POS/KDS/Tables are high-risk pages. Only cosmetic changes permitted.

### Phase 12.7 — Customer QR & Login Redesign
**Scope:** `(customer)/*`, `(auth)/login`

- Customer: brand header with restaurant name + table number + timer chip
- Category tabs: horizontal scroll with icons, sticky below header
- Menu cards: image-first 2-col grid, add button
- Cart: floating chip (item count + total) → Sheet from bottom
- Order tracking: visual prep-stage cards with status timeline
- Queue status: "waiting room" card — position display + estimated wait
- Login: centered brand card, logo, cleaner form

**Risk:** Low — customer zone has no payment logic.

---

## Protected Files (Do Not Touch During V2)

See `CLAUDE.md` → V2 Protected Files section for the complete list.

---

## Definition of Done (Per Phase)

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero warnings on changed files
- [ ] No server action files modified
- [ ] No schema files modified
- [ ] No printer files modified
- [ ] All new forms use react-hook-form + Zod
- [ ] All new list views use `data-table.tsx`
- [ ] All new forms open in `Sheet` (not Dialog)
- [ ] Zero-data states use `EmptyState`
- [ ] Loading states use `LoadingSkeleton`
- [ ] Committed as single focused commit per phase

---

## Risk Classification

| Level | Pages |
|---|---|
| Critical (no UI change) | `lib/actions/*`, `lib/db/schema.ts`, `lib/printer/*`, `proxy.ts` |
| High (cosmetic only) | POS terminal, KDS board, Tables floor plan, Queue board |
| Medium | Admin shell, staff layout |
| Low (full redesign safe) | All admin pages, customer pages, login page |

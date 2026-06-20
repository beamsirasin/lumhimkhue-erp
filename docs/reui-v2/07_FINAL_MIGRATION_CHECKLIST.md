# Phase 12 — Final Migration Checklist

> Use this checklist to sign off Phase 12 as complete before moving to Phase 13.
> Each item must be verified manually or via typecheck/lint.

---

## Phase 12.0 — Cleanup

- [x] `playwright.config.ts` deleted
- [x] `tests/e2e/` directory deleted
- [x] `scripts/e2e-seed.ts` deleted
- [x] `@playwright/test` removed from `package.json` devDependencies
- [x] `@axe-core/playwright` removed from `package.json` devDependencies
- [x] `e2e:seed`, `test:e2e`, `test:e2e:ui` removed from `package.json` scripts
- [x] Root temp files deleted: `verify_bill_temp.mjs`, `verify_render_temp.ts`, garbled `verify_tables.mjs`, `shabu-erp-prompt.md`
- [x] Root audit docs moved to `docs/archive/`
- [x] `docs/reui-polish/` moved to `docs/archive/reui-polish/`
- [x] Other old docs moved to `docs/archive/`
- [x] One-off scripts moved to `scripts/archive/`
- [x] `.gitignore` updated (playwright artifacts + temp patterns)
- [x] `eslint.config.mjs` cleaned up (removed garbled temp file entries)
- [x] `CLAUDE.md` rewritten for V2
- [x] `docs/reui-v2/` phase files created
- [x] `npm run typecheck` passed
- [x] `npm run lint` passed

---

## Phase 12.1 — Admin App Shell

- [ ] Collapsible rail sidebar at < 1024px
- [ ] Expands on hover (CSS `:hover` group)
- [ ] Logo strip visible in `--sidebar-header`
- [ ] Nav groups collapsible with animated chevron
- [ ] Active nav item uses sidebar token colors
- [ ] Badge counts visible on nav items (inventory alerts, PO approvals)
- [ ] User info + logout at sidebar bottom
- [ ] Mobile: hamburger → Sheet sidebar
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed
- [ ] No server actions modified

---

## Phase 12.2 — Admin Core Pages

- [ ] Dashboard: 4-col StatCard grid, period selector tabs
- [ ] Dashboard: chart improvements, `LoadingSkeleton` on refetch
- [ ] Menu: image-grid view, Sheet create/edit
- [ ] Users: DataTable + Sheet edit + deactivate confirm
- [ ] Settings: tabbed form (Store / Bill / Tax)
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Phase 12.3 — Inventory Module

- [ ] Inventory dashboard: StatCard row with stock health
- [ ] Ingredients: stock-level color indicators in DataTable
- [ ] Suppliers: DataTable + Sheet edit
- [ ] Purchase orders: status-tab DataTable
- [ ] Stock count: polish only, structure unchanged
- [ ] Recipes: split-pane ingredient assignment
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Phase 12.4 — HR & Payroll Module

- [ ] HR overview: StatCard row
- [ ] Employees: DataTable + Sheet edit
- [ ] Schedule: visual polish, structure unchanged
- [ ] Time entries: DataTable with date filter
- [ ] Payroll list: status badges
- [ ] Payroll detail: structured payslip breakdown
- [ ] HR Settings: clean form
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Phase 12.5 — Reports & Remaining Pages

- [ ] Reports hub: tile-based navigation
- [ ] All 6 reports: unified filter bar + DataTable
- [ ] Audit log: expandable rows
- [ ] Pricing tiles: tile preview cards + drag reorder
- [ ] Branches: DataTable + Sheet edit
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Phase 12.6 — Operational Staff Polish

- [ ] POS: cosmetic card improvements (no logic change)
- [ ] POS: payment sheet instead of dialog — VERIFY payment still processes correctly
- [ ] Cashier shifts: Sheet-based open/close form
- [ ] Payment settings: Sheet edit
- [ ] KDS: elapsed timer badge on station cards
- [ ] Tables: side Sheet for table actions
- [ ] Queue: card polish, "called" state highlight
- [ ] All buttons meet 44px minimum touch target
- [ ] Manually verified: can complete a full payment cycle (open table → order → close → pay)
- [ ] Manually verified: KDS shows orders and can serve/cancel
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Phase 12.7 — Customer QR & Login

- [ ] Brand header on customer menu page
- [ ] Category tabs: horizontal scroll, sticky
- [ ] Menu cards: image-first 2-col grid
- [ ] Cart: floating chip → Sheet from bottom
- [ ] Order tracking: visual prep-stage cards
- [ ] Queue status: large queue number, waiting room design
- [ ] Login: branded split-screen (desktop) / centered card (mobile)
- [ ] Manually verified: customer can scan QR, open menu, add items, order, track orders
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed

---

## Final Sign-off

- [ ] All 7 phases above marked complete
- [ ] No `lib/actions/*.ts` files modified during V2
- [ ] No `lib/db/schema.ts` modifications
- [ ] No `lib/printer/*` modifications
- [ ] No `proxy.ts` modifications
- [ ] `npm run typecheck` passes clean on full project
- [ ] `npm run lint` passes clean on full project
- [ ] Tested on mobile viewport (375px) for customer pages
- [ ] Tested on tablet viewport (768px) for admin pages
- [ ] Dark mode verified on admin pages
- [ ] Ready to merge to main and deploy

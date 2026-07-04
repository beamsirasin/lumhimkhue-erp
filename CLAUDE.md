# Shabu Buffet ERP — CLAUDE.md (V2)

Read this file at the start of every session. It is the authoritative reference for this codebase.

## Shared Agent Instructions

Codex and other coding agents should also read `AGENTS.md`. Keep `CLAUDE.md` and `AGENTS.md` aligned around the shared V2 UI Development Contract, theme-zone rules, and business-logic safety rules.

---

## Project Overview

Full-stack ERP/POS SaaS for a Thai shabu buffet restaurant chain. Covers the entire operations loop: customer QR ordering → kitchen display → cashier checkout → owner analytics, with inventory, HR, and payroll management.

**Production stack:** Next.js 16 App Router · React 19 · TypeScript (strict) · Neon PostgreSQL · Drizzle ORM · Auth.js v5 (next-auth beta) · Vercel deployment

**Current phase:** Phase 16 — Production Hardening (post Phase 15+ / reports revamp / bill & payment work). See `docs/production/00_HARDENING_ROADMAP.md`.

**Feature freeze is active.** No new feature modules until the hardening phases (16B–16F) complete. Core POS / tables / payment logic is frozen except for verified bug fixes and explicitly-prompted hardening phases. Food Cost / COGS features are deferred until accounting, stock counting, and recipe costing are reliable.

---

## Tech Stack (exact versions)

| Package | Version | Notes |
|---|---|---|
| next | 16.2.6 | App Router, Server Actions, Turbopack dev |
| react / react-dom | 19.2.4 | |
| typescript | ^5 | strict mode |
| tailwindcss | ^4 | CSS-first config via `app/globals.css` |
| shadcn/ui | ^4.8.1 | style: `base-nova`, base color: `neutral`, CSS variables |
| drizzle-orm | ^0.45.2 | |
| @neondatabase/serverless | ^1.1.0 | |
| drizzle-kit | ^0.31.10 | |
| next-auth | ^5.0.0-beta.31 | JWT strategy, Credentials provider |
| @tanstack/react-query | ^5.100.14 | polling only, no WebSocket |
| zustand | ^5.0.13 | cart store only |
| zod | ^4.4.3 | |
| react-hook-form | ^7.76.1 | |
| @hookform/resolvers | ^5.4.0 | |
| date-fns / date-fns-tz | ^4 / ^3 | Asia/Bangkok timezone |
| sonner | ^2.0.7 | toasts |
| recharts | ^3.8.1 | admin charts |
| lucide-react | ^1.16.0 | icons |
| @point-of-sale/receipt-printer-encoder | ^3.0.3 | ESC/POS thermal printing |
| bcryptjs | ^3.0.3 | |
| nanoid | ^5.1.11 | |
| @upstash/ratelimit + @upstash/redis | ^2 / ^1 | login rate limiting |
| @vercel/blob | ^2.4.0 | menu item images |
| @dnd-kit/core + sortable | ^6 / ^10 | table floor-plan drag |
| idb-keyval | ^6.2.4 | IndexedDB for printer config |
| qrcode | ^1.5.4 | table/queue QR codes |
| cmdk | ^1.1.1 | command palette |
| tw-animate-css | ^1.4.0 | animation utilities |
| @base-ui/react | ^1.5.0 | low-level primitives |
| resend | ^6.12.4 | email (optional) |
| react-easy-crop | ^5.5.7 | image cropping in menu management |
| react-day-picker | ^10.0.1 | calendar date picker |

**Not installed / not used:** Prisma, Pusher, WebSocket, Redis (except Upstash for rate limiting), external payment gateway, Stripe, React Native, Playwright.

---

## Folder Structure

```
app/
  (admin)/            → Owner-only back-office (role: owner)
    dashboard/        → KPI overview + charts
    menu/             → Menu item CRUD
    pricing-tiles/    → Guest types, add-ons, discounts, loyalty tiles
    users/            → Staff user management
    settings/         → Store name, contact, tax ID
    branches/         → Branch management
    system/           → System admin
    reports/          → Redirects to /reports/revenue
    reports/revenue/  → Revenue report (income + collection)
    reports/tables/   → Table usage report
    reports/queue/    → Queue report
    reports/kitchen/  → Kitchen report
    reports/audit/    → Audit log viewer
    hr/               → HR dashboard
    hr/employees/     → Employee directory
    hr/schedule/      → Schedule cycles
    hr/time/          → Time entry / attendance
    hr/payroll/       → Payroll cycles list
    hr/payroll/[id]/  → Payroll detail
    hr/settings/      → HR config (shift times, deduction rates)
    inventory/        → Inventory dashboard
    inventory/ingredients/  → Ingredient master
    inventory/suppliers/    → Supplier management
    inventory/count/        → Stock count entry
    inventory/orders/       → Purchase orders list
    inventory/orders/new/   → New PO form
    recipes/          → Recipe builder (ingredients per menu item)
    pricing/          → LEGACY — redirect to pricing-tiles
  (staff)/            → Operations staff (cashier / kitchen / host)
    pos/              → POS cashier terminal
    pos/history/      → Payment history
    pos/shifts/       → Cashier shift management
    kds/              → Kitchen Display System
    kds/history/      → KDS order history
    queue/            → Queue management
    queue/history/    → Queue history
    tables/           → Floor plan + table management
    tables/history/   → Session history
    printers/         → Printer configuration
    payment-settings/ → Payment methods & receiving accounts
  (customer)/         → Public QR-accessible, no auth
    q/[queueToken]/   → Queue status display
    t/[tableToken]/   → Table entry point
    t/[tableToken]/s/[sessionToken]/        → Customer ordering interface
    t/[tableToken]/s/[sessionToken]/orders/ → Customer order tracking
  (auth)/
    login/            → Credential login form
  page.tsx            → Root redirect by role
  unauthorized/       → Role-denied fallback
  layout.tsx          → Root layout (QueryProvider, Toaster)
  globals.css         → Tailwind v4 CSS config + all theme tokens

  api/
    auth/[...nextauth]/   → NextAuth handler
    print/network/        → Network printer relay (TCP 9100)
    img/[menuItemId]/     → Menu item image serving
    upload/               → Blob image upload
    cron/daily-report/    → Daily closing report cron
    debug/db-rtt/         → DB latency test
    health/               → Health check

components/
  admin/              → Admin UI components
    hr/               → HR sub-components
  staff/              → POS, KDS, Queue, Tables, Printers components
  customer/           → Customer ordering, queue status
  shared/             → Layouts, QueryProvider, ErrorBoundary, ConfirmDialog
  ui/                 → shadcn/ui primitives + custom: data-table, empty-state,
                        loading-skeleton, page-header, section-card, stat-card,
                        status-badge, app-shell, form-section, input-group, etc.

lib/
  db/
    schema.ts         → ALL Drizzle schema (tables, enums, relations) — DO NOT split
    index.ts          → Neon serverless db client
    seed.ts           → Initial data seed (guarded — won't run twice)
    seed-inventory.ts → Inventory seed
    seed-hr.ts        → HR/employee seed
    migrate_v12.ts, migrate_v13.ts, migrate-phase*.ts  → Schema migration scripts
  auth/
    config.ts         → NextAuth config (JWT, callbacks, role guards)
    permissions.ts    → can(role, action) helper + PERMISSIONS matrix
    module-routes.ts  → Module code → route prefix mapping
    ratelimit.ts      → Upstash Redis login rate limiting
    require-active.ts → isActive guard helper
  actions/            → ALL server actions (see Server Actions section)
  validations/        → Zod schemas matching server action inputs
  payments/
    foundation.ts     → Default methods/accounts, checkout validation helpers
    money-math.ts     → Pure money formulas (Phase 16D golden extractions — tested)
    account-group.ts  → A/B receiving-account group derivation + mix lock
    display-labels.ts → Payment method/account label formatters
  printer/
    service.ts        → Public API: print(job, printerId?)
    escpos.ts         → ESC/POS command builders (Thai codepage: cp874/thai13/11/42)
    bitmap.ts         → Bitmap-mode Thai rendering (image fallback)
    types.ts          → PrintJob, ReceiptData, KitchenOrderData, PrinterConfig types
    store.ts          → Default printer persistence (localStorage / idb-keyval)
    capabilities.ts   → Printer capability detection
    templates.ts      → HTML receipt templates (browser fallback)
    transports/usb.ts     → WebUSB transport
    transports/network.ts → TCP/IP 9100 relay (server-side)
    transports/browser.ts → window.print() fallback
  store/
    cart.ts           → Zustand cart (customer ordering only)
  utils/
    utils.ts          → cn(), currency formatting, date utils
    billConfig.ts     → Bill layout resolver (A5 / 80mm)
  tokens.ts           → Token generation for table QR, queue, session identifiers
  perf.ts             → Performance timing utility

proxy.ts              → Renamed Next.js middleware (auth guard + x-current-path header)
auth.ts               → NextAuth exports re-export
next.config.ts        → Remote image patterns, Turbopack, barrel tree-shaking, legacy redirect
drizzle.config.ts     → Drizzle Kit config
components.json       → shadcn/ui config (base-nova, neutral, CSS variables)
vercel.json           → Region: sin1, Cron: daily-report 16:30 UTC

docs/
  production/         → Production hardening roadmap + protected-files policy (active)
  architecture/       → MIGRATIONS.md (schema governance)
  ops/                → Go-live checklist, staff runbook (Thai), incident playbook
  uat/                → Manual UAT scripts (blocks A–G)
  reui-v2/            → V2 revamp phase plans (completed; reference)
  archive/            → Historical audit and polish docs (read-only reference)
    reui-polish/      → Superseded V1 polish plans

android-pos-app/      → Native Android POS bridge app (WebView + local printer bridge)

scripts/
  backfill-payment-rows.ts    → One-time payment row backfill (keep, still in package.json)
  verify-payment-foundation.ts → Payment foundation verify (keep, still in package.json)
  archive/                    → Completed one-off scripts (read-only reference)
```

---

## Database Schema — Key Tables

All schema lives in `lib/db/schema.ts`. Do not split it. Never use Prisma.

### Enums
`role` (owner/manager/cashier/kitchen) · `tableStatus` (available/occupied/reserved/linked/paid) · `sessionStatus` (active/closing/closed/paid) · `orderStatus` / `itemStatus` (pending/preparing/ready/served/cancelled) · `station` (meat/seafood/vegetable/noodle/dessert/drink/sauce) · `queueStatus` (waiting/called/seated/left) · `tileCategory` (guest/addon/discount/loyalty/penalty) · `discountType` (fixed/percentage) · `cashierShiftStatus` (open/closed/reviewed) · `paymentStatus` (completed/voided/refunded) · `paymentSettlementType` (partial/final) · `paymentMethodType` (promptpay/cash/welfare/mixed_legacy/other) · `receivingAccountType` (bank_cash_group/welfare/cash_drawer/other)

### Core Tables
| Table | Key Columns |
|---|---|
| `users` | id, email (unique), passwordHash, name, role, isActive, branchId, uiLayout, allowedModules, navLayout |
| `branches` | id, name, address, phone, taxId, isActive |
| `tables` | id, label, capacity, zone, status, qrToken, positionX/Y, width/height, shape, branchId, deletedAt |
| `sessions` | id, tableId, parentSessionId, customerId, branchId, status, sessionToken, taxInvoiceRequested, taxInvoiceNumber, billPrintedAt, startedAt, closedAt |
| `customers` | id, phone (unique), name, loyaltyPoints, totalVisits, totalSpend |

### Buffet / Billing
| Table | Key Columns |
|---|---|
| `pricingTiles` | id, code, name, category (guest/addon/discount/loyalty/penalty), price, vatRate, vatIncluded, discountType, discountValue, sortOrder, isActive |
| `sessionGuests` | id, sessionId, pricingTileId, quantity, unitPrice (snapshot) |
| `buffetChargeLines` | id, sessionId, pricingTileId, chargeType, label, unitPrice, quantity, total, voidedAt |

### Payment Tables
| Table | Key Columns |
|---|---|
| `payments` | id, sessionId, subtotal, serviceCharge, discount, total, paymentMethod (legacy enum), paidAt, processedBy, receiptNo, shiftId, status, settlementType, billTotalAtPayment, paidBefore, remainingAfter, idempotencyKey (unique, Phase 16B) |
| `paymentRows` | id, paymentId, sessionId, paymentMethodId, receivingAccountId, amount, amountTendered, changeAmount, referenceNo, status, cashierId, shiftId |
| `paymentLineItems` | id, paymentId, pricingTileId, quantity, amount |
| `paymentMethods` | id, code (unique), name, type, requiresReference, allowOverpay, isActive, sortOrder |
| `receivingAccounts` | id, code (unique), name, type, bankName, accountLabel, isActive, sortOrder |
| `paymentMethodAccounts` | paymentMethodId + receivingAccountId (unique), isDefault, isActive |
| `paymentAllocations` | id, paymentId, sessionId, chargeLineId, quantity, amount |
| `paymentAdjustments` | id, paymentId (not FK!), type (void/refund/discount_correction), amount, reason, paymentSnapshot (jsonb), status (pending/approved/rejected) |
| `discountApprovals` | id, sessionId, requestedBy, approvedBy, discountType, discountValue, status |
| `cashierShifts` | id, branchId, cashierId, status, openedAt, closedAt, openingFloat, expectedCash, actualCash, cashDifference |

### Menu & Orders
`categories` (id, name, station, maxPerSession) · `menuItems` (id, categoryId, name, nameEn, imageUrl, isBuffet, extraPrice, maxPerOrder, cooldownSeconds, allergens) · `orders` (id, sessionId, status) · `orderItems` (id, orderId, menuItemId, itemName, quantity, station, status)

### Queue
`queueEntries` (id, queueNumber, customerName, phone, partySize, preferredZone, status, publicToken)

### Inventory
`ingredientCategories` · `ingredients` (id, categoryId, name, unit, minStock, parLevel, lastCost, defaultSupplierId, countFrequency, yieldPercent, orderUnit, orderUnitConversion) · `suppliers` · `stockCounts` (id, countDate unique, countedBy, status, branchId) · `stockCountItems` · `stockCountAdjustments` · `purchaseOrders` (id, poNumber unique, supplierId, status, branchId) · `purchaseOrderItems` · `goodsReceipts` · `goodsReceiptItems`

### Recipes
`recipes` (id, menuItemId cascade) · `recipeIngredients` (id, recipeId, ingredientId, quantity, unit)

### HR / Payroll
`employees` (id, userId nullable, branchId, type full_time/part_time, baseSalaryPerCycle, incentivePerDay, hourlyRate, ssfRegistered) · `scheduleCycles` · `scheduleEntries` (unique: cycleId+employeeId+workDate, status: working/day_off/leave) · `timeEntries` (clockIn, clockOut, totalHours, breakMinutes) · `payrollCycles` · `payrollItems` (gross, totalDeduction, netPay, ssfEmployee, ssfEmployer, withholdingTax, netPayAfterTax) · `payrollDeductions` (advance/damage) · `payrollAbsences` · `hrSettings` (singleton)

### Audit
`auditLogs` (id, userId, action, entity, entityId, metadata jsonb with role/before/after/ip)
`customerVisits` (id, customerId, sessionId, pointsEarned, pointsRedeemed)

---

## Auth & Permissions

### Authentication
- NextAuth v5 Credentials provider · JWT session strategy · `proxy.ts` sets `x-current-path` header (avoids stale-JWT module enforcement)
- Login rate limiting: Upstash Redis (`lib/auth/ratelimit.ts`)
- `isActive` flag — deactivated users cannot login

### Two-Tier Authorization
**Tier 1 — Role routes** (enforced in layout + server actions):
- `/dashboard`, `/menu`, `/pricing*`, `/users`, `/settings`, `/hr/*`, `/inventory/*`, `/recipes`, `/reports/*`, `/branches`, `/system` → `owner` only
- `/pos`, `/pos/*` → owner, manager, cashier
- `/kds`, `/kds/*` → owner, manager, cashier, kitchen
- `/queue`, `/tables`, `/printers`, `/payment-settings` → all authenticated

**Tier 2 — Module access** (fresh DB read in `app/(staff)/layout.tsx` via x-current-path):
- Applies to cashier/manager/kitchen; owner always bypasses
- `users.allowedModules` string array: `pos`, `kds`, `queue`, `tables`, `printers`

### can(role, action) — `lib/auth/permissions.ts`
```ts
can(role, 'manage_menu')           // owner, manager
can(role, 'process_payment')       // owner, manager, cashier
can(role, 'payment:void')          // owner, manager
can(role, 'payment:delete')        // owner only
can(role, 'discount:apply')        // owner, manager, cashier
can(role, 'discount:approve')      // owner, manager
can(role, 'hr:manage')             // owner only
can(role, 'inventory:view')        // owner, manager
can(role, 'cashier_shift:manage')  // owner, manager, cashier
can(role, 'view_kds')              // all
```

---

## Server Actions Pattern

All server actions live in `lib/actions/*.ts`. Never throw. Never use `any`.

```ts
'use server';

export async function doSomething(input: unknown) {
  // 1. Auth check
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };

  // 2. Permission check
  if (!can(session.user.role, 'process_payment'))
    return { ok: false, error: 'Forbidden' };

  // 3. Zod validate (schema in lib/validations/)
  const parsed = mySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };

  // 4. Multi-step writes
  // ⚠️ The current neon-http driver does NOT support db.transaction() —
  // multi-step writes run sequentially and are NOT atomic. A transaction
  // strategy is planned in Phase 16C (docs/production/00_HARDENING_ROADMAP.md).
  // Until then: order writes so a mid-sequence failure leaves recoverable state.
  await db.insert(/* ... */);

  // 5. Cache invalidation
  revalidatePath('/relevant-path');

  // 6. Return typed result
  return { ok: true, data: result };
}
```

Return type: always `{ ok: true, data: T } | { ok: false, error: string }`.

### Server Action Files
| File | Responsibility |
|---|---|
| `pos.ts` (867 lines) | getPosSessionsForPos, getPosSessionDetail, processPayment, markBillPrinted, getActiveTilesForPos |
| `sessions.ts` (794 lines) | openSession, closeSession, updateSessionGuests, getSessionDetail |
| `shifts.ts` (633 lines) | openShift, closeShift, reviewShift, getActiveShift, getShiftHistory |
| `payment-settings.ts` (474 lines) | getPaymentSettings, createPaymentMethod, createReceivingAccount, togglePaymentMethod |
| `tables.ts` (304 lines) | getTablesWithSessions, updateTableLayout, updateTableStatus, updateTableZone |
| `orders.ts` (385 lines) | createOrder, updateOrderStatus, cancelOrderItem |
| `inventory.ts` (1238 lines) | ingredients CRUD, purchase orders, stock counts, goods receipts |
| `hr.ts` (883 lines) | employees CRUD, schedule cycles, payroll cycles, calculatePayroll |
| `history.ts` (1329 lines) | payment/session/KDS/queue history, receipt reprint data |
| `dashboard.ts` (494 lines) | getDashboardMetrics, getRevenueData |
| `reports/*.ts` (10 files) | collection, daily-closing, kitchen-report, menu-performance, pl, queue-report, ssf-report, table-report, vat-report, wht-report |
| `audit.ts` | writeAuditLog (fire-and-forget) |
| `discounts.ts` | createDiscountApproval, approveDiscount |
| `menu.ts` | menu item CRUD |
| `pricing.ts` | pricingTile CRUD + reorder |
| `queue.ts` | queue entry lifecycle |
| `kds.ts` | KDS board data, item status transitions |
| `customers.ts` | loyalty points, customer data |
| `recipes.ts` | recipe + ingredient linkage |
| `store.ts` | getStoreSettings, updateStoreSettings, incrementReceiptCounter |
| `tax-invoice.ts` | tax invoice number generation |
| `branches.ts` | branch CRUD |
| `staff.ts` | staff directory, deactivate user |
| `reorder.ts` | inventory reorder suggestions |
| `inventory-variance.ts` | variance analysis |
| `shift-backfill.ts` | 16G-A: owner/manager same-day cash→shift late assignment (audited) |

---

## UI Zones — V2 Design Philosophy

This codebase has **three strictly separated UI zones**. Never apply POS patterns to admin pages, and never apply admin patterns to POS screens. This boundary is inviolable.

### Zone 1 — Customer (QR / Mobile)
**Routes:** `(customer)/t/*`, `(customer)/q/*`
- Mobile-first, 375px min-width
- Large touch targets (min 44px)
- Minimal text, strong imagery
- Thai language throughout
- TanStack Query polling: 10s orders, 5s unserved check, 10s queue status
- **No data-table, no sidebar, no admin patterns here**

### Zone 2 — Operational Staff (POS / KDS / Queue / Tables)
**Routes:** `(staff)/pos`, `(staff)/kds`, `(staff)/queue`, `(staff)/tables`
- **Touch-optimized, large buttons, minimal animation, instant feedback**
- POS: 2-column layout (session list left, detail/numpad right)
- KDS: board/card layout by station, bold status colors
- Tables: floor-plan grid with drag-and-drop
- Queue: card-per-entry, large font, called/seated states
- No small fonts, no hover-only interactions
- Do NOT apply data-table, filter bars, or admin-style forms here
- Polling: KDS 3s, POS 5s, Tables 5s, Queue 5s
- Custom components — do NOT replace with ReUI/admin patterns

### Zone 3 — Admin / Back-office
**Routes:** `(admin)/*`, `(staff)/printers`, `(staff)/payment-settings`, `(staff)/pos/shifts`
- Tablet/desktop, 768px+
- IBM Plex Sans Thai, weight 400/500 only
- Navy blue primary (`oklch(0.30 0.11 248)`)
- Dark ink sidebar (`oklch(0.155 0.04 248)`)
- Flat clean design — no gradients, no heavy shadows
- `rounded-lg` (8px) default border radius
- **shadcn/ui base-nova** components (neutral base, CSS variables)
- **ReUI V2 patterns are the standard here** — see ReUI V2 Direction section below
- Polling: Dashboard 60s; most admin pages no polling

---

## Theme & Styling

```
Tailwind: v4, CSS-first config in app/globals.css
shadcn/ui: base-nova style, neutral base color, CSS variables on
Font: IBM Plex Sans Thai, weight 400 + 500 only
Primary: oklch(0.30 0.11 248) = navy blue
Sidebar: oklch(0.155 0.04 248) = dark ink navy
```

**CSS custom properties (defined in `app/globals.css`):**
- `--surface-0/1/2/raised` — elevation layers
- `--surface-primary-subtle/muted` — tinted panels for active states
- `--shadow-card/raised/dialog` — shadow utilities
- `--status-{success/danger/warning/info/neutral/purple/orange/cyan}-{bg/fg/border}` — semantic status tokens
- `--sidebar-*` — sidebar-specific tokens (header, active, active-foreground)
- Standard shadcn tokens: `--primary`, `--background`, `--foreground`, `--border`, `--muted`, etc.

**Token system is locked during V2 UI revamp.** Additions are OK; editing existing tokens requires explicit approval.

**Rules:**
- Never add a new CSS file; extend `globals.css` or use Tailwind classes
- Never use inline `style={{}}` except for dynamic values (position coordinates, width%)
- WCAG AA contrast on all text
- All icon-only buttons must have `aria-label`
- Use `cn()` from `@/lib/utils` for conditional class merging

---

## ReUI V2 Direction

ReUI is the **primary pattern standard** for all admin and back-office pages.

### V2 Admin Page Skeleton (every admin list page follows this)

```
PageHeader
  title + subtitle
  action button: [+ เพิ่ม] → opens Sheet

Filter bar (inside section-card or flush above DataTable)
  search input | status dropdown | date picker | [reset]

DataTable
  sortable column headers
  StatusBadge for status values
  row action: DropdownMenu (…) with แก้ไข / ลบ / etc.
  pagination

Sheet (right-side drawer — opens on Add / Edit)
  react-hook-form + Zod
  [บันทึก] [ยกเลิก]
```

### V2 Component Standards

| Pattern | Rule |
|---|---|
| Create/Edit forms | **Always `Sheet` (right drawer)** — never full-page, never Dialog |
| Destructive actions | **Always `ConfirmDialog` first** — never inline |
| List pages | `PageHeader` + filter bar + `DataTable` — no exceptions |
| Zero data | **Always `EmptyState`** component with contextual icon + message |
| Loading state | **Always `LoadingSkeleton`** while async data is fetching |
| KPI / stats | `StatCard` + `StatCardGrid` |
| Status values | `StatusBadge` with semantic variant tokens |
| Class merging | `cn()` from `@/lib/utils` — never template literals for classes |
| Icons | `lucide-react` only — no other icon libraries |
| Forms | `react-hook-form` + Zod + `@hookform/resolvers` — no uncontrolled inputs |

### Where ReUI Patterns Are Welcome
Admin dashboards · Reports · Settings forms · DataTables with filters · HR forms · Inventory CRUD · Payroll tables · Empty states · Dialogs/modals · Badges · Stat cards · Section cards · Page headers

### Where ReUI Must NOT Be Applied
POS cashier screens · KDS board · Tables floor plan · Queue board · Any touchscreen-optimized flow · Customer ordering pages

### Rules for Adopting New ReUI Patterns
1. Copy the component into `components/ui/` — do not import from an external package
2. Adapt to the project's existing CSS variable theme (`--primary`, `--surface-*`, etc.)
3. Replace any hardcoded colors with theme tokens
4. Wire all forms to react-hook-form + Zod
5. Replace any data fetching with server actions returning `{ ok, data | error }`
6. Add auth guards and role checks consistent with the existing pattern
7. Do not introduce another UI library (no Mantine, no Radix standalone, no MUI)
8. Prefer reusing existing `components/ui/` before copying new ones

---

## Existing UI Component Library (`components/ui/`)

Always check here before creating new components.

| Component | Purpose |
|---|---|
| `app-shell.tsx` | `AppShell` — page wrapper, `max-w-[1400px]`, `px-6 py-5` |
| `badge.tsx` | shadcn Badge |
| `button.tsx` | shadcn Button |
| `calendar.tsx` | Date picker calendar |
| `card.tsx` | shadcn Card |
| `chart.tsx` | Recharts wrapper (ChartContainer, Bar, Pie, etc.) |
| `collapsible.tsx` | shadcn Collapsible |
| `command.tsx` | shadcn Command (cmdk) |
| `data-table.tsx` | Generic DataTable with column defs, sort, pagination |
| `dialog.tsx` | shadcn Dialog — use for destructive confirms only |
| `dropdown-menu.tsx` | shadcn DropdownMenu — row action menus (…) |
| `empty-state.tsx` | `EmptyState` — zero-data states |
| `form-section.tsx` | Form group with title + description |
| `input-group.tsx` | Input with prefix/suffix addons |
| `input.tsx` | shadcn Input |
| `label.tsx` | shadcn Label |
| `loading-skeleton.tsx` | `LoadingSkeleton` — animated placeholder while loading |
| `page-header.tsx` | `PageHeader` — title + subtitle + action slot |
| `popover.tsx` | shadcn Popover |
| `section-card.tsx` | `SectionCard` — content card with optional header |
| `select.tsx` | shadcn Select |
| `separator.tsx` | shadcn Separator |
| `sheet.tsx` | shadcn Sheet — **primary create/edit form container** |
| `skeleton.tsx` | shadcn Skeleton primitive |
| `stat-card.tsx` | `StatCard` + `StatCardGrid` — KPI metric display |
| `status-badge.tsx` | `StatusBadge` — semantic colored badge (uses status tokens) |
| `table-map.tsx` | Table floor plan map |
| `table.tsx` | shadcn Table primitive |
| `tabs.tsx` | shadcn Tabs |
| `textarea.tsx` | shadcn Textarea |

---

## Printer Integration

**Integration path:** Component → `print(job)` → `lib/printer/service.ts` → ESC/POS bytes or HTML → USB/Network/Browser

### Print Jobs
| Job Type | Builder | Output |
|---|---|---|
| Receipt | `buildReceipt()` in escpos.ts | ESC/POS: store header, guest breakdown, items, payment, tax, footer |
| Kitchen slip | `buildKitchenOrder()` | Station-specific item list |
| Table QR | `buildTableQr()` | QR code for customer URL |
| Queue QR | `buildQueueQr()` | QR code for queue status URL |

### Transports
- **USB** — WebUSB (`transports/usb.ts`), bulk transfer, browser-only
- **Network** — TCP/IP port 9100 relay via `api/print/network/route.ts`, requires LAN access
- **Browser** — `window.print()` fallback with HTML template

### Thai Codepage Handling
- Primary: cp874 / thai13 / thai11 / thai42 via ReceiptPrinterEncoder
- Fallback: bitmap mode (`lib/printer/bitmap.ts`) — renders Thai text as image for printers without Thai codepage

---

## POS / Payment Business Rules

Critical rules — do not change these without explicit instruction.

### Session Lifecycle
```
openSession() → status: active
  ↓ customer orders
closeSession() → status: closing  (triggers checkout in POS)
  ↓ processPayment()
payment recorded → status: paid
  ↓ table freed → status: available
```

### Payment Model
- Each checkout creates one `payments` row (summary) + one or more `paymentRows` (per method/account)
- `paymentRows` supports mixed payment (cash + QR on same bill)
- `paymentAllocations` tracks which charge lines each payment row covers
- `paymentAdjustments` is an **immutable audit ledger** — never delete rows, only append (void/refund types)
- `settlementType`: `partial` = deposit taken, session still open; `final` = session closed
- `billTotalAtPayment` snapshot prevents total drift when prices change mid-session

### Pricing Tile Model
- Categories: `guest` (adult/child buffet prices), `addon` (extra items), `discount`, `loyalty` (point redemption), `penalty` (fixed-amount fines/fees, e.g. ค่าปรับกินเหลือ — must have price > 0)
- Prices are **snapshotted** into `sessionGuests.unitPrice` at session open — do not re-read live tile prices during checkout
- `buffetChargeLines` is the canonical saved bill: guest and addon tiles saved via `updateSessionGuests` become charge lines; `processPayment` uses the non-voided charge-line total as the authoritative subtotal when present

### Cashier Shifts
- A shift must be open before processing payments (`cashierShifts.status = open`)
- `openingFloat` set at shift open; `expectedCash` calculated from cash payments; `actualCash` from physical count at close
- `cashDifference = actualCash − expectedCash`; requires `differenceReason` if non-zero

### Discount Approval Workflow
- Cashier calls `createDiscountApproval()` → status: pending
- Manager/owner calls `approveDiscount()` → status: approved
- Approved discount applied at checkout as a `paymentLineItems` row with negative amount

### Linked Tables (Group Bills)
- `sessions.parentSessionId` → child sessions linked to parent
- `tableStatus = 'linked'` on child tables
- Bill charged on parent session; child sessions close when parent closes

---

## Polling Intervals (TanStack Query)

| Page | Interval |
|---|---|
| KDS | 3s |
| Tables grid | 5s |
| POS sessions | 5s |
| POS session detail | 10s |
| Queue (host) | 5s |
| Customer "my orders" | 10s |
| Customer unserved check | 5s |
| Queue (customer) | adaptive: 3s while waiting/called · 15s after admitted/terminal |
| Dashboard | 60s |

Do not use WebSockets or SSE. All real-time updates are poll-based.

---

## Inventory Business Rules

- `ingredients.countFrequency` (daily/weekly) controls which items appear on today's stock count
- `stockCounts` keyed by `countDate` (unique) — only one count per day per branch
- `stockCountItems.quantityOnHand` is a computed field (openingBalance + receivedQty − usedQty)
- PO status flow: `draft → pending_approval → ordered → partial_received → received | cancelled`
- Partial receiving: `goodsReceiptItems.receivedQuantity` can be less than `purchaseOrderItems.quantity` → status becomes `partial_received`
- Variance reasons: `none / short / wrong / spoiled` per received item
- `ingredients.yieldPercent` affects recipe costing (actual usable quantity vs purchased)

---

## HR / Payroll Business Rules

- Employee types: `full_time` (monthly `baseSalaryPerCycle` + daily `incentivePerDay`) vs `part_time` (hourly `hourlyRate`)
- Payroll calculation order: gross → deductions (absence, late, advance, damage) → SSF → WHT → net
- `hrSettings` is a singleton row — one per installation
- `scheduleEntries` unique constraint: `(cycleId, employeeId, workDate)` — prevents duplicate entries
- `payrollItems` snapshots `baseSalary`, `incentivePerDay`, `hourlyRate` at calculation time
- `ssfEmployee` / `ssfEmployer` split tracked separately for reporting
- Payment proof uploaded to Vercel Blob, URL stored in `payrollItems.paymentProofUrl`

---

## Reports

**Report pages (current):** `/reports` redirects to `/reports/revenue`. The sidebar exposes a "รายงาน" group with:

| Route | Page component | Backing actions |
|---|---|---|
| `/reports/revenue` | `RevenueReportPage` | `dashboard.ts` (getReportSummary) + `reports/collection.ts` |
| `/reports/tables` | `TableReportPage` | `reports/table-report.ts` |
| `/reports/queue` | `QueueReportPage` | `reports/queue-report.ts` |
| `/reports/kitchen` | Kitchen report | `reports/kitchen-report.ts` |
| `/reports/audit` | Audit log viewer | `audit.ts` |

Report display labels live in `lib/reports/report-labels.ts` (not inside server actions). Guest-count KPIs on revenue/tables/queue reports support client-side type filtering via `components/admin/GuestCountFilter.tsx` — display filtering only; server calculations are unchanged.

**Report actions without dedicated pages** (used by cron/daily-closing or awaiting UI): `daily-closing.ts`, `menu-performance.ts`, `pl.ts`, `vat-report.ts`, `wht-report.ts`, `ssf-report.ts`.

**Food Cost / COGS reporting is deferred** — recipe costing, stock counting, and accounting inputs are not yet reliable enough; do not build food-cost features without an explicit phase prompt.

---

## DB Scripts

```bash
npm run db:push                    # push schema changes to Neon (dev)
npm run db:generate                # generate migration files
npm run db:migrate                 # run migrations
npm run db:seed                    # seed initial data (guarded)
npm run db:seed-inventory          # seed inventory data
npm run db:seed-hr                 # seed HR data
npm run db:studio                  # open Drizzle Studio
npm run db:migrate-payment-foundation  # payment methods/accounts bootstrap
npm run db:migrate-phase16b        # payments.idempotency_key + unique index (Phase 16B)
npm run payments:verify            # verify payment foundation setup
npm run payments:backfill          # one-time payment row backfill
npm run reconcile:payments         # READ-ONLY payment reconciliation (R1–R12, Phase 16C-B)
npm run test:money                 # money math unit tests (node:test via tsx, no DB — Phase 16D)
npm run db:check-migrations        # READ-ONLY schema-vs-code check; exit 1 = deploy blocked (Phase 16E)
```

---

## Seed Credentials

```
owner@shabu.local    / password123   role: owner
cashier@shabu.local  / password123   role: cashier
kitchen@shabu.local  / password123   role: kitchen
host@shabu.local     / password123   role: cashier (queue/tables modules)
```

---

## Coding Rules

### TypeScript
- `strict: true` — no `any`, no `as unknown as X` unless absolutely necessary with a comment
- Infer types from Drizzle schema: `type Session = typeof sessions.$inferSelect`
- Export only what other modules need; keep helpers file-local

### Components
- Server Components by default; add `'use client'` only for interactivity (hooks, events, browser APIs)
- Reuse existing `components/ui/` before creating new components
- Reuse existing `components/shared/` layouts
- No default exports in server action files
- `cn()` for conditional classes, never string template literals for classes

### Forms
- All forms: react-hook-form + Zod schema + `@hookform/resolvers/zod`
- Validate in both Zod schema (client) and server action (server)
- Never submit raw `FormData` — parse through Zod first

### Data Fetching
- Admin/staff pages: server components fetch directly via server actions or db queries
- Real-time pages: TanStack Query `useQuery` with `refetchInterval`
- Customer pages: TanStack Query for order polling

### Imports
- Use `@/` path aliases for all project imports
- Never use relative `../../` imports across feature boundaries
- `import type` for type-only imports

### Error Handling
- Server actions: return `{ ok: false, error: string }` — never throw
- Client components: `sonner` toast for user-facing errors
- Never swallow errors silently; always surface to the user or log to audit

### File Naming
- Pages: `page.tsx`
- Layouts: `layout.tsx`
- Components: PascalCase (`PosTerminal.tsx`)
- Actions: camelCase file names (`pos.ts`, `hr.ts`)
- Zod schemas: match action file names in `lib/validations/`

---

## Root Hygiene Rules

- **Root is for config only.** Only keep files that tooling requires at root: `CLAUDE.md`, `AGENTS.md`, `README.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `components.json`, `drizzle.config.ts`, `next.config.ts`, `vercel.json`, `eslint.config.mjs`, `postcss.config.mjs`, `proxy.ts`, `auth.ts`, `.env*`, `.gitignore`.
- **Temp scripts go in `scripts/`**, never at root. If they were one-off and are complete, move to `scripts/archive/`.
- **Audit and analysis documents go in `docs/archive/`**, never at root.
- **V2 planning documents go in `docs/reui-v2/`**, not at root.
- **If `eslint.config.mjs` has entries for temp files that no longer exist, remove them immediately.**

---

## Protected Files — Production Freeze

Full policy: `docs/production/01_PROTECTED_FILES_POLICY.md`. Any change to a file below requires an explicit phase prompt that states: **phase name · reason · verification steps (typecheck/lint) · manual UAT steps**. "The user asked for a UI tweak nearby" is not sufficient authorization.

### Critical — Business Logic (Frozen)
```
lib/db/schema.ts
lib/actions/pos.ts
lib/actions/sessions.ts
lib/actions/shifts.ts
lib/actions/tables.ts
lib/actions/history.ts
lib/actions/inventory.ts
lib/actions/hr.ts
lib/actions/payment-settings.ts
lib/actions/discounts.ts
lib/actions/tax-invoice.ts
lib/payments/foundation.ts
lib/auth/config.ts
lib/auth/permissions.ts
lib/printer/*
lib/utils/billConfig.ts
proxy.ts
auth.ts
```

### High Risk — Operational UI (Touch-Safe Redesign Only)
```
components/staff/PosTerminal.tsx
components/staff/KdsBoard.tsx
components/staff/TableGrid.tsx
components/staff/QueueBoard.tsx
components/staff/ShiftWidget.tsx
app/(customer)/t/[tableToken]/s/[sessionToken]/page.tsx
app/(staff)/layout.tsx
app/(admin)/layout.tsx
```

### Infrastructure (Explicit Approval Required for Any Change)
```
package.json (dependency changes require explicit approval)
next.config.ts
vercel.json
drizzle.config.ts
app/globals.css (token changes; additions OK, editing existing tokens needs approval)
```

---

## What Not to Do

- Do not split `lib/db/schema.ts` — all schema stays in one file
- Do not add Prisma, Mongoose, or any other ORM
- Do not add WebSocket, Pusher, Ably, or SSE — use polling
- Do not add a payment gateway (Stripe, Omise, etc.) — record method/amount only
- Do not apply ReUI or data-table patterns to POS, KDS, Tables, or Queue screens
- Do not replace POS numpad/tile UI with form inputs
- Do not add `console.log` in production server actions — use `writeAuditLog` for audit events
- Do not use `Math.random()` for IDs — use `nanoid()` or db-generated UUIDs
- Do not read `pricingTiles.price` at checkout — use the snapshot in `sessionGuests.unitPrice`
- Do not modify `paymentAdjustments` rows — append only, never update/delete
- Do not run `npm run build` or `npm run db:push` without explicit user approval
- Do not deploy while `npm run db:check-migrations` fails against the target database (see `docs/architecture/MIGRATIONS.md`)
- Do not install new dependencies without explicit user approval
- Do not create temp scripts at root — use `scripts/` directory
- Do not use Playwright — it has been removed from this project
- Do not add new feature modules while the Phase 16 hardening feature freeze is active
- Do not build Food Cost / COGS features — deferred until accounting/stock/recipe costing is reliable
- Do not modify protected files without an explicit phase prompt (see `docs/production/01_PROTECTED_FILES_POLICY.md`)

---

## Phase Progress

- [x] Phase 1 — Foundation (scaffold, schema, seed)
- [x] Phase 2 — Auth (NextAuth v5, role guards, module access)
- [x] Phase 3 — Table Management (floor plan, sessions, QR)
- [x] Phase 4 — Customer Ordering (QR menu, cart, order tracking)
- [x] Phase 5 — Kitchen Display (KDS by station, status transitions)
- [x] Phase 6 — Queue System (host management, public status)
- [x] Phase 7 — POS (cashier terminal, pricing tiles, receipt printing)
- [x] Phase 8 — Owner Dashboard (KPI, charts, reports)
- [x] Phase 8B — Payment Foundation (multi-row payments, charge lines, shifts, allocations)
- [x] Phase 9 — Polish + Deploy
- [x] Phase 10 — Inventory (ingredients, suppliers, POs, stock counts)
- [x] Phase 11 — HR & Payroll (employees, schedules, time tracking, payroll cycles)
- [x] Phase 12 — V2 UI Revamp (admin shell, admin pages, staff touch polish, customer QR, dark mode for admin)
- [x] Phase 13 — Pricing tiles foundation, role refactor, customer QR deeper redesign
- [x] Phase 14 — Performance audit, admin dashboard/report premium upgrades, agent instructions (AGENTS.md)
- [x] Phase 15 — Android POS bridge app · premium queue board + customer queue page · reports revamp (revenue/tables/queue/kitchen) · 15BILL A–I account-based bill templates + Thai payment labels · 15PAY payment popup redesign · 15Q
- [ ] **Phase 16 — Production Hardening** ← current (see `docs/production/00_HARDENING_ROADMAP.md`)
  - [x] Phase 16G-A — Same-day cash shift backfill tool (owner/manager, audited; UAT pending)
  - [x] Phase 16A — Clean working tree + governance resync
  - [x] Phase 16B — Payment idempotency + double-submit protection (migration `db:migrate-phase16b` must run before deploy; UAT pending)
  - [ ] Phase 16C — Money write transaction strategy
    - [x] 16C-A — Audit + strategy (see `docs/production/02_TRANSACTION_STRATEGY.md`)
    - [x] 16C-B — Reconciliation script `npm run reconcile:payments` (read-only, R1–R12; prod baseline run pending)
    - [ ] 16C-C — Batch-atomic money writes (`db.batch()`, current driver)
      - [x] 16C-C1 — processPayment write phase batch-atomic (UAT pending)
      - [x] 16C-C2A — delete/reopen batch-atomic + payment_allocations FK bug fix (UAT pending)
      - [x] 16C-C2B — updateSessionGuests + openSession batch-atomic (UAT pending)
      - [x] 16C-C3 — tax-invoice generator RETURNING race fix (UAT pending)
    - [ ] 16C-D — (optional, after 16D) dual-client interactive transactions
  - [x] Phase 16D — Money math test harness (`npm run test:money`, node:test via tsx, 70 tests; golden extractions in `lib/payments/money-math.ts`)
  - [x] Phase 16E — Migration baseline & governance (`npm run db:check-migrations`; policy in `docs/architecture/MIGRATIONS.md`; pending: `tile_category` `'penalty'` enum value)
  - [x] Phase 16F — UAT pack + go-live runbook docs (`docs/uat/UAT_SCRIPTS.md`, `docs/ops/GO_LIVE_CHECKLIST.md`, `docs/ops/RUNBOOK.md`, `docs/ops/INCIDENT_PLAYBOOK.md`) — **UAT execution + Vercel DB confirmation + penalty-enum decision still pending; push/deploy blocked until Go-Live Gate 1 passes**

Historical V2 plan: `docs/reui-v2/00_MASTER_PLAN.md` (completed; kept for reference).

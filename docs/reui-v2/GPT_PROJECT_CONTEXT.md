# Shabu Buffet ERP — Project Context & V2 Revamp Brief

> **Purpose:** This document is a complete briefing for an AI assistant (ChatGPT or similar).
> Read the entire document before answering any question or writing any code.
> This is a real production web application. Do not guess or invent details not stated here.

---

## 0. What This Project Is

A full-stack **ERP/POS SaaS** web application for a Thai shabu buffet restaurant chain.
It covers the entire operations loop:

```
Customer scans QR code at table
  → Orders from digital menu
  → Kitchen sees order on KDS screen
  → Cashier checks out table via POS terminal
  → Owner sees analytics on admin dashboard
```

Additional modules: inventory management, HR & payroll, supplier management, stock counts, purchase orders, queue system, table floor plan.

**Language:** UI text is Thai throughout. Code identifiers and comments are English. Currency is THB (฿).

**Current status:** Phases 1–11 complete and in production. Phase 12 = V2 UI revamp (in planning, not started yet).

---

## 1. Tech Stack (Exact Versions)

| Layer | Tool | Version |
|---|---|---|
| Framework | Next.js App Router | 16.2.6 |
| Language | TypeScript strict | ^5 |
| Styling | Tailwind CSS v4 (CSS-first config) | ^4 |
| UI components | shadcn/ui (style: base-nova, neutral base) | ^4.8.1 |
| Icons | lucide-react | ^1.16.0 |
| Font | IBM Plex Sans Thai | weight 400/500 only |
| ORM | Drizzle ORM | ^0.45.2 |
| Database | Neon PostgreSQL (serverless) | ^1.1.0 |
| Auth | Auth.js v5 / next-auth beta | ^5.0.0-beta.31 |
| Data fetching | TanStack React Query v5 | ^5.100.14 |
| Cart state | Zustand | ^5.0.13 |
| Validation | Zod | ^4.4.3 |
| Forms | react-hook-form + @hookform/resolvers | ^7 / ^5 |
| Charts | recharts | ^3.8.1 |
| Drag and drop | @dnd-kit/core + sortable | ^6 / ^10 |
| Toasts | sonner | ^2.0.7 |
| Date utilities | date-fns / date-fns-tz (Asia/Bangkok) | ^4 / ^3 |
| Printer | @point-of-sale/receipt-printer-encoder | ^3.0.3 |
| Image storage | @vercel/blob | ^2.4.0 |
| Rate limiting | @upstash/ratelimit + @upstash/redis | ^2 / ^1 |
| QR codes | qrcode | ^1.5.4 |
| IndexedDB | idb-keyval | ^6.2.4 |
| Command palette | cmdk | ^1.1.1 |
| Animations | tw-animate-css | ^1.4.0 |
| Password hashing | bcryptjs | ^3.0.3 |
| ID generation | nanoid | ^5.1.11 |
| Email | resend | ^6.12.4 |
| Deployment | Vercel (region: sin1) | — |

**Not installed / not used:**
Prisma, Mongoose, WebSocket, SSE, Pusher, Ably, Stripe, Omise, React Native, Redux, MUI, Mantine, Radix standalone, any other ORM.

**Playwright was installed but will be removed in Phase 12 cleanup.**

---

## 2. Repository Structure

```
d:/dev/lumhimkhue-erp/          ← project root (Windows)

app/
  (admin)/                      → Owner-only back-office (role: owner)
    dashboard/                  → KPI overview + charts
    menu/                       → Menu item CRUD
    pricing-tiles/              → Guest types, add-ons, discounts, loyalty tiles
    users/                      → Staff user management
    settings/                   → Store name, contact, tax ID, bill layout
    branches/                   → Branch management
    system/                     → System admin
    reports/                    → Report hub
    reports/audit/              → Audit log viewer
    hr/                         → HR dashboard
    hr/employees/               → Employee directory
    hr/schedule/                → Schedule cycles
    hr/time/                    → Time entry / attendance
    hr/payroll/                 → Payroll cycles list
    hr/payroll/[id]/            → Payroll detail
    hr/settings/                → HR config
    inventory/                  → Inventory dashboard
    inventory/ingredients/      → Ingredient master
    inventory/suppliers/        → Supplier management
    inventory/count/            → Stock count entry
    inventory/orders/           → Purchase orders list
    recipes/                    → Recipe builder
    pricing/                    → LEGACY — redirect to pricing-tiles
  (staff)/                      → Operations staff (cashier / kitchen / host)
    pos/                        → POS cashier terminal
    pos/history/                → Payment history
    pos/shifts/                 → Cashier shift management
    kds/                        → Kitchen Display System
    kds/history/                → KDS order history
    queue/                      → Queue management
    queue/history/              → Queue history
    tables/                     → Floor plan + table management
    tables/history/             → Session history
    printers/                   → Printer configuration
    payment-settings/           → Payment methods & receiving accounts
  (customer)/                   → Public QR-accessible, no auth required
    q/[queueToken]/             → Queue status display
    t/[tableToken]/             → Table entry point
    t/[tableToken]/s/[sessionToken]/        → Customer ordering interface
    t/[tableToken]/s/[sessionToken]/orders/ → Customer order tracking
  (auth)/
    login/                      → Credential login form
  page.tsx                      → Root redirect by role
  unauthorized/                 → Role-denied fallback
  layout.tsx                    → Root layout (QueryProvider, Toaster)
  globals.css                   → Tailwind v4 CSS config + all theme tokens

  api/
    auth/[...nextauth]/         → NextAuth handler
    print/network/              → Network printer relay (TCP 9100)
    img/[menuItemId]/           → Menu item image serving
    upload/                     → Blob image upload
    cron/daily-report/          → Daily closing report cron
    debug/db-rtt/               → DB latency test
    health/                     → Health check

components/
  admin/                        → Admin UI components (owner dashboard, CRUD pages)
    hr/                         → HR sub-components
  staff/                        → POS, KDS, Queue, Tables, History, ShiftWidget
  customer/                     → CustomerMenuPage, OrderList, QueueStatus
  shared/                       → SidebarLayout, CashierLayout, StandardSidebarLayout,
                                   QueryProvider, ConfirmDialog, ErrorBoundary,
                                   nav-config.ts, cashier-header-slot.ts
  ui/                           → shadcn/ui primitives + custom:
                                   app-shell, data-table, empty-state, loading-skeleton,
                                   page-header, section-card, stat-card, status-badge,
                                   form-section, input-group, table-map, chart

lib/
  db/
    schema.ts                   → ALL Drizzle schema — single file, DO NOT SPLIT
    index.ts                    → Neon serverless DB client
    seed.ts / seed-inventory.ts / seed-hr.ts → Data seeds
    migrate_v12.ts, migrate_v13.ts, migrate-*.ts → Historical migration scripts
  auth/
    config.ts                   → NextAuth config (JWT, callbacks, role guards)
    permissions.ts              → can(role, action) helper + PERMISSIONS matrix
    module-routes.ts            → Module code → route prefix mapping
    ratelimit.ts                → Upstash Redis login rate limiting
    require-active.ts           → isActive guard helper
  actions/                      → ALL server actions (never throw, always return {ok,data|error})
    pos.ts (867 lines)          → POS terminal, payment processing
    sessions.ts (794 lines)     → Session lifecycle (open/close/pay)
    shifts.ts (633 lines)       → Cashier shift management
    payment-settings.ts         → Payment methods + receiving accounts CRUD
    tables.ts                   → Table CRUD + status machine
    orders.ts                   → Kitchen order creation + status
    inventory.ts (1238 lines)   → Full inventory module
    hr.ts (883 lines)           → HR + payroll
    history.ts (1329 lines)     → All history queries + receipt reprint data
    dashboard.ts                → KPI metrics + charts data
    reports/*.ts                → 7 financial report actions
    menu.ts, pricing.ts, queue.ts, kds.ts, customers.ts, recipes.ts, store.ts,
    staff.ts, branches.ts, audit.ts, discounts.ts, tax-invoice.ts, reorder.ts,
    inventory-variance.ts, auth.ts (logout)
  validations/                  → Zod schemas matching every server action input
  payments/
    foundation.ts               → Default methods/accounts, checkout validation helpers
  printer/
    service.ts                  → Public API: print(job, printerId?)
    escpos.ts                   → ESC/POS command builders (Thai codepage cp874/thai13/11/42)
    bitmap.ts                   → Bitmap-mode Thai rendering (image fallback)
    templates.ts                → HTML receipt templates (browser fallback)
    types.ts                    → PrintJob, ReceiptData, KitchenOrderData, PrinterConfig
    store.ts                    → Default printer persistence (localStorage/idb-keyval)
    capabilities.ts             → Printer capability detection
    transports/usb.ts           → WebUSB transport
    transports/network.ts       → TCP/IP 9100 relay
    transports/browser.ts       → window.print() fallback
  store/
    cart.ts                     → Zustand cart (customer ordering only)
  utils/
    utils.ts                    → cn(), currency formatting, date utils
    billConfig.ts               → Bill layout resolver (A5 / 80mm)
  tokens.ts                     → Token generation for QR, queue, session identifiers
  perf.ts                       → Performance utility

proxy.ts                        → Next.js middleware (auth guard + x-current-path header)
auth.ts                         → NextAuth exports (re-export for app usage)
next.config.ts                  → Remote images, Turbopack, barrel tree-shaking, redirects
drizzle.config.ts               → Drizzle Kit config
components.json                 → shadcn/ui config (base-nova, neutral, CSS variables)
vercel.json                     → Region: sin1, Cron: daily-report at 16:30 UTC
eslint.config.mjs               → ESLint (next core-web-vitals + typescript)
tsconfig.json                   → strict: true, @/* path alias
.env.local                      → Secrets (gitignored)
playwright.config.ts            → TO BE DELETED in V2 cleanup
tests/e2e/*.ts                  → TO BE DELETED in V2 cleanup
scripts/e2e-seed.ts             → TO BE DELETED in V2 cleanup

docs/
  reui-v2/                      → V2 revamp plans (being created)
  archive/                      → Historical docs (moved from root)
```

---

## 3. Database Schema Summary

**All schema lives in `lib/db/schema.ts` as a single file. Never split it.**

### Key Enums

```
role:                  owner / manager / cashier / kitchen
tableStatus:           available / occupied / reserved / linked / paid
sessionStatus:         active / closing / closed / paid
orderStatus/itemStatus: pending / preparing / ready / served / cancelled
station:               meat / seafood / vegetable / noodle / dessert / drink / sauce
queueStatus:           waiting / called / seated / left
tileCategory:          guest / addon / discount / loyalty
discountType:          fixed / percentage
cashierShiftStatus:    open / closed / reviewed
paymentStatus:         completed / voided / refunded
paymentMethodType:     promptpay / cash / welfare / mixed_legacy / other
receivingAccountType:  bank_cash_group / welfare / cash_drawer / other
```

### Key Tables

| Table | Key Columns |
|---|---|
| `users` | id, email (unique), passwordHash, name, role, isActive, branchId, uiLayout, allowedModules, navLayout |
| `branches` | id, name, address, phone, taxId, isActive |
| `tables` | id, label, capacity, zone, status, qrToken, positionX/Y, width/height, shape, branchId, deletedAt |
| `sessions` | id, tableId, parentSessionId, branchId, status, sessionToken, taxInvoiceRequested, taxInvoiceNumber, billPrintedAt, startedAt, closedAt |
| `pricingTiles` | id, code, name, category, price, vatRate, vatIncluded, discountType, discountValue, sortOrder, isActive |
| `sessionGuests` | id, sessionId, pricingTileId, quantity, unitPrice (price snapshot — critical) |
| `buffetChargeLines` | id, sessionId, pricingTileId, chargeType, label, unitPrice, quantity, total, voidedAt |
| `payments` | id, sessionId, subtotal, serviceCharge, discount, total, paidAt, processedBy, receiptNo, shiftId, status, settlementType |
| `paymentRows` | id, paymentId, paymentMethodId, receivingAccountId, amount, amountTendered, changeAmount, referenceNo |
| `paymentMethods` | id, code (unique), name, type, requiresReference, allowOverpay, isActive |
| `receivingAccounts` | id, code (unique), name, type, bankName, accountLabel, isActive |
| `paymentAdjustments` | id, paymentId, type (void/refund/discount_correction), amount, reason, paymentSnapshot (jsonb) — IMMUTABLE LEDGER |
| `cashierShifts` | id, branchId, cashierId, status, openedAt, closedAt, openingFloat, expectedCash, actualCash |
| `menuItems` | id, categoryId, name, nameEn, imageUrl, isBuffet, extraPrice, maxPerOrder, cooldownSeconds |
| `orders` | id, sessionId, status |
| `orderItems` | id, orderId, menuItemId, itemName, quantity, station, status |
| `queueEntries` | id, queueNumber, customerName, phone, partySize, status, publicToken |
| `ingredients` | id, categoryId, name, unit, minStock, parLevel, lastCost, defaultSupplierId, countFrequency, yieldPercent |
| `suppliers` | id, name, contact info |
| `stockCounts` | id, countDate (unique), countedBy, status, branchId |
| `purchaseOrders` | id, poNumber (unique), supplierId, status, branchId |
| `employees` | id, userId nullable, branchId, type full_time/part_time, baseSalaryPerCycle, hourlyRate |
| `payrollCycles` | id, branchId, startDate, endDate, status |
| `payrollItems` | id, cycleId, employeeId, gross, totalDeduction, netPay, ssfEmployee, ssfEmployer |
| `auditLogs` | id, userId, action, entity, entityId, metadata jsonb |

---

## 4. Authentication & Permissions

### Auth System
- NextAuth v5, Credentials provider, JWT session strategy
- `proxy.ts` (renamed middleware) guards routes and sets `x-current-path` header
- Login rate limiting via Upstash Redis
- `isActive` flag — deactivated users cannot log in

### Two-Tier Authorization

**Tier 1 — Role-based route access:**
- `dashboard, menu, pricing*, users, settings, hr/*, inventory/*, recipes, reports/*, branches, system` → `owner` only
- `pos, pos/*` → owner, manager, cashier
- `kds, kds/*` → owner, manager, cashier, kitchen
- `queue, tables, printers, payment-settings` → all authenticated

**Tier 2 — Module access (for cashier/manager/kitchen):**
- Fresh DB read in `(staff)/layout.tsx` via x-current-path
- `users.allowedModules` array: `pos`, `kds`, `queue`, `tables`, `printers`
- Owner bypasses all module checks

### Permissions Matrix

```typescript
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

### Seed Credentials (dev)

```
owner@shabu.local    / password123   role: owner
cashier@shabu.local  / password123   role: cashier
kitchen@shabu.local  / password123   role: kitchen
host@shabu.local     / password123   role: cashier (queue/tables)
```

---

## 5. Server Actions Pattern

All server actions live in `lib/actions/*.ts`. This is the most important pattern in the codebase.

```typescript
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

  // 4. DB transaction for multi-step writes
  await db.transaction(async (tx) => { /* ... */ });

  // 5. Cache invalidation
  revalidatePath('/relevant-path');

  // 6. Return typed result
  return { ok: true, data: result };
}
```

**Return type is always:** `{ ok: true, data: T } | { ok: false, error: string }`

**Rules:**
- Never throw from a server action
- Never use `any`
- Zod validate every input
- Use `db.transaction()` for multi-step writes
- Call `revalidatePath()` after writes
- Write audit logs via `writeAuditLog` (fire-and-forget) for important user actions

---

## 6. UI Zones

This codebase has **three strictly separated UI zones** with different design rules.

### Zone 1 — Customer (QR / Mobile)
**Routes:** `(customer)/t/*`, `(customer)/q/*`

- Mobile-first, 375px min-width
- Large touch targets (min 44px)
- Minimal text, strong imagery
- Thai language throughout
- TanStack Query polling: 10s for orders, 10s for queue status, 5s for unserved check
- **No data-table, no sidebar, no admin patterns here**

### Zone 2 — Operational Staff (POS / KDS / Queue / Tables)
**Routes:** `(staff)/pos`, `(staff)/kds`, `(staff)/queue`, `(staff)/tables`

- Touch-optimized, large buttons, minimal animation, instant feedback
- POS: 2-column layout (session list left, detail/numpad right)
- KDS: card board layout by station, bold status colors
- Tables: floor-plan grid with drag-and-drop (dnd-kit)
- Queue: card-per-entry, large font, called/seated states
- No small fonts, no hover-only interactions
- Polling: KDS 3s, POS 5s, Tables 5s, Queue 5s
- **Custom touch components — do NOT replace with admin-style forms or DataTable**

### Zone 3 — Admin / Back-office
**Routes:** `(admin)/*`, `(staff)/printers`, `(staff)/payment-settings`, `(staff)/pos/shifts`

- Tablet/desktop, 768px+
- IBM Plex Sans Thai, weight 400/500 only
- Navy blue primary: `oklch(0.30 0.11 248)`
- Dark ink sidebar: `oklch(0.155 0.04 248)`
- Flat clean design — no gradients, no heavy shadows
- `rounded-lg` (8px) default border radius
- shadcn/ui base-nova components
- **ReUI patterns are the standard here** (see Section 9)
- Polling: Dashboard 60s; most admin pages no polling

---

## 7. Theme & Styling System

### CSS Token System (in `app/globals.css`)

```css
/* Primary */
--primary: oklch(0.30 0.11 248);          /* navy blue */
--primary-foreground: oklch(0.98 0 0);

/* Page background */
--background: oklch(0.962 0.005 248);
--foreground: oklch(0.145 0.012 248);

/* Surface elevation layers */
--surface-0: oklch(0.960 0.005 248);      /* page background */
--surface-1: oklch(1 0 0);               /* card / panel (pure white) */
--surface-2: oklch(0.950 0.006 248);     /* inset well, table header, input bg */
--surface-raised: oklch(1 0 0);          /* popover / dialog */

/* Primary tinted surfaces */
--surface-primary-subtle: oklch(0.95 0.03 248);
--surface-primary-muted:  oklch(0.90 0.06 248);

/* Elevation shadows */
--shadow-card:   0 1px 3px oklch(0 0 0 / 8%), 0 1px 2px oklch(0 0 0 / 5%);
--shadow-raised: 0 6px 16px oklch(0 0 0 / 12%), 0 2px 6px oklch(0 0 0 / 7%);
--shadow-dialog: 0 20px 60px oklch(0 0 0 / 18%), 0 8px 20px oklch(0 0 0 / 10%);

/* Semantic status tokens (bg/fg/border for each state) */
--status-success-bg/fg/border
--status-danger-bg/fg/border
--status-warning-bg/fg/border
--status-info-bg/fg/border
--status-neutral-bg/fg/border
--status-purple-bg/fg/border
--status-orange-bg/fg/border
--status-cyan-bg/fg/border

/* Sidebar (ink/dark navy) */
--sidebar: oklch(0.155 0.04 248);
--sidebar-foreground: oklch(0.75 0.02 248);
--sidebar-active: oklch(0.22 0.06 248);
--sidebar-active-foreground: oklch(0.98 0 0);
--sidebar-header: oklch(0.12 0.05 248);
```

**Full dark mode** is defined — all tokens have `.dark {}` overrides.

### Utility Classes (in `app/globals.css`)

```css
/* Typography */
.text-page-title    → 2xl bold tracking-tight
.text-section-title → 13px semibold
.text-label         → 10px semibold uppercase tracking-widest muted
.text-value-2xl     → 28px bold tabular-nums
.text-value-xl      → 2xl bold tabular-nums
.text-hint          → 11px muted-foreground
.text-error         → 11px destructive

/* Layout */
.page-shell         → mx-auto max-w-[1400px] px-6 py-5 space-y-6
.section-card       → rounded-xl bg-surface-1 border shadow-card
.ds-table           → standard data table styles
.badge-base         → inline-flex badge pill
.form-field/.form-label/.form-input/.form-hint/.form-error
.action-row         → flex flex-wrap items-center gap-2
```

### Rules

- Never add a new CSS file — extend `globals.css` or use Tailwind classes
- Never use `style={{}}` except for dynamic values (position coordinates, width%)
- Use `cn()` from `@/lib/utils` for conditional class merging
- All icon-only buttons must have `aria-label`
- WCAG AA contrast on all text

---

## 8. Existing UI Component Library (`components/ui/`)

These components are already built and must be used before creating new ones:

| Component | Purpose |
|---|---|
| `app-shell.tsx` | `AppShell` — page wrapper, max-w-[1400px], px-6 py-5 |
| `badge.tsx` | shadcn Badge |
| `button.tsx` | shadcn Button |
| `calendar.tsx` | shadcn Calendar (react-day-picker) |
| `card.tsx` | shadcn Card |
| `chart.tsx` | Recharts wrapper (ChartContainer, Bar, Pie, etc.) |
| `collapsible.tsx` | shadcn Collapsible |
| `command.tsx` | shadcn Command (cmdk) |
| `data-table.tsx` | Generic DataTable with column defs, sort, pagination |
| `dialog.tsx` | shadcn Dialog |
| `dropdown-menu.tsx` | shadcn DropdownMenu |
| `empty-state.tsx` | `EmptyState` — icon + title + message for zero-data |
| `form-section.tsx` | Form group with title + description |
| `input-group.tsx` | Input with prefix/suffix addons |
| `input.tsx` | shadcn Input |
| `label.tsx` | shadcn Label |
| `loading-skeleton.tsx` | `LoadingSkeleton` — animated skeleton for loading states |
| `page-header.tsx` | `PageHeader` — title + subtitle + slot for action buttons |
| `popover.tsx` | shadcn Popover |
| `section-card.tsx` | `SectionCard` — content card with optional header |
| `select.tsx` | shadcn Select |
| `separator.tsx` | shadcn Separator |
| `sheet.tsx` | shadcn Sheet — side panel/drawer (use for forms) |
| `skeleton.tsx` | shadcn Skeleton primitive |
| `stat-card.tsx` | `StatCard` + `StatCardGrid` — KPI metric cards |
| `status-badge.tsx` | `StatusBadge` — semantic colored badge using CSS token variants |
| `table-map.tsx` | Table floor plan map component |
| `table.tsx` | shadcn Table primitive |
| `tabs.tsx` | shadcn Tabs |
| `textarea.tsx` | shadcn Textarea |

---

## 9. V2 Revamp — Goals and Direction

### Why V2?

The current app works correctly but lacks a "new product" feeling. Pages are functional but inconsistent — some use DataTable, some use ad-hoc tables, some use Dialogs for forms, some use custom flows. V2 establishes a unified visual language across all admin pages and refreshes the operational and customer zones.

**Business logic is NOT being rewritten. Server actions are frozen.**

### V2 Design Goals

1. **Unified admin shell** — consistent sidebar, page skeleton, and component patterns
2. **Sheet-based forms** — all create/edit in admin use right-side Sheet drawers, not Dialogs
3. **DataTable everywhere** — all admin list pages use the existing `data-table.tsx` with consistent filter bars
4. **StatCard grids** — dashboard and module overviews use the `StatCard` pattern
5. **Semantic status everywhere** — `StatusBadge` with the token system, not ad-hoc colored divs
6. **Empty states** — zero-data states always show `EmptyState` with contextual message
7. **Skeleton loading** — every async section shows `LoadingSkeleton` while fetching
8. **Touch refresh (not rewrite)** — POS/KDS/Queue/Tables get cosmetic improvements only
9. **Mobile customer redesign** — the QR ordering experience gets a full brand-level redesign
10. **Login page polish** — centered card, logo, cleaner form

### V2 Admin Page Skeleton (every admin list page)

```
PageHeader
  title + subtitle
  action button: [+ เพิ่ม] (opens Sheet)
──────────────────────────────────
Filter bar (inside section-card top)
  search input | status dropdown | date picker | [reset]
──────────────────────────────────
DataTable
  column headers (sortable)
  row data with StatusBadge
  row action: DropdownMenu with "แก้ไข" / "ลบ" / other
  pagination
──────────────────────────────────
Sheet (right drawer, opens on Add/Edit)
  form with react-hook-form + Zod
  [บันทึก] [ยกเลิก]
```

### V2 Component Standards

| Pattern | Rule |
|---|---|
| Create/Edit forms | Always in `Sheet` (right drawer), never full-page or Dialog |
| Destructive actions | Always `ConfirmDialog` first |
| List pages | `PageHeader` + filter bar + `DataTable` — no exceptions |
| Zero data | Always `EmptyState` component |
| Loading state | Always `LoadingSkeleton` while fetching |
| KPIs / stats | `StatCard` + `StatCardGrid` |
| Status values | `StatusBadge` with semantic variants |
| Class merging | `cn()` from `@/lib/utils` — never template literals |
| Icons | lucide-react only — no other icon libraries |
| Form wiring | react-hook-form + Zod + @hookform/resolvers — no uncontrolled inputs |

### Where ReUI Patterns Are Welcome

- Admin dashboards, reports, settings forms
- DataTables with filters
- HR forms, inventory CRUD, payroll tables
- Empty states, dialogs/modals, badges, stat cards, section cards, page headers

### Where ReUI Must NOT Be Applied

- POS cashier screens (`/pos`)
- KDS board (`/kds`)
- Tables floor plan (`/tables`)
- Queue board (`/queue`)
- Customer ordering pages (`/t/*`, `/q/*`)

---

## 10. POS and Payment Business Rules (CRITICAL — Do Not Change)

### Session Lifecycle

```
openSession()  → session.status: active
  ↓ customer places orders
closeSession() → session.status: closing  (triggers checkout UI in POS)
  ↓ processPayment()
payment recorded → session.status: paid
  ↓ table freed → table.status: available
```

### Payment Model

- Each checkout = 1 `payments` row (summary) + 1+ `paymentRows` (per method/account)
- Mixed payment supported: cash + QR on same bill via multiple `paymentRows`
- `paymentAdjustments` = **immutable append-only audit ledger** — never delete/update rows
- `settlementType`: `partial` = deposit taken, session still open; `final` = session closed
- `billTotalAtPayment` snapshot prevents total drift when prices change mid-session
- Prices are **snapshotted** into `sessionGuests.unitPrice` at session open — never re-read live tile prices at checkout

### Cashier Shifts

- A shift MUST be open before processing payments (`cashierShifts.status = open`)
- `openingFloat` set at shift open
- `expectedCash` calculated from cash payment rows
- `actualCash` from physical count at close
- `cashDifference = actualCash − expectedCash`; requires `differenceReason` if non-zero

### Linked Tables (Group Bills)

- `sessions.parentSessionId` → child sessions linked to parent
- `tableStatus = 'linked'` on child tables
- Bill charged on parent session; child sessions close when parent closes

---

## 11. Inventory Business Rules

- `ingredients.countFrequency` (daily/weekly) controls which items appear on today's stock count
- `stockCounts` keyed by `countDate` (unique) — one count per day per branch
- PO status flow: `draft → pending_approval → ordered → partial_received → received | cancelled`
- `goodsReceiptItems.receivedQuantity` can be less than ordered → status `partial_received`
- `ingredients.yieldPercent` affects recipe costing
- Variance reasons per received item: `none / short / wrong / spoiled`

---

## 12. HR & Payroll Business Rules

- Employee types: `full_time` (monthly `baseSalaryPerCycle` + daily `incentivePerDay`) vs `part_time` (hourly `hourlyRate`)
- Payroll calculation: gross → deductions (absence, late, advance, damage) → SSF → WHT → net
- `hrSettings` is a singleton row — one per installation
- `scheduleEntries` unique: `(cycleId, employeeId, workDate)`
- `payrollItems` snapshots salary at calculation time

---

## 13. Polling Intervals (TanStack Query — Do Not Change)

| Page | refetchInterval |
|---|---|
| KDS | 3 s |
| Tables grid | 5 s |
| POS sessions | 5 s |
| POS session detail | 10 s |
| Queue (host) | 5 s |
| Customer "my orders" | 10 s |
| Customer unserved check | 5 s |
| Queue (customer) | 10 s |
| Dashboard | 60 s |

**No WebSockets. No SSE. All real-time is poll-based.**

---

## 14. Printer Integration

```
Component → print(job) → lib/printer/service.ts → ESC/POS bytes or HTML
                                                 ↓
                              USB (WebUSB) / Network (TCP 9100) / Browser (window.print)
```

Thai text: primary via cp874/thai13/thai11/thai42 codepage. Fallback: bitmap mode (render as image). This is fragile — do not modify without deep understanding.

---

## 15. Phase 12 — V2 Revamp Plan

### Phase 0: Cleanup (No Production Risk)

**What to delete:**
- `playwright.config.ts` (root)
- `tests/e2e/` (entire directory — 5 files)
- `scripts/e2e-seed.ts`
- `verify_bill_temp.mjs` (root temp)
- `verify_render_temp.ts` (root temp)
- `C:UsersUserAppDataLocalTempverify_tables.mjs` (garbled temp file)
- `shabu-erp-prompt.md` (original Thai spec, superseded by CLAUDE.md)

**package.json scripts to remove:**
- `"e2e:seed"`, `"test:e2e"`, `"test:e2e:ui"`

**package.json devDependencies to remove:**
- `"@playwright/test"`, `"@axe-core/playwright"`

**Files to move to `docs/archive/`:**
- `AUDIT_POS_ARCHITECTURE.md`
- `PERFORMANCE_AUDIT.md`
- `PERFORMANCE_BASELINE.md`
- `POLLING_AUDIT.md`
- `docs/reui-polish/*`

**Files to move to `scripts/archive/`:**
- All `scripts/audit-phase1-*.ts`
- `scripts/backfill-payment-rows.ts`
- `scripts/verify-payment-foundation.ts`
- `scripts/verify-phase1-schema.ts`
- `scripts/migrate-images.ts`

### Phase 1: Admin App Shell Redesign
- Redesign `StandardSidebarLayout.tsx` — collapsible rail on md, expanded on lg
- Better nav group sections with collapse/expand
- Collapsible to icon-only rail at 768px
- Logo area in sidebar header
- User info + logout at sidebar bottom

### Phase 2: Admin Core Pages (Dashboard, Menu, Users, Settings)
- Dashboard: richer StatCard grid (4-col), period selector, chart improvements
- Menu: image-grid view, Sheet-based edit with image crop
- Users/Staff: DataTable + role filter + Sheet edit
- Settings: tabbed form (Store / Bill / Tax), live bill preview

### Phase 3: Admin Inventory Module
- Ingredients: DataTable with stock-level color indicators, Sheet edit
- Suppliers: DataTable + Sheet edit
- Purchase Orders: status-filtered DataTable with approval actions
- Inventory Dashboard: better stat summary
- Stock Count: keep specialized UI, polish only

### Phase 4: Admin HR & Payroll Module
- Employees: DataTable + Sheet edit + type filter
- Schedule: calendar grid polish, keep structure
- Time entries: DataTable with inline clock-in/out
- Payroll list: status badges, better layout
- Payroll detail: structured payslip breakdown
- HR Settings: clean form

### Phase 5: Admin Reports & Remaining Pages
- Reports hub: tile-based navigation, not list
- Individual reports: consistent filter bar + DataTable + export
- Audit log: expandable rows for detail
- Recipes: split-pane ingredient assignment
- Pricing Tiles: tile preview cards + drag reorder
- Branches: DataTable

### Phase 6: Operational Staff Polish (Touch-Safe)
- POS: cosmetic polish only — session cards, payment Sheet instead of Dialog
- Cashier shifts: better open/close form, history table
- Payment settings: Sheet-based edit for methods/accounts (already partially done)
- KDS: station card upgrade (elapsed time indicator, better status colors)
- Tables: side Sheet for table actions instead of Dialog
- Queue: card layout polish

### Phase 7: Customer QR Redesign
- Brand header with restaurant name + table number + timer
- Category tabs: horizontal scroll with icons, sticky
- Menu cards: image-first 2-col grid
- Cart: floating bottom chip → Sheet drawer
- Order tracking: visual prep-stage cards
- Queue status: "waiting room" card redesign
- Login page: centered card + brand logo

---

## 16. Protected Files — Never Modify Without Explicit Approval

### Critical (Business Logic)

```
lib/db/schema.ts
lib/actions/pos.ts
lib/actions/sessions.ts
lib/actions/shifts.ts
lib/actions/tables.ts
lib/actions/history.ts
lib/actions/inventory.ts
lib/actions/hr.ts
lib/payments/foundation.ts
lib/auth/config.ts
lib/auth/permissions.ts
lib/printer/*
proxy.ts
```

### High Risk (Operational UI)

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

### Infrastructure (Explicit Approval Required)

```
package.json (dependency changes)
next.config.ts
vercel.json
drizzle.config.ts
app/globals.css (token changes — additions OK, editing existing tokens needs approval)
```

---

## 17. Absolute Rules

1. **No Prisma** — Drizzle ORM only
2. **No WebSocket / SSE / Pusher** — polling only
3. **No external payment gateway** — record method and amount only
4. **No Redis** — Upstash only (rate limiting)
5. **No new UI libraries** — shadcn/ui + custom components only
6. **No React Native** — web only
7. **No `console.log` in server actions** — use `writeAuditLog` for audit events
8. **No `Math.random()` for IDs** — use `nanoid()` or DB-generated UUIDs
9. **Do not read `pricingTiles.price` at checkout** — use snapshot in `sessionGuests.unitPrice`
10. **Do not modify `paymentAdjustments`** — append only, never update or delete
11. **Do not split `lib/db/schema.ts`** — all schema stays in one file
12. **Do not run `npm run build` or `npm run db:push`** without explicit user approval
13. **Do not install new dependencies** without explicit user approval
14. **Server actions never throw** — always return `{ ok: false, error: string }`
15. **Never use `any` in TypeScript** — infer types from Drizzle schema
16. **All forms** must use react-hook-form + Zod + @hookform/resolvers
17. **`cn()` only** for conditional class merging — never template literals for classes
18. **Use `@/` path aliases** — never relative `../../` across feature boundaries
19. **`import type`** for type-only imports
20. **Thai in UI text** — English in code identifiers and comments
21. **THB currency format** — `฿` prefix, 2 decimal places

---

## 18. Database Migration Scripts Reference

```bash
npm run db:push                        # push schema to Neon (dev only)
npm run db:generate                    # generate migration SQL
npm run db:migrate                     # run drizzle-kit migrations
npm run db:seed                        # seed initial data (guarded)
npm run db:seed-inventory              # seed inventory data
npm run db:seed-hr                     # seed HR data
npm run db:studio                      # open Drizzle Studio
```

---

## 19. Environment Variables Required

```bash
# Database
DATABASE_URL=                          # Neon pooled connection URL

# Auth
AUTH_SECRET=                           # NextAuth secret (32+ chars)
AUTH_TRUST_HOST=true                   # Required for Vercel

# Upstash (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Vercel Blob (image storage)
BLOB_READ_WRITE_TOKEN=

# App URL
NEXT_PUBLIC_APP_URL=                   # e.g. https://your-app.vercel.app

# Optional: Email
RESEND_API_KEY=
```

---

## 20. Current Root Directory State

```
Root files that should be in root (keep):
  CLAUDE.md, AGENTS.md, README.md
  package.json, package-lock.json
  tsconfig.json, components.json
  drizzle.config.ts, next.config.ts, vercel.json
  eslint.config.mjs, postcss.config.mjs
  proxy.ts, auth.ts
  next-env.d.ts (auto-generated)
  .env.local, .env.local.example, .gitignore

Root files that are CLUTTER (to clean up):
  playwright.config.ts          → DELETE
  shabu-erp-prompt.md           → DELETE (superseded)
  verify_bill_temp.mjs          → DELETE (temp script)
  verify_render_temp.ts         → DELETE (temp script)
  C:Users...verify_tables.mjs  → DELETE (garbled temp file)
  AUDIT_POS_ARCHITECTURE.md     → MOVE to docs/archive/
  PERFORMANCE_AUDIT.md          → MOVE to docs/archive/
  PERFORMANCE_BASELINE.md       → MOVE to docs/archive/
  POLLING_AUDIT.md              → MOVE to docs/archive/
  tsconfig.tsbuildinfo          → AUTO-GENERATED (gitignored, harmless)
```

---

*End of context document. This file is authoritative for all V2 revamp work.*
*Last updated: 2026-06-20*
*Project path: d:/dev/lumhimkhue-erp/*

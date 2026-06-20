# Phase 12.1–12.5 — Admin Revamp Plan

> Business logic is frozen. These phases change UI/UX only.
> All server action calls must remain identical.

---

## Phase 12.1 — Admin App Shell

**Files to change:**
- `components/shared/StandardSidebarLayout.tsx` — full rewrite
- `components/shared/SidebarLayout.tsx` — update to wire new layout
- `components/shared/nav-config.ts` — minor: add section metadata if needed

**Do NOT change:**
- `components/shared/CashierLayout.tsx` — operational staff, handled in Phase 12.6
- `app/(admin)/layout.tsx` — data fetching stays the same
- `app/(staff)/layout.tsx` — module guard stays the same

### New Sidebar Spec

```
Width: 260px (expanded), 64px (icon-only rail at md)
Breakpoint: collapse to rail at < 1024px, expand on hover

Structure:
  ┌────────────────────────────────┐
  │  Logo strip  (--sidebar-header)│  48px
  │  [logo or initials + app name] │
  ├────────────────────────────────┤
  │  Nav groups (collapsible)      │
  │  ├── Operations                │
  │  │   ├── แดชบอร์ด             │
  │  │   ├── เมนูอาหาร             │
  │  │   └── ราคาบุฟเฟต์           │
  │  ├── สต็อก/วัตถุดิบ ▾          │
  │  │   ├── ภาพรวม               │
  │  │   ├── วัตถุดิบ              │
  │  │   └── ...                  │
  │  ├── พนักงาน (HR) ▾            │
  │  └── รายงาน ▾                  │
  ├────────────────────────────────┤
  │  Settings / System             │
  ├────────────────────────────────┤
  │  User info + logout (bottom)   │
  └────────────────────────────────┘

Active item: bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]
Hover item: bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]
Inactive text: text-[var(--sidebar-foreground)]
```

---

## Phase 12.2 — Admin Core Pages

### Dashboard (`/dashboard`)

**Component:** `components/admin/DashboardPage.tsx`

Changes:
- 4-column StatCard grid (revenue, tables, covers, avg check) on desktop, 2-col on tablet
- Period selector: Today / สัปดาห์นี้ / เดือนนี้ — tab-style, not dropdown
- Revenue bar chart: improve tooltip, add horizontal grid lines
- Payment method pie: improve legend placement
- Table status summary: use StatusBadge grid (available / occupied / reserved)
- Add `LoadingSkeleton` while TanStack Query refetches

### Menu (`/menu`)

**Component:** `components/admin/MenuPage.tsx`

Changes:
- Replace list view with image-grid (3-col desktop, 2-col tablet, 1-col mobile)
- Category filter tabs above grid
- Each card: thumbnail + name + price + active badge + action (…) menu
- Create/edit → Sheet from right (not Dialog)
- Sheet includes: image upload with crop (`react-easy-crop` already installed), name/nameEn, category, price, isBuffet toggle, maxPerOrder, cooldownSeconds, allergens

### Users/Staff (`/users`)

**Component:** `components/admin/StaffPage.tsx`

Changes:
- DataTable with columns: ชื่อ, อีเมล, บทบาท (StatusBadge), สถานะ (StatusBadge), สาขา
- Filter: role dropdown, status dropdown (active/inactive)
- Row action (…): แก้ไข / ปิดใช้งาน
- Create/edit → Sheet (name, email, role, branch, allowedModules checkboxes)

### Settings (`/settings`)

**Component:** `components/admin/StoreSettingsForm.tsx`

Changes:
- Tabbed layout: ร้านค้า / บิล / ภาษี
- ร้านค้า tab: name, address, phone, tax ID, branch name
- บิล tab: paper width, logo, footer text, receipt counter — with live bill preview panel
- ภาษี tab: VAT %, tax invoice prefix, service charge %
- Auto-save with success toast

---

## Phase 12.3 — Inventory Module

### Inventory Dashboard (`/inventory`)

**Component:** `components/admin/InventoryDashboard.tsx`

Changes:
- StatCard row: total ingredients, below-minimum count (danger), below-par count (warning), pending POs
- Quick action buttons: นับสต็อก, สร้าง PO
- Recent stock count summary

### Ingredients (`/inventory/ingredients`)

**Component:** `components/admin/IngredientsPage.tsx`

Changes:
- DataTable columns: ชื่อ, หน่วย, สต็อกปัจจุบัน (with color: red < minStock, amber < parLevel, green ≥ parLevel), ราคาล่าสุด, ผู้ขายหลัก
- Filter: หมวดหมู่ dropdown, stock-level filter (ต่ำกว่า min / ต่ำกว่า par / ปกติ)
- Create/edit → Sheet

### Suppliers (`/inventory/suppliers`)

**Component:** `components/admin/SuppliersPage.tsx`

Changes:
- DataTable columns: ชื่อ, ติดต่อ, โทร, สินค้าที่จัดหา (count badge)
- Create/edit → Sheet

### Purchase Orders (`/inventory/orders`)

**Component:** `components/admin/PurchaseOrdersPage.tsx`

Changes:
- Status tabs: ทั้งหมด / รอดำเนินการ / สั่งซื้อแล้ว / รับบางส่วน / รับครบ / ยกเลิก
- DataTable per tab with columns: เลขที่ PO, ผู้ขาย, วันที่, ยอดรวม, สถานะ
- Row action: ดูรายละเอียด / อนุมัติ / ยกเลิก
- New PO → Sheet (not separate page) — or keep as page if complexity requires

### Stock Count (`/inventory/count`)

**Component:** `components/admin/StockCountPage.tsx`

Changes: polish only — badge styling, spacing. Keep the count-entry UI structure.

---

## Phase 12.4 — HR & Payroll Module

### HR Overview (`/hr`)

Changes:
- StatCard row: headcount, active this cycle, payroll total this cycle
- Quick links to sub-pages

### Employees (`/hr/employees`)

**Component:** `components/admin/hr/EmployeesPage.tsx`

Changes:
- DataTable: ชื่อ, ประเภท (full_time/part_time StatusBadge), เงินเดือน/ชั่วโมง, สาขา, SSF
- Filter: ประเภทพนักงาน dropdown
- Create/edit → Sheet

### Schedule (`/hr/schedule`)

**Component:** `components/admin/hr/SchedulePage.tsx`

Changes: visual polish only — cell styling, status colors. Keep calendar grid structure.

### Time Entries (`/hr/time`)

**Component:** `components/admin/hr/TimeEntriesPage.tsx`

Changes:
- DataTable with date filter, employee filter
- Clock-in/out display with elapsed time

### Payroll List (`/hr/payroll`)

**Component:** `components/admin/hr/PayrollListPage.tsx`

Changes:
- DataTable: รอบเดือน, สถานะ, จำนวนพนักงาน, ยอดรวม
- Status StatusBadge: draft / approved / paid

### Payroll Detail (`/hr/payroll/[id]`)

**Component:** `components/admin/hr/PayrollDetailPage.tsx`

Changes:
- Payslip breakdown: gross → deductions table → SSF → WHT → net
- Each employee as an expandable row in the payroll table
- Print button for payroll summary

### HR Settings (`/hr/settings`)

**Component:** `components/admin/hr/HrSettingsForm.tsx`

Changes: clean form layout with SectionCard grouping.

---

## Phase 12.5 — Reports & Remaining Pages

### Reports Hub (`/reports`)

**Component:** `components/admin/ReportsPage.tsx`

Changes:
- Tile-based navigation (not a list) — 6 tiles in 3×2 grid
- Each tile: icon + report name + one-line description
- Quick-access date presets (today / this week / this month)

### Individual Reports

All 6 reports get the same skeleton:
- `PageHeader` with report name + print button
- Filter bar: date range + method/type filter
- DataTable with summary totals row
- Footer: total row

### Audit Log (`/reports/audit`)

**Component:** `components/admin/AuditReportPage.tsx`

Changes:
- DataTable: วันที่, ผู้ใช้, การกระทำ, เป้าหมาย
- Expandable row: before/after JSON diff (formatted)
- Filter: user, action type, date range

### Pricing Tiles (`/pricing-tiles`)

**Component:** `components/admin/PricingTilesPage.tsx`

Changes:
- Category tabs: guest / addon / discount / loyalty
- Tile card grid — visual preview of each tile with drag handle
- Drag reorder using dnd-kit (already installed)
- Create/edit → Sheet

### Branches (`/branches`)

**Component:** `components/admin/BranchesPage.tsx`

Changes:
- DataTable: ชื่อสาขา, โทร, สถานะ
- Create/edit → Sheet

### Recipes (`/recipes`)

**Component:** `components/admin/RecipesPage.tsx`

Changes:
- Split-pane: menu item list (left) + ingredient assignment (right)
- Ingredient assignment: add/remove with quantity and unit

---

## Per-Phase Completion Checklist

For each sub-phase:
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — zero warnings on changed files
- [ ] Server action call signatures unchanged
- [ ] All new forms use react-hook-form + Zod
- [ ] All new list views use `data-table.tsx`
- [ ] All create/edit forms in `Sheet`
- [ ] Zero-data states use `EmptyState`
- [ ] Loading states use `LoadingSkeleton`
- [ ] Commit is scoped to this phase only

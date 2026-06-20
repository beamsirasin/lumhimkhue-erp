# Phase 12 — Design System Reference

> This document is the authoritative V2 design system spec.
> For implementation, all tokens already exist in `app/globals.css`.
> Do not add new CSS files. Extend `globals.css` or use Tailwind classes.

---

## Color Tokens

### Primary

```css
--primary:             oklch(0.30 0.11 248)   /* navy blue — buttons, links, active states */
--primary-foreground:  oklch(0.98 0 0)         /* white text on primary */
```

### Backgrounds & Surfaces

```css
--background:     oklch(0.962 0.005 248)  /* page canvas — cool off-white */
--foreground:     oklch(0.145 0.012 248)  /* primary text */

--surface-0:      oklch(0.960 0.005 248)  /* = background, for semantic clarity */
--surface-1:      oklch(1 0 0)            /* card / panel — pure white lifts off page */
--surface-2:      oklch(0.950 0.006 248)  /* inset well, table header, input background */
--surface-raised: oklch(1 0 0)            /* popover / dialog */

--surface-primary-subtle: oklch(0.95 0.03 248)  /* lightly tinted — active nav, selected row */
--surface-primary-muted:  oklch(0.90 0.06 248)  /* more tinted — highlighted panels */
```

### Semantic Status Tokens

Each status has three variants: background, foreground, border.

| Token prefix | Use |
|---|---|
| `--status-success` | Paid, received, approved, active |
| `--status-danger` | Error, void, cancelled, overdue |
| `--status-warning` | Closing, pending, partial, caution |
| `--status-info` | Informational, active shift, in-progress |
| `--status-neutral` | Draft, inactive, historical |
| `--status-purple` | Loyalty, special category |
| `--status-orange` | Awaiting, warmup, secondary alert |
| `--status-cyan` | Kitchen/KDS station color |

Usage: `bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]`

Or use `StatusBadge` component with `variant` prop.

### Sidebar Tokens (dark ink sidebar)

```css
--sidebar:                  oklch(0.155 0.04 248)  /* sidebar background */
--sidebar-foreground:       oklch(0.75 0.02 248)   /* nav item text */
--sidebar-accent:           oklch(0.22 0.05 248)   /* hover background */
--sidebar-accent-foreground: oklch(0.95 0.005 248) /* hover text */
--sidebar-active:           oklch(0.22 0.06 248)   /* active item background */
--sidebar-active-foreground: oklch(0.98 0 0)       /* active item text */
--sidebar-header:           oklch(0.12 0.05 248)   /* logo strip — darker than sidebar */
--sidebar-border:           oklch(0.24 0.04 248)   /* dividers inside sidebar */
```

### Shadows

```css
--shadow-card:   0 1px 3px oklch(0 0 0 / 8%), 0 1px 2px oklch(0 0 0 / 5%);
--shadow-raised: 0 6px 16px oklch(0 0 0 / 12%), 0 2px 6px oklch(0 0 0 / 7%);
--shadow-dialog: 0 20px 60px oklch(0 0 0 / 18%), 0 8px 20px oklch(0 0 0 / 10%);
```

Usage: `shadow-[var(--shadow-card)]`, `shadow-[var(--shadow-raised)]`

---

## Typography

**Font:** IBM Plex Sans Thai — weight 400 (normal) and 500 (medium) only. No 600, no 700.

### Utility Classes (defined in `app/globals.css`)

| Class | Spec | Use |
|---|---|---|
| `.text-page-title` | 2xl bold tracking-tight | `<h1>` page title in `PageHeader` |
| `.text-section-title` | 13px semibold | Section heading within a card |
| `.text-label` | 10px semibold uppercase tracking-widest muted | Column headers, form field labels |
| `.text-value-2xl` | 28px bold tabular-nums | Large KPI values |
| `.text-value-xl` | 2xl bold tabular-nums | Medium KPI values |
| `.text-value-lg` | xl bold tabular-nums | Small KPI values |
| `.text-hint` | 11px muted-foreground | Helper text, timestamps, secondary info |
| `.text-error` | 11px destructive | Form validation errors |

---

## Spacing & Layout

### Border Radius
```
--radius: 0.5rem  (8px — rounded-lg)

rounded-sm  = calc(radius × 0.6) ≈ 5px
rounded-md  = calc(radius × 0.8) ≈ 6px
rounded-lg  = radius = 8px         ← default for cards, inputs, buttons
rounded-xl  = calc(radius × 1.4) ≈ 11px  ← stat cards, section cards
rounded-2xl = calc(radius × 1.8) ≈ 14px  ← modals, sheets
```

### Page Shell
```css
.page-shell { mx-auto max-w-[1400px] px-6 py-5 space-y-6 }
```
Always wrap admin page content in `<AppShell>` (which applies `.page-shell`).

### Section Cards
```css
.section-card { rounded-xl bg-[var(--surface-1)] border border-border shadow-[var(--shadow-card)] }
```
Use `<SectionCard>` component.

---

## Component Patterns

### Admin Page Skeleton

Every admin list page MUST follow this structure:

```tsx
// page.tsx (server component)
export default async function SomePage() {
  const data = await getSomeData();
  return <SomePageClient initialData={data} />;
}

// SomePageClient.tsx ('use client')
export function SomePageClient({ initialData }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  return (
    <AppShell>
      <PageHeader
        title="ชื่อหน้า"
        subtitle="คำอธิบาย"
        action={<Button onClick={() => setOpen(true)}>+ เพิ่ม</Button>}
      />
      {/* Filter bar */}
      <div className="flex gap-2">
        <Input placeholder="ค้นหา..." />
        <Select>...</Select>
      </div>
      {/* Data */}
      {data.length === 0 ? (
        <EmptyState icon={SomeIcon} title="ไม่มีข้อมูล" message="..." />
      ) : (
        <DataTable columns={columns} data={data} />
      )}
      {/* Sheet for create/edit */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SomeForm item={editing} onSuccess={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
```

### DataTable Column Pattern

```tsx
const columns: ColumnDef<Item>[] = [
  { accessorKey: 'name', header: 'ชื่อ' },
  {
    accessorKey: 'status',
    header: 'สถานะ',
    cell: ({ row }) => <StatusBadge variant={mapStatus(row.original.status)} label={...} />,
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleEdit(row.original)}>แก้ไข</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleDelete(row.original)} className="text-destructive">ลบ</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];
```

### Sheet Form Pattern

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent className="sm:max-w-[480px]">
    <SheetHeader>
      <SheetTitle>{editing ? 'แก้ไข' : 'เพิ่มใหม่'}</SheetTitle>
    </SheetHeader>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
      <FormField ... />
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
        <Button type="submit" disabled={isSubmitting}>บันทึก</Button>
      </div>
    </form>
  </SheetContent>
</Sheet>
```

### StatCard Grid Pattern

```tsx
<StatCardGrid>
  <StatCard
    label="รายได้วันนี้"
    value="฿45,320"
    trend={{ value: 12, direction: 'up' }}
    icon={Banknote}
  />
  <StatCard label="โต๊ะที่เปิด" value="8" icon={Table2} />
  ...
</StatCardGrid>
```

---

## Dark Mode

All CSS tokens have dark mode overrides in `.dark {}`. The UI is fully dark-mode capable. Always use CSS variables — never hardcode a color value.

---

## Icons

Use `lucide-react` exclusively. Optimize imports via Turbopack tree-shaking (already configured in `next.config.ts`).

```tsx
import { Banknote, Table2, Users } from 'lucide-react';
```

---

## Accessibility Rules

- Every icon-only button must have `aria-label`
- All interactive elements must be keyboard-reachable
- Focus ring: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` — already set in globals.css
- WCAG AA minimum contrast on all text
- Use semantic HTML: `<button>` not `<div onClick>`, `<nav>` for navigation, `<main>` for content

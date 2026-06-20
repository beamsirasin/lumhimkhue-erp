# Architecture Audit Report — Shabu Buffet ERP POS/Admin Separation

**Date:** 2026-06-16  
**Auditor:** Claude Sonnet 4.6  
**Scope:** User settings behavior, runtime/layout separation, bundle analysis, permission security, Android POS performance

---

## A. Current Architecture Summary

### How user settings are stored and loaded

Three columns in `users` table (`lib/db/schema.ts:147-149`):

| Column | Type | Purpose |
|---|---|---|
| `uiLayout` | `enum(touchscreen, desktop, tablet)` | Which layout variant renders |
| `allowedModules` | `text[]` | Which nav items are visible to the user |
| `navLayout` | `jsonb { sections: { heading, modules[] }[] }` | Custom ordering/grouping of nav items |

Plus one global override in `storeSettings.menuLabels` (JSONB) — applies to all users at once.

At login, `auth.ts` `authorize()` returns `id, email, name, role, branchId, uiLayout, allowedModules`.
The JWT callback stores all of these plus `navLayout` from the user object. The session callback
re-exposes them to `session.user.*`. All three staff fields are then passed from `(staff)/layout.tsx`
and `(admin)/layout.tsx` into `SidebarLayout`.

> **Bug found — `navLayout` never loads at login.**
> `auth.ts:39-47` does not include `navLayout` in the `authorize()` return. The JWT callback at
> `lib/auth/config.ts:65` reads `user.navLayout ?? null` — but since `user` is the authorize return,
> `navLayout` is always `undefined`, so `token.navLayout` is always `null` after fresh login.
> It can only be hydrated via `unstable_update()`, which is only called for self-updates
> (`lib/actions/staff.ts:115-124`). A cashier whose `navLayout` was configured by an admin never
> sees it take effect.

### How menus are shown/hidden

Two layers:

1. **Role NAV config** (hardcoded in `components/shared/SidebarLayout.tsx:266-338`) — defines the
   universe of modules per role. Cashier only sees `pos, kds, tables, queue, printers`.
2. **`allowedModules` filter** on top — `filterSections()` (`SidebarLayout.tsx:97-113`) removes any
   item whose href is not in the user's `allowedModules`. This is **client-side, visual-only**.

### How UI mode is applied

The main export `SidebarLayout` (`SidebarLayout.tsx:1167-1226`) picks one of two React component
trees based on `uiLayout`:

- `touchscreen` OR (`uiLayout == null` AND role is `cashier`/`kitchen`) → **`CashierLayout`**
  (bottom tab bar, no sidebar, fullscreen button)
- `tablet` → **`StandardSidebarLayout`** with collapsible sidebar (64px ↔ 288px)
- `desktop` OR (`uiLayout == null` AND role is `owner`/`manager`) → **`StandardSidebarLayout`**
  fixed sidebar

UI mode changes the **rendered component tree**, not just CSS. `CashierLayout` has a structurally
different DOM (bottom tabs, no sidebar panel, compact 48px header).

### Which layout is used for cashier/POS users

`(staff)/layout.tsx` and `(admin)/layout.tsx` both import the same `SidebarLayout` component. There
is no separate "POS layout file." The layout chosen (CashierLayout vs StandardSidebar) is determined
at runtime inside `SidebarLayout` based on `uiLayout` and `role`.

- `(admin)/layout.tsx` → owner-only role guard → passes `badgeCounts` (inventory alerts)
- `(staff)/layout.tsx` → auth-only guard → no badge counts

---

## B. Is It Only Hiding Menus, or Truly Lightweight?

**Verdict: PARTIALLY SEPARATED**

### What IS properly separated

- Next.js route groups `(admin)`, `(staff)`, `(customer)` create separate layout trees and allow
  independent bundle chunking per segment.
- `(admin)` pages (recharts/ReportsPage, dashboard widgets, HR, inventory) are **never imported** by
  `(staff)` routes. Confirmed via `grep -r "recharts" components/staff/` → zero results.
- `/pos/page.tsx` imports only: `PosTerminal`, `getPosSessionsForPos`, `auth`. No charts, no data
  tables, no admin components.
- `PosTerminal.tsx` imports: `date-fns/differenceInSeconds`, `@tanstack/react-query`, `sonner/toast`,
  8 lucide-react icons, `PricingTile`, `lib/printer/service`. **Zero admin libraries.**
- `CashierLayout` (bottom-tab layout) is a ~200-line component with no sidebar state or admin NAV
  data.

### What is NOT properly separated

- `SidebarLayout.tsx` is a single **1,226-line `'use client'` component** downloaded and parsed for
  every page load by every user — cashier, kitchen, and owner alike.
- This single file contains NAV definitions for all four roles: owner (HR group, inventory group,
  dashboard, recipes), manager, cashier, kitchen. A cashier device evaluates the `hrGroup`,
  `inventoryGroup`, `posGroup` object literals.
- The lucide-react import block (`SidebarLayout.tsx:8-40`) brings in 30 icon names. Tree-shaking
  should eliminate icons not reached at runtime, but the entire module initialisation runs.
- Even when `CashierLayout` is used, the `SidebarLayout` export function still runs
  `buildModuleItemMap(role)`, `filterSections()`, and `reorderSections()` before branching to
  `CashierLayout`. These are fast but unnecessary for touchscreen mode.
- `Sheet` and `Collapsible` from shadcn/ui (radix-ui) are imported at the top of `SidebarLayout.tsx`.
  For cashier/touchscreen users, `Sheet` is only used in `StandardSidebarLayout`. These components
  are evaluated even for touchscreen sessions.

### Evidence table

| Check | Result | Evidence |
|---|---|---|
| recharts in POS imports | Not present | grep confirmed |
| recharts in `components/staff/` | Not present | grep confirmed |
| recharts in `components/admin/` | `ReportsPage.tsx` only | isolated to admin route |
| Admin layout imports in staff layout | None | `(staff)/layout.tsx:3-4` |
| `SidebarLayout` shared between admin+staff | Yes, same file | both layouts import it |
| `CashierLayout` renders sidebar markup | No — bottom tabs only | `SidebarLayout.tsx:985-1151` |
| `allowedModules` enforced by middleware | No — role only | `lib/auth/config.ts:3-53` |
| `allowedModules` enforced by server actions | Yes | `lib/actions/staff.ts:17-21` |

---

## C. Risk List

### Performance risks

1. **`SidebarLayout.tsx` is a 1,226-line monolithic client bundle** shipped to every device, including
   Android POS terminals on `touchscreen` mode that only ever use `CashierLayout`. The NAV config
   objects for admin (HR, inventory, recipes) are parsed and allocated on every cashier page load.

2. **No dynamic import split between `CashierLayout` and `StandardSidebarLayout`.** A `next/dynamic`
   split would mean cashier devices never download sidebar/collapsible code; admin devices never
   download the touchscreen bottom-tab code.

3. **POS polling at 5s** uses `useQuery` with `refetchInterval: 5000`. Acceptable in general, but on
   slow 3G (common in Thai restaurant environments) this can back-pressure if previous requests
   haven't resolved.

4. **`formatElapsed` is called inline** inside a mapped list in `PosTerminal.tsx`. If `useQuery`
   refetches and re-renders with 10+ sessions open, all elapsed time strings are recomputed
   synchronously on every render.

5. **`getMenuLabels()`** is awaited in both `(admin)/layout.tsx` and `(staff)/layout.tsx` on every
   navigation. Without caching this hits the DB on every cold layout render.

### Security risks

1. **`allowedModules` is not enforced by middleware.** The middleware checks roles for admin paths
   (`/dashboard`, `/menu`, etc.) and for `/pos` and `/kds`. But `/queue` and `/tables` have no role
   restriction in middleware (`lib/auth/config.ts:46` — comment says "accessible to all authenticated
   roles"). If an admin sets `allowedModules=["pos"]` for a cashier, that cashier can still navigate
   directly to `/queue` or `/tables`. The sidebar won't show those links, but the URL is open.

2. **`navLayout` never loads from the database at fresh login.** (`auth.ts:39-47`) Any `navLayout`
   configured for a user through `/users` is silently ignored after login. The `/users` nav layout
   editor is effectively broken for newly logged-in users.

3. **Deactivated users stay logged in.** `isActive` is checked at login (`auth.ts:34`), but the
   middleware `authorized` callback (`lib/auth/config.ts:11-55`) does not re-check `isActive` in the
   JWT. A deactivated user keeps their JWT session valid until it expires naturally.

4. **Server actions are properly guarded** — `requireManageUsers()` (`lib/actions/staff.ts:17-21`)
   is a solid pattern. Even if a cashier navigates to `/users`, `getStaffList()` returns 403. This
   is the most important boundary and it holds.

### Maintainability risks

1. Adding a new module requires edits to: `schema.ts` (enum + column), `lib/auth/config.ts`
   (adminPrefixes), `SidebarLayout.tsx` (MODULE_HREFS + NAV config + PAGE_TITLES + touchscreen tabs),
   `permissions.ts` (new Action), and all relevant server actions. No single source of truth.

2. `SidebarLayout.tsx` at 1,226 lines mixes: navigation data config, 3 layout variants, module
   filtering logic, label override logic, reorder logic, tooltip logic, flyout logic, badge counting.

### Android POS-specific risks

1. The full `SidebarLayout.tsx` module (1,226 lines + 30 lucide icon imports + radix-ui
   Sheet/Collapsible) is parsed on every page transition on a low-end Android device. Next.js only
   parses it once per session (module cache), but initial load is felt.

2. `Sheet` (radix portal) is included in the bundle even for touchscreen users who never see it. On
   Android Chrome, portal rendering has historically caused layout shift.

3. KDS polling at 3s will cause continuous network requests. Fine if always connected — worth
   monitoring on spotty restaurant WiFi.

---

## D. What Should Stay

These parts of the current system are well-designed and should be preserved:

1. **Three-layer permission model**: middleware (role guard) → layout (role double-check) → server
   action (`can()` check). Defense in depth, correct.
2. **`allowedModules` per-user fine-grained visibility** stored in the DB — the concept is sound;
   only the enforcement gap at middleware level needs a decision.
3. **`navLayout` JSONB** for custom nav ordering — good data model; only the load-at-login bug needs
   fixing.
4. **`uiLayout` enum** driving genuinely different component trees — a real separation, not CSS-only.
5. **`menuLabels` global overrides** via storeSettings — clean single source.
6. **`unstable_update()` session refresh** when admin updates a user — keeps session in sync without
   re-login.
7. **`isActive` check at login** and rate limiting.
8. **Route group structure** `(admin)/(staff)/(customer)` — prevents cross-group layout leakage.
9. **`CashierLayout`** bottom-tab design — already lightweight and touch-optimised.
10. **Server action pattern** (`auth() → can() → Zod → db → return { ok }`) — consistent and correct.
11. **`prefetch={false}` on tab links** in `CashierLayout` — prevents prefetching admin chunks.

---

## E. What Should Change

### E1. Fix the `navLayout` login bug (1 line)

**File:** `auth.ts:39-47`

Add `navLayout: user.navLayout ?? null` to the `authorize()` return value. Without this, the
entire nav layout editor in `/users` is a no-op after fresh login.

```ts
// auth.ts — authorize() return
return {
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  branchId: user.branchId ?? null,
  uiLayout: user.uiLayout ?? null,
  allowedModules: user.allowedModules ?? [],
  navLayout: user.navLayout ?? null,   // ← add this line
};
```

### E2. Add `isActive` to JWT + middleware re-check

**Files:** `auth.ts`, `lib/auth/config.ts`

```ts
// auth.ts — authorize() return
return {
  ...
  isActive: user.isActive,   // ← add
};

// lib/auth/config.ts — jwt callback
if (user) {
  token.isActive = (user as { isActive?: boolean }).isActive ?? true;
}

// lib/auth/config.ts — authorized callback (early in the function)
if (isLoggedIn && session!.user.isActive === false) {
  return Response.redirect(new URL('/login', nextUrl.origin));
}
```

### E3. Split `SidebarLayout.tsx` into dynamic chunks

**Current:** One 1,226-line file shared by all roles.

**Recommended structure:**

```
components/shared/
  nav-config.ts                ← NAV[], MODULE_HREFS, PAGE_TITLES, filter/reorder/label functions (no JSX)
  CashierLayout.tsx            ← bottom-tab layout (~200 lines), touchscreen only
  StandardSidebarLayout.tsx    ← sidebar layout for tablet/desktop (~350 lines)
  SidebarLayout.tsx            ← thin orchestrator: reads uiLayout, picks layout via next/dynamic (~60 lines)
```

```ts
// SidebarLayout.tsx (after split)
const CashierLayout = dynamic(() => import('./CashierLayout'), { ssr: false });
const StandardSidebarLayout = dynamic(() => import('./StandardSidebarLayout'));
```

**Result:** Cashier devices download `CashierLayout` chunk only (~10 KB) — no radix Sheet/Collapsible,
no admin NAV config objects.

### E4. Cache `getMenuLabels()` with `unstable_cache`

**Files:** `lib/actions/store.ts`, `(admin)/layout.tsx`, `(staff)/layout.tsx`

```ts
// lib/actions/store.ts
import { unstable_cache } from 'next/cache';

export const getMenuLabels = unstable_cache(
  async () => { /* existing query */ },
  ['menu-labels'],
  { tags: ['menuLabels'] }
);

// When labels are updated in the settings action:
revalidateTag('menuLabels');
```

### E5. Memoize `formatElapsed` in PosTerminal

**File:** `components/staff/PosTerminal.tsx:35-39`

Move elapsed time calculation into a `useMemo` keyed on `startedAt`, or extract to a separate
`useElapsedTime` hook with its own `useInterval`, so it updates independently of `useQuery` refetches.

### E6. Decide on `allowedModules` security intent

Two options — pick one and document it:

**Option A — UI customization only (current behaviour, acceptable):**
Add a comment in `lib/auth/config.ts` clarifying that `allowedModules` is a UX feature; the real
security boundary is role-based middleware + server action `can()` checks.

**Option B — Enforce `allowedModules` at middleware level:**
Store `allowedModules` in the JWT (already done). In the `authorized` callback, after role checks,
add:

```ts
const allowed = session.user.allowedModules ?? [];
if (allowed.length > 0) {
  const module = resolveModuleFromPathname(pathname); // map /queue → 'queue'
  if (module && !allowed.includes(module)) {
    return Response.redirect(new URL('/', nextUrl.origin));
  }
}
```

Option B is more secure but adds complexity to the middleware. Only needed if `allowedModules`
is intended as a hard access control boundary rather than a UI customization.

---

## F. Safe Implementation Plan

### Step 1 — Measure current state (no code changes)

- Run `next build` and note `.next/analyze` chunk sizes for `SidebarLayout`, each `(staff)` page
- Open `/pos` as a cashier in Chrome DevTools → Network → JS filter → record all chunk names and
  sizes loaded
- Record baseline: total JS downloaded, Time to Interactive on `/pos`

### Step 2 — Fix `navLayout` login bug

- **File:** `auth.ts:39-47`
- Add `navLayout: user.navLayout ?? null` to the `authorize()` return
- **Impact:** Zero performance change; fixes a broken feature
- **Verify:** Log in as a user with a configured `navLayout`; sidebar reflects it immediately

### Step 3 — Add `isActive` to JWT + middleware

- **Files:** `auth.ts`, `lib/auth/config.ts`
- Add `isActive` to authorize return, JWT callback, and authorized callback check
- **Verify:** Deactivate a user → their next navigation redirects to `/login`

### Step 4 — Split `SidebarLayout.tsx` into dynamic chunks

- Extract `CashierLayout` → `components/shared/CashierLayout.tsx`
- Extract `StandardSidebarLayout` → `components/shared/StandardSidebarLayout.tsx`
- Extract `nav-config.ts` (no JSX, no radix imports)
- Make `SidebarLayout.tsx` a thin orchestrator with `next/dynamic`
- **Verify:** Network tab for `/pos` (cashier/touchscreen) shows no `StandardSidebarLayout` chunk

### Step 5 — Cache `getMenuLabels` + memoize `formatElapsed`

- Wrap `getMenuLabels` with `unstable_cache` tagged `menuLabels`
- Call `revalidateTag('menuLabels')` in the settings update action
- Memoize `formatElapsed` computation in `PosTerminal.tsx`

### Step 6 — Decide and document `allowedModules` intent

- Choose Option A or Option B from Section E6
- Add a comment block in `lib/auth/config.ts` explaining the decision

### Step 7 — Verify user settings still work end-to-end

See Section G checklist.

---

## G. Verification Checklist

### Prove POS mode is lightweight

- [ ] Open `/pos` as cashier (touchscreen uiLayout). DevTools → Network → JS: confirm no chunk named
      `ReportsPage`, `dashboard`, `recharts`, `StandardSidebarLayout` is loaded
- [ ] After Step 4 split: `CashierLayout` chunk ≤ 15 KB gzipped; no radix `Sheet` or `Collapsible`
      module in the POS network waterfall

### Prove admin modules are not loaded on POS

- [ ] `grep -r "recharts" components/staff/` → zero results (currently confirmed clean)
- [ ] `grep -r "recharts" app/\(staff\)/` → zero results (currently confirmed clean)
- [ ] After Step 4: `SidebarLayout` chunk does not include `StandardSidebarLayout` code when
      loading `/pos`

### Prove cashier cannot access admin routes/APIs

- [ ] Log in as `cashier@shabu.local`. Navigate to `/dashboard` → redirects to `/`
- [ ] Navigate to `/menu` → redirects to `/`
- [ ] Navigate to `/reports` → redirects to `/`
- [ ] Call `getStaffList()` as cashier → returns `{ ok: false, error: 'ไม่มีสิทธิ์ดำเนินการ' }`
- [ ] After Step 3: deactivate cashier user → next navigation redirects to `/login`

### Prove `allowedModules` restriction shows in UI

- [ ] Set `allowedModules = ["pos"]` for cashier via `/users`
- [ ] Log back in → bottom tabs show only POS tab
- [ ] Navigate to `/kds` directly → page loads (middleware allows cashier role; this is the gap
      addressed by Section E6 decision)

### Prove `navLayout` works after Step 2 fix

- [ ] Configure a custom `navLayout` for a cashier via `/users`
- [ ] Log out and log back in as that cashier
- [ ] Sidebar/tabs reflect the custom ordering immediately (currently broken — this is the bug)

### Prove `menuLabels` still work

- [ ] Change a label in `/settings` → `revalidateTag('menuLabels')` fires
- [ ] Navigate to any staff page → sidebar label reflects the custom name

### Prove `uiLayout` switch works

- [ ] Set cashier to `uiLayout = desktop` → sidebar appears instead of bottom tabs
- [ ] Set to `touchscreen` → bottom tabs, fullscreen button, no sidebar
- [ ] Set to `tablet` → collapsible sidebar (64px ↔ 288px)

---

## Quick-Reference Priority Matrix

| Priority | Issue | Risk Type | Effort |
|---|---|---|---|
| **P0 — Fix now** | `navLayout` never loads at login | Feature broken | 1 line |
| **P0 — Fix now** | Deactivated users stay logged in | Security | 3 lines |
| **P1 — Next sprint** | Split `SidebarLayout.tsx` (dynamic import) | Android performance | Medium |
| **P1 — Next sprint** | Cache `getMenuLabels` | DB query per navigation | Low |
| **P2 — Decide intent** | `allowedModules` middleware enforcement | Security/UX clarity | Medium |
| **P3 — Nice to have** | Memoize `formatElapsed` in PosTerminal | Minor render perf | Low |

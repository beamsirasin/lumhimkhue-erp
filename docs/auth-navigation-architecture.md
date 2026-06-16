# Auth, Navigation, and Module Access Architecture

This document describes how route protection, navigation rendering, and per-user module access work together in this Next.js 16 App Router application. Read it before touching `proxy.ts`, any `layout.tsx` / `template.tsx`, or `lib/auth/`.

---

## Layer overview

```
Browser request / client-side RSC fetch
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  proxy.ts  (Edge middleware)                            │
│  · Login check, isActive check                         │
│  · Role-based route blocking (admin = owner only,      │
│    /kds + /pos = allowed roles only)                   │
│  · Sets x-current-path request header                  │
│  · Does NOT check allowedModules (JWT would be stale)  │
└─────────────────────────┬───────────────────────────────┘
                          │ passes
                          ▼
┌─────────────────────────────────────────────────────────┐
│  app/(staff)/layout.tsx  (Server Component)             │
│  · Persistent — re-renders on full page load only       │
│  · Calls requireActiveSessionUser() → fresh DB          │
│  · Renders SidebarLayout with fresh nav settings        │
│  · Does NOT check allowedModules here (would be stale   │
│    on client-side navigation since layout persists)     │
└─────────────────────────┬───────────────────────────────┘
                          │ wraps
                          ▼
┌─────────────────────────────────────────────────────────┐
│  app/(staff)/template.tsx  (Server Component)           │
│  · Re-runs on EVERY navigation (layout persists,        │
│    template does not)                                   │
│  · Reads allowedModules fresh from DB on every nav      │
│  · Reads x-current-path from request headers            │
│  · Enforces allowedModules for cashier/kitchen/manager  │
│  · Owner: skips module DB query (isActive still         │
│    checked by middleware + layout on full load)         │
└─────────────────────────┬───────────────────────────────┘
                          │ wraps
                          ▼
┌─────────────────────────────────────────────────────────┐
│  page.tsx (Server or Client Component)                  │
│  · Renders page content                                 │
│  · Calls server actions for data                        │
└─────────────────────────┬───────────────────────────────┘
                          │ calls
                          ▼
┌─────────────────────────────────────────────────────────┐
│  lib/actions/*.ts  (Server Actions)                     │
│  · Always enforce can(role, action) — role-based only   │
│  · This is the final, unconditional security boundary   │
│  · allowedModules is never checked here                 │
└─────────────────────────────────────────────────────────┘
```

---

## 1. `proxy.ts` — Edge middleware

**File:** `proxy.ts` (re-exports `lib/auth/config.ts` `authorized()` callback)

**Runs:** On every matched HTTP request and every RSC fetch for client-side navigation, in the Edge runtime before any server component renders.

**Responsibilities:**

- Redirects unauthenticated users to `/login`
- Blocks deactivated users (`isActive === false`) on every protected route
- Enforces role-based route groups:
  - `adminPrefixes` (`/dashboard`, `/menu`, `/inventory`, etc.) → owner only
  - `/kds` → kitchen, owner, cashier, manager only
  - `/pos` → cashier, owner, manager only
  - `/queue`, `/tables`, `/printers` → any authenticated role
- Exempts public routes (`/t/*`, `/q/*`) and the `/unauthorized` page
- Sets the `x-current-path` request header so downstream server components can read the current pathname (Next.js server layouts/templates do not receive the pathname directly)

**Does NOT do:** allowedModules enforcement. The middleware reads from the JWT, which is only refreshed on login or when a user edits their own profile. An admin changing another user's `allowedModules` does not refresh that user's JWT. Enforcing modules in the middleware would cause false-denies (module added, user blocked until next login) and false-allows (module removed, user still passes until next login).

---

## 2. `app/(staff)/layout.tsx` — Navigation shell

**File:** `app/(staff)/layout.tsx`

**Runs:** On full page loads only. In Next.js App Router, layouts are persistent across client-side navigations within the same route segment group. Navigating from `/pos` to `/kds` does NOT re-run this layout.

**Responsibilities:**

- Calls `requireActiveSessionUser()` to get fresh user settings from the DB
- Renders `SidebarLayout` with fresh `navLayout`, `allowedModules`, `uiLayout`, `menuLabels` — these control which nav items are visible
- Redirects deactivated users to `/login` (belt-and-suspenders, middleware already handles this)

**Does NOT do:** allowedModules route enforcement. Because the layout only runs on full page load, any module check placed here is bypassed by client-side navigation. Module enforcement lives in `template.tsx`.

---

## 3. `app/(staff)/template.tsx` — Module enforcement

**File:** `app/(staff)/template.tsx`

**Runs:** On every navigation — full page loads AND client-side navigations. Unlike layouts, templates are re-instantiated on each navigation. This is their purpose in the App Router.

**Responsibilities:**

- Reads the current pathname from the `x-current-path` header (set by middleware)
- Queries the DB for the current user's `allowedModules` and `isActive` (minimal select)
- Enforces allowedModules for cashier, kitchen, and manager roles
- Redirects to the first allowed module's primary href, or to `/unauthorized` if no valid module is configured
- For owner: returns `{children}` immediately without a module DB query. `isActive` for owner is still checked by the middleware (JWT-based, every request) and by the layout's `requireActiveSessionUser()` call (DB-based, full page loads)

**Why template and not layout:** The layout persists; navigating from `/pos` to `/kds` does not re-run it. The template does re-run on every navigation, making it the correct location for a guard that must execute on every route change.

**Why a fresh DB query here and not the JWT:** See section 4.

---

## 4. Why allowedModules enforcement must use fresh DB data

When an owner changes another user's `allowedModules` in `/users`, the change is written to the database immediately. However, it is **not** written back to that user's JWT session token.

The `unstable_update()` call in `lib/actions/staff.ts` is only invoked when `selfUpdated === true` — i.e., when a user edits their own profile. Admin edits to another user produce no JWT refresh for the target user.

Consequence: `session.user.allowedModules` in the middleware and in any `auth()` call is stale until the affected user logs out and back in. Using it for enforcement produces:

- **False allow** — admin removes a module, JWT still has it, user can still navigate to the route by URL
- **False deny** — admin adds a module, JWT doesn't have it yet, user sees the nav link (layout reads DB) but every click is blocked by the stale middleware check

The template avoids both problems by reading `allowedModules` directly from the DB on every navigation.

---

## 5. Why owner bypasses module enforcement

"Bypasses" here means **module checks only** — not active-user validation. The middleware still blocks a deactivated owner (via JWT `isActive`), and the layout's `requireActiveSessionUser()` still checks the DB on full page loads. What the template skips for owner is the per-navigation DB query for `allowedModules`.

The reason: the owner role configures `allowedModules` for other users through `/users`. If module enforcement applied to owners, a misconfiguration in `/users` could lock an owner out of the routes they need to fix that misconfiguration. Owner bypasses module checks by design.

Additionally, all admin routes (`/dashboard`, `/menu`, `/inventory`, etc.) are already owner-only by role in the middleware. There are no staff routes an owner should be blocked from. Enforcing modules on owner would add per-navigation DB overhead with no security benefit.

---

## 6. What empty `allowedModules` means

An empty array (`[]`) or `null` in `allowedModules` means **no module restriction** — the user gets full access to all routes their role permits.

This is intentional for two reasons:

1. **Backward compatibility**: Users created before the module system was introduced have no module list. Treating empty as "block everything" would lock them out unexpectedly.
2. **Full-access grant**: An owner can explicitly grant a staff member unrestricted access by leaving `allowedModules` empty.

This behavior is enforced consistently in three places:
- `template.tsx`: `if (modules.length > 0)` guard before checking the path
- `lib/auth/module-routes.ts` `isPathAllowedByModules()`: returns `true` immediately for empty arrays
- `app/page.tsx` root redirect: only uses `firstModuleHref` when modules is non-empty

---

## 7. How to add a new staff module safely

A "staff module" is a route section accessible to non-owner roles that can be shown or hidden per user via `allowedModules`.

**Step 1 — Add the route prefix to `STAFF_MODULE_PREFIXES`**

File: `lib/auth/module-routes.ts`

```ts
export const STAFF_MODULE_PREFIXES: Record<string, string[]> = {
  pos:          ['/pos'],
  kds:          ['/kds'],
  queue:        ['/queue'],
  tables:       ['/tables'],
  printers:     ['/printers'],
  your_module:  ['/your-route'],   // ← add here
};
```

The key becomes the string stored in `users.allowedModules`. Use the same key as `MODULE_HREFS` in `components/shared/nav-config.ts`.

**Step 2 — Add the route to `MODULE_HREFS` in nav-config**

File: `components/shared/nav-config.ts`

```ts
export const MODULE_HREFS: Record<string, string[]> = {
  // ...existing entries...
  your_module: ['/your-route', '/your-route/history'],
};
```

This controls nav link visibility. Both files must use the same key.

**Step 3 — Add a role check in the middleware if needed**

File: `lib/auth/config.ts` `authorized()` callback

If the new route should be restricted by role (not just by module), add a check alongside the `/kds` and `/pos` checks. If any authenticated staff role can access it (like `/tables` and `/queue`), no middleware role check is needed.

**Step 4 — Call `requireActiveSessionUser()` in the page only if it needs user data**

The template already enforces module access and redirects unauthenticated users, so a page does not need to duplicate that check just for route protection. Only call `requireActiveSessionUser()` in a page when it genuinely needs the fresh user record for its own rendering — for example, to display the user's name, to branch on their role, or to pass user data as a prop.

```ts
// app/(staff)/your-route/page.tsx — only if the page uses freshUser directly
import { requireActiveSessionUser } from '@/lib/auth/require-active';

export default async function YourPage() {
  const { freshUser } = await requireActiveSessionUser();
  return <YourComponent userName={freshUser.name} />;
}
```

If the page delegates all data fetching to server actions (which enforce `can(role, action)` themselves), no additional session call is needed in the page.

**Step 5 — Verify `TOUCHSCREEN_TAB_MODULE` if the route needs a bottom tab on touchscreen**

File: `components/shared/nav-config.ts`

```ts
export const TOUCHSCREEN_TAB_MODULE: Record<string, string> = {
  // ...
  your_module: '/your-route',
};
```

---

## 8. Verification checklist for future changes

Run after any change to `proxy.ts`, `lib/auth/config.ts`, `lib/auth/module-routes.ts`, either staff layout or template, or `app/page.tsx`.

### Build gates

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — zero new errors
- [ ] `npm run build` — all routes compile, all staff routes remain `ƒ` (dynamic)

### Access control scenarios

**Direct URL access (full page load):**
- [ ] Cashier with `['pos']` → `/kds` by URL → redirected to `/pos`
- [ ] Cashier with `['pos']` → `/queue` by URL → redirected to `/pos`
- [ ] Cashier with `['kds']` → `/pos` by URL → blocked by role (cashier IS allowed `/pos` by role; module check sends to `/kds`)
- [ ] Owner → any staff route → always allowed

**Client-side navigation:**
- [ ] Cashier with `['pos']` on `/pos` → clicks link to `/kds` → template fires → redirected to `/pos`
- [ ] Cashier with `['pos','kds']` on `/pos` → clicks `/kds` → allowed
- [ ] Admin changes cashier's modules from `['pos','kds']` to `['pos']` mid-session → cashier navigates to `/kds` → blocked (template reads fresh DB)
- [ ] Admin adds `kds` to cashier's modules mid-session → cashier navigates to `/kds` → allowed immediately (template reads fresh DB, no re-login required)

**Edge cases:**
- [ ] Empty `allowedModules` → no enforcement → full role-based access
- [ ] `allowedModules = ['nonexistent']` → `firstModuleHref` returns null → redirect to `/unauthorized`
- [ ] User at `/unauthorized` → page renders (middleware exempts it), "กลับหน้าหลัก" link goes to `/` → root page redirects to `firstModuleHref` or role home
- [ ] Owner with any `allowedModules` value → template returns `{children}` immediately, no DB query

**Root redirect:**
- [ ] Cashier with `['kds','queue']` hits `/` → redirected to `/kds` (not `/pos`)
- [ ] Manager (empty modules) hits `/` → redirected to `/pos` (role default, not `/dashboard`)
- [ ] Owner hits `/` → redirected to `/dashboard`

**Server action integrity:**
- [ ] Cashier with `allowedModules = ['tables']` calls `processPayment()` server action → `can('cashier', 'process_payment')` → allowed (role, not module, governs mutations)
- [ ] Kitchen calls any POS server action → `can('kitchen', 'process_payment')` → rejected (role check, unaffected by modules)

---

## Key files reference

| File | Purpose |
|---|---|
| `proxy.ts` | Edge middleware — auth + role routing |
| `lib/auth/config.ts` | Auth.js config — `authorized()` callback, JWT/session callbacks |
| `lib/auth/module-routes.ts` | `STAFF_MODULE_PREFIXES`, `isPathAllowedByModules()`, `firstModuleHref()` |
| `lib/auth/require-active.ts` | `requireActiveSessionUser()` — fresh DB user fetch for layouts/pages |
| `lib/auth/permissions.ts` | `can(role, action)` — role-based permission matrix |
| `app/(staff)/layout.tsx` | Nav shell — persistent, renders once per full load |
| `app/(staff)/template.tsx` | Module enforcement — re-runs on every navigation |
| `app/page.tsx` | Root redirect — uses fresh DB + `firstModuleHref` to avoid sending enforced users to a blocked route |
| `components/shared/nav-config.ts` | `MODULE_HREFS`, `TOUCHSCREEN_TAB_MODULE` — nav link visibility |
| `lib/actions/staff.ts` | `updateStaff()` — only calls `unstable_update()` for self-edits |

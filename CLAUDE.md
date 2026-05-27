# Shabu Buffet ERP — CLAUDE.md

This is a Next.js 15 ERP SaaS for shabu buffet restaurants. Read this file at the start of every session.

## Tech Stack
- **Framework**: Next.js 16 App Router, TypeScript strict
- **Styling**: Tailwind CSS 4, shadcn/ui (slate base), lucide-react
- **Database**: Neon Postgres + Drizzle ORM (`@neondatabase/serverless`)
- **Auth**: Auth.js v5 (next-auth beta) + Credentials provider, JWT strategy
- **State**: Zustand (cart only), TanStack Query v5 (polling)
- **Forms**: react-hook-form + @hookform/resolvers + Zod
- **Other**: date-fns + date-fns-tz (Asia/Bangkok), sonner toasts, recharts, bcryptjs, nanoid

## Folder Structure
```
app/(customer)/t/[tableToken]/   → Customer ordering (QR menu)
app/(customer)/q/[queueToken]/   → Customer queue check
app/(staff)/pos/                 → POS / cashier
app/(staff)/kds/                 → Kitchen Display System
app/(staff)/queue/               → Queue management (host)
app/(staff)/tables/              → Table management
app/(admin)/dashboard/           → Owner dashboard
app/(admin)/menu/                → Menu CRUD
app/(admin)/packages/            → Package CRUD
app/(admin)/users/               → Staff CRUD
app/(admin)/reports/             → Reports + CSV export
app/(admin)/settings/            → Store settings
lib/db/schema.ts                 → All Drizzle schema + inferred types
lib/db/index.ts                  → db client
lib/db/seed.ts                   → Seed script (guarded, won't run twice)
lib/auth/config.ts               → Auth.js config
lib/auth/permissions.ts          → can(role, action) helper
lib/actions/*.ts                 → All server actions
lib/validations/*.ts             → Zod schemas
proxy.ts                         → Auth + role guard (Next.js 16 rename from middleware.ts)
```

## UI Language
- UI text: Thai
- Code identifiers + comments: English
- Currency: THB

## Design Direction
- Font: IBM Plex Sans Thai (weight 400, 500 only)
- Theme: slate base color, primary = navy blue or deep red (pick one, stay consistent)
- No gradients, no heavy shadows — flat clean design
- border-radius: rounded-lg (8px) default
- Customer pages: mobile-first 375px
- Staff/admin pages: tablet/desktop 768px+

## Server Actions Pattern
```ts
'use server';
// 1. auth() session check
// 2. permission check
// 3. Zod validate input
// 4. db.transaction() for multi-step
// 5. revalidatePath / revalidateTag
// 6. return { ok: true, data } | { ok: false, error: string }
```
Never throw in server actions. Never use `any`.

## Polling Intervals (TanStack Query)
| Page | Interval |
|---|---|
| KDS | 3s |
| Queue (customer) | 10s |
| Queue (host) | 5s |
| Tables grid | 5s |
| POS notifications | 5s |
| Customer "my orders" | 10s |
| Dashboard | 60s |

## Phase Progress
- [x] Phase 1 — Foundation (scaffold, schema, seed)
- [x] Phase 2 — Auth
- [x] Phase 3 — Table Management
- [x] Phase 4 — Customer Ordering
- [x] Phase 5 — Kitchen Display
- [x] Phase 6 — Queue System
- [x] Phase 7 — POS
- [x] Phase 8 — Owner Dashboard
- [x] Phase 9 — Polish + Deploy

## Seed Credentials
- owner@shabu.local / password123
- cashier@shabu.local / password123
- kitchen@shabu.local / password123
- host@shabu.local / password123

## DB Scripts
```bash
npm run db:push    # push schema to Neon
npm run db:seed    # seed initial data (guarded, won't run twice)
npm run db:studio  # open Drizzle Studio
```

## Important Constraints
- No Prisma — Drizzle only
- No Pusher/WebSocket — polling only
- No external payment gateway — record payment method only
- No Redis — Vercel + Neon only
- WCAG AA color contrast
- All icon-only buttons must have aria-label

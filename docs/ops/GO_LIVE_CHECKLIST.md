# Go-Live Checklist — Phase 16 Hardening Deploy

> Work through the gates **in order**. Every box must be checked before moving to the next
> gate. Companion docs: `docs/architecture/MIGRATIONS.md`, `docs/uat/UAT_SCRIPTS.md`,
> `docs/ops/INCIDENT_PLAYBOOK.md`.

---

## Gate 1 — Pre-push (local)

- [ ] `git status` — working tree clean, no stray files
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors (baseline warnings acceptable)
- [ ] `npm run test:money` — 70/70 pass
- [ ] `npm run reconcile:payments` — 0 critical / 0 high (known R7a WARN acceptable)
- [ ] `npm run db:check-migrations` — exit 0; read every warning
- [ ] **Vercel `DATABASE_URL` confirmed**: the host in Vercel project settings matches the
      host printed by the two commands above (`ep-noisy-sun-…` today). If it differs, STOP
      → run both check commands with the production URL first (read-only) and apply
      `db:migrate-phase16b` there if missing (Gate 2).
- [ ] **Neon snapshot / branch created** and its name recorded here: ______________
- [ ] **Phase 16C manual UAT passed** — `docs/uat/UAT_SCRIPTS.md` blocks A–D signed off
- [ ] **Penalty enum decision made** (pick one):
  - [ ] migration applied (`ALTER TYPE tile_category ADD VALUE IF NOT EXISTS 'penalty';`
        per MIGRATIONS.md §4.1) and `db:check-migrations` shows 12/12, **or**
  - [ ] penalty tiles will not be created until it is applied (staff informed; the ค่าปรับ
        tab stays empty — creating a tile there will error)

## Gate 2 — Migrations (production database)

- [ ] `payments.idempotency_key` + `payments_idempotency_key_uq` exist on the **production**
      database **before** deploying any commit ≥ `1827806` (16B). Verify:
      `npm run db:check-migrations` against the production URL. If missing:
      snapshot → `npm run db:migrate-phase16b` → re-check.
- [ ] Penalty enum per Gate 1 decision. Exact SQL (standalone statement, snapshot-only
      rollback): `ALTER TYPE tile_category ADD VALUE IF NOT EXISTS 'penalty';`
- [ ] **No `db:push` against production. Ever.** (MIGRATIONS.md §2)
- [ ] Run record appended to MIGRATIONS.md §5 for anything executed

## Gate 3 — Deploy

- [ ] Push `main` → origin (this triggers the Vercel build)
- [ ] Vercel deployment green (build + no runtime errors on first load)
- [ ] `npm run reconcile:payments` against the production URL — unchanged vs baseline
- [ ] **One controlled test payment** on a test table (small cash amount, real flow:
      open → save bill → pay → receipt)
- [ ] Receipt printed correctly on the real printer (and via Android bridge if used)
- [ ] Delete the test payment via the delete flow (owner, with reason), reconcile again
- [ ] Watch the first real service hour; run reconcile at end of day 1

## Rollback

| Failure | Action |
|---|---|
| Bad deploy (app broken, payments failing) | **Vercel → Deployments → Promote previous deployment** (instant). Code ≥ 16B tolerates the DB having `idempotency_key` even when rolled back to pre-16B code (extra column is ignored by old code) |
| Data damage suspected | STOP all mutations → `npm run reconcile:payments` to scope it → restore/branch from the **Neon snapshot** taken in Gate 1. Restoring loses payments made after the snapshot — count them first (payments where `paid_at` > snapshot time) |
| Migration failed midway | All our scripts are idempotent — re-run once. If still failing: snapshot restore, then INCIDENT_PLAYBOOK.md §"database migration failed" |
| Anything involving payment rows | **Do NOT hand-edit payment rows.** No emergency manual-edit procedure exists yet; if one is ever needed it must be written, approved, and snapshot-guarded first |

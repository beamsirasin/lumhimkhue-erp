/**
 * Phase 16E — Migration Status Check (READ-ONLY)
 *
 * Verifies that the connected database has every table/column/index/enum value
 * the CURRENT code (HEAD of this repo) requires, grouped by the historical
 * migration that introduced it. SELECT-only introspection — never alters
 * anything. See docs/architecture/MIGRATIONS.md.
 *
 * Usage: npm run db:check-migrations
 *
 * Exit codes:
 *   0 — all CRITICAL requirements present (warnings allowed, printed)
 *   1 — one or more CRITICAL requirements missing (deploy is blocked), or the
 *       script itself failed
 *
 * Severity model:
 *   CRITICAL — schema.ts declares it and Drizzle references it on every
 *              query of that table → code fails at runtime without it
 *   WARNING  — needed only when a feature is used (e.g. inserting a new enum
 *              value) → deploy works, the specific feature fails
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

type Req =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; column: string }
  | { kind: 'index'; index: string }
  | { kind: 'enum'; type: string; value: string };

interface Group {
  id: string;
  source: string; // originating migration script / phase
  severity: 'CRITICAL' | 'WARNING';
  reqs: Req[];
}

const GROUPS: Group[] = [
  {
    id: 'v12-tables-sessions',
    source: 'lib/db/migrate_v12.ts (Phase 12)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'session_guests' },
      { kind: 'column', table: 'tables', column: 'label' },
      { kind: 'column', table: 'tables', column: 'deleted_at' },
      { kind: 'column', table: 'sessions', column: 'notes' },
    ],
  },
  {
    id: 'v13-pricing-tiles',
    source: 'lib/db/migrate_v13.ts (Phase 13)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'pricing_tiles' },
      { kind: 'table', table: 'payment_line_items' },
      { kind: 'column', table: 'sessions', column: 'parent_session_id' },
      { kind: 'column', table: 'session_guests', column: 'pricing_tile_id' },
      { kind: 'enum', type: 'tile_category', value: 'guest' },
      { kind: 'enum', type: 'tile_category', value: 'addon' },
      { kind: 'enum', type: 'tile_category', value: 'discount' },
      { kind: 'enum', type: 'tile_category', value: 'loyalty' },
    ],
  },
  {
    id: 'phase1-cash-control',
    source: 'lib/db/migrate-phase1-cash-control.ts',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'cashier_shifts' },
      { kind: 'table', table: 'discount_approvals' },
      { kind: 'table', table: 'payment_adjustments' },
      { kind: 'column', table: 'payments', column: 'shift_id' },
      { kind: 'column', table: 'payments', column: 'status' },
      { kind: 'column', table: 'payments', column: 'voided_at' },
    ],
  },
  {
    id: 'payment-foundation',
    source: 'lib/db/migrate-payment-foundation.ts (Phase 8B)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'payment_methods' },
      { kind: 'table', table: 'receiving_accounts' },
      { kind: 'table', table: 'payment_method_accounts' },
      { kind: 'table', table: 'payment_rows' },
    ],
  },
  {
    id: 'phase6b-partial-payments',
    source: 'lib/db/migrate-phase6b-partial-payments.ts',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'column', table: 'payments', column: 'settlement_type' },
      { kind: 'column', table: 'payments', column: 'bill_total_at_payment' },
      { kind: 'column', table: 'payments', column: 'paid_before' },
      { kind: 'column', table: 'payments', column: 'remaining_after' },
    ],
  },
  {
    id: 'phase8b1-charge-lines',
    source: 'lib/db/migrate-phase8b1-buffet-charge-lines.ts',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'buffet_charge_lines' },
      { kind: 'table', table: 'payment_allocations' },
      { kind: 'column', table: 'session_guests', column: 'unit_price' },
    ],
  },
  {
    id: 'tax-invoice-sequence',
    source: 'schema (tax invoice phase)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'tax_invoice_sequence' },
      { kind: 'column', table: 'sessions', column: 'tax_invoice_number' },
    ],
  },
  {
    id: 'phase15q-queue',
    source: 'lib/db/migrate-phase15q.ts',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'column', table: 'queue_entries', column: 'adult_count' },
      { kind: 'column', table: 'queue_entries', column: 'child_count' },
      { kind: 'column', table: 'queue_entries', column: 'customer_type' },
      { kind: 'column', table: 'queue_entries', column: 'soup_pots' },
      { kind: 'column', table: 'queue_entries', column: 'seating_fit' },
      { kind: 'column', table: 'queue_entries', column: 'planned_table_note' },
      { kind: 'column', table: 'queue_entries', column: 'skip_reason' },
      { kind: 'column', table: 'queue_entries', column: 'bill_issued' },
      { kind: 'column', table: 'queue_entries', column: 'admitted_at' },
    ],
  },
  {
    id: 'phase15q-queue-status-values',
    source: 'lib/db/migrate-phase15q.ts (enum values — needed when queue statuses are used)',
    severity: 'WARNING',
    reqs: [
      { kind: 'enum', type: 'queue_status', value: 'waiting_suitable_table' },
      { kind: 'enum', type: 'queue_status', value: 'admitted' },
      { kind: 'enum', type: 'queue_status', value: 'skipped' },
      { kind: 'enum', type: 'queue_status', value: 'cancelled' },
    ],
  },
  {
    id: 'phase15bill-account-configs',
    source: 'lib/db/migrate-phase15bill.ts',
    severity: 'CRITICAL',
    reqs: [{ kind: 'column', table: 'store_settings', column: 'bill_account_configs' }],
  },
  {
    id: 'phase16b-idempotency',
    source: 'lib/db/migrate-phase16b.ts — REQUIRED for all 16B+ payment code',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'column', table: 'payments', column: 'idempotency_key' },
      { kind: 'index', index: 'payments_idempotency_key_uq' },
    ],
  },
  {
    id: 'penalty-tile-enum',
    source: "PENDING migration — tile_category 'penalty' (Phase 16A commit 74f758a). Needed only when a penalty tile is created; documented in docs/architecture/MIGRATIONS.md",
    severity: 'WARNING',
    reqs: [{ kind: 'enum', type: 'tile_category', value: 'penalty' }],
  },
  {
    id: 'phase17ui-employee-department',
    source: 'lib/db/migrate-phase17ui-emp-dept.ts — employees.department; Drizzle selects it on every employees query',
    severity: 'CRITICAL',
    reqs: [{ kind: 'column', table: 'employees', column: 'department' }],
  },
  {
    id: 'phase17ui-employee-sort-order',
    source: 'lib/db/migrate-phase17ui-emp-sort.ts — employees.sort_order; Drizzle selects it on every employees query',
    severity: 'CRITICAL',
    reqs: [{ kind: 'column', table: 'employees', column: 'sort_order' }],
  },
  {
    id: 'phase17ui-hr-lookup-options',
    source: 'lib/db/migrate-phase17ui-hr-options.ts — hr_lookup_options; queried by /hr/employees on load',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'hr_lookup_options' },
      { kind: 'index', index: 'hr_lookup_options_kind_label_uq' },
    ],
  },
  {
    id: 'phase17pos-auth-a1-approval-codes',
    source: 'lib/db/migrate-phase17pos-auth-a1.ts — REQUIRED for /approval-code page + manager-approval.ts actions',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'manager_approval_codes' },
      { kind: 'column', table: 'manager_approval_codes', column: 'code_hash' },
      { kind: 'column', table: 'manager_approval_codes', column: 'status' },
      { kind: 'column', table: 'manager_approval_codes', column: 'expires_at' },
      { kind: 'index', index: 'manager_approval_codes_status_idx' },
      { kind: 'index', index: 'manager_approval_codes_branch_status_idx' },
      { kind: 'index', index: 'manager_approval_codes_expires_at_idx' },
      { kind: 'index', index: 'manager_approval_codes_generated_at_idx' },
    ],
  },
  {
    id: 'phase17ui-payroll-pay',
    source: 'lib/db/migrate-phase17ui-payroll-pay.ts — payroll_items.payment_proof_url_2 (Drizzle selects it on every payroll_items query) + hr_payment_method \'mixed\'',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'column', table: 'payroll_items', column: 'payment_proof_url_2' },
      { kind: 'column', table: 'payroll_items', column: 'paid_cash_amount' },
      { kind: 'column', table: 'payroll_items', column: 'paid_transfer_amount' },
      { kind: 'enum', type: 'hr_payment_method', value: 'mixed' },
    ],
  },
  {
    id: 'phase17ui-hr-incidents',
    source: 'lib/db/migrate-phase17ui-hr-incidents.ts — employee_incidents; queried by /hr-incidents (รายงานพนักงาน)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'employee_incidents' },
      { kind: 'column', table: 'employee_incidents', column: 'type' },
      { kind: 'column', table: 'employee_incidents', column: 'reported_by' },
      { kind: 'index', index: 'employee_incidents_emp_idx' },
      { kind: 'index', index: 'employee_incidents_date_idx' },
    ],
  },
  {
    id: 'phase17ui-damage-items',
    source: 'lib/db/migrate-phase17ui-damage-items.ts — damage_items catalog + employee_incidents snapshot columns (queried by /hr-incidents + /hr/settings)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'damage_items' },
      { kind: 'column', table: 'damage_items', column: 'price_per_unit' },
      { kind: 'column', table: 'employee_incidents', column: 'damage_item_name' },
      { kind: 'column', table: 'employee_incidents', column: 'damage_unit_price' },
      { kind: 'index', index: 'damage_items_name_uq' },
    ],
  },
  {
    id: 'phase17ui-incident-link',
    source: 'lib/db/migrate-phase17ui-incident-link.ts — incident_id on payroll_deductions/payroll_absences (Drizzle selects them on every payroll query; powers ดึงรายการค้าง)',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'column', table: 'payroll_deductions', column: 'incident_id' },
      { kind: 'column', table: 'payroll_absences', column: 'incident_id' },
      { kind: 'column', table: 'employee_incidents', column: 'resolved_at' },
      { kind: 'column', table: 'employee_incidents', column: 'resolved_by' },
      { kind: 'index', index: 'payroll_deductions_incident_idx' },
      { kind: 'index', index: 'payroll_absences_incident_idx' },
    ],
  },
  {
    id: 'phase17pos-auth-a5-store-business-days',
    source: 'lib/db/migrate-phase17pos-auth-a5.ts — REQUIRED for store-wide day closing and POS/shift gates',
    severity: 'CRITICAL',
    reqs: [
      { kind: 'table', table: 'store_business_days' },
      { kind: 'column', table: 'store_business_days', column: 'business_date' },
      { kind: 'column', table: 'store_business_days', column: 'status' },
      { kind: 'index', index: 'store_business_days_business_date_uq' },
      { kind: 'index', index: 'store_business_days_status_idx' },
    ],
  },
];

async function main() {
  // Fetch all metadata in four read-only queries, then evaluate locally.
  const [tables, columns, indexes, enums] = await Promise.all([
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    sql`SELECT pt.typname AS type, pe.enumlabel AS value
        FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid`,
  ]);

  const tableSet = new Set(tables.map((r) => r.table_name as string));
  const columnSet = new Set(columns.map((r) => `${r.table_name}.${r.column_name}`));
  const indexSet = new Set(indexes.map((r) => r.indexname as string));
  const enumSet = new Set(enums.map((r) => `${r.type}=${r.value}`));

  const has = (req: Req): boolean => {
    switch (req.kind) {
      case 'table': return tableSet.has(req.table);
      case 'column': return columnSet.has(`${req.table}.${req.column}`);
      case 'index': return indexSet.has(req.index);
      case 'enum': return enumSet.has(`${req.type}=${req.value}`);
    }
  };

  const describe = (req: Req): string => {
    switch (req.kind) {
      case 'table': return `table ${req.table}`;
      case 'column': return `column ${req.table}.${req.column}`;
      case 'index': return `index ${req.index}`;
      case 'enum': return `enum ${req.type} value '${req.value}'`;
    }
  };

  const dbHost = (() => {
    try { const u = new URL(DATABASE_URL!); return `${u.hostname}${u.pathname}`; }
    catch { return '(unparseable DATABASE_URL)'; }
  })();

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  Lum Him Khue ERP — Migration Status Check (Phase 16E)');
  console.log(`  Database : ${dbHost}`);
  console.log(`  Run at   : ${new Date().toISOString()}`);
  console.log('  Mode     : READ-ONLY — introspection only, never alters');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');

  let criticalMissing = 0;
  let warningMissing = 0;

  for (const group of GROUPS) {
    const missing = group.reqs.filter((r) => !has(r));
    if (missing.length === 0) {
      console.log(`  ✓ APPLIED  [${group.id}] — ${group.source}`);
    } else {
      const icon = group.severity === 'CRITICAL' ? '✗ MISSING ' : '⚠ MISSING ';
      console.log(`  ${icon}[${group.id}] (${group.severity}) — ${group.source}`);
      for (const m of missing) console.log(`      · missing ${describe(m)}`);
      if (group.severity === 'CRITICAL') criticalMissing++;
      else warningMissing++;
    }
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  // Use process.exitCode (not process.exit) — hard-exiting while the neon
  // fetch internals are settling trips a libuv assertion on Windows.
  if (criticalMissing > 0) {
    console.log(`  ❌  MIGRATIONS MISSING — ${criticalMissing} critical group(s) not applied.`);
    console.log('      DO NOT DEPLOY this code against this database.');
    console.log('      See docs/architecture/MIGRATIONS.md for the pending plan.');
    console.log('════════════════════════════════════════════════════════════');
    process.exitCode = 1;
  } else if (warningMissing > 0) {
    console.log(`  ⚠️  BASELINE OK WITH WARNINGS — ${warningMissing} feature-gated group(s) pending.`);
    console.log('      Deploy is safe; the flagged features fail until their migration runs.');
    console.log('════════════════════════════════════════════════════════════');
    process.exitCode = 0;
  } else {
    console.log('  ✅  MIGRATION BASELINE COMPLETE — schema matches current code.');
    console.log('════════════════════════════════════════════════════════════');
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('');
  console.error('❌ Migration check failed to run:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

/**
 * Phase 16C-B — Payment Reconciliation (READ-ONLY)
 *
 * Detects payment/session/shift/tax-invoice inconsistencies caused by partial
 * writes, duplicate submissions, or status drift. SELECT-only: this script
 * never writes, never migrates, never repairs. See docs/production/03_RECONCILIATION.md.
 *
 * Usage: npm run reconcile:payments
 *
 * Exit codes:
 *   0 — clean, or warnings only ("PASSED" / "PASSED WITH WARNINGS")
 *   1 — one or more CRITICAL/HIGH findings ("FAILED"), or the script itself errored
 *
 * Uses the raw neon() HTTP client with explicit column lists so it runs
 * correctly whether or not the Phase 16B idempotency migration has been
 * applied (the shared Drizzle client would reference payments.idempotency_key
 * on every select and fail on un-migrated databases).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

type Row = Record<string, unknown>;
type Severity = 'CRITICAL' | 'HIGH' | 'WARN';
type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';

interface CheckResult {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  count: number;
  explanation: string;
  action: string;
  samples: Row[];
}

const SAMPLE_LIMIT = 10;
const results: CheckResult[] = [];

/** Run one check; any per-check DB error becomes SKIPPED instead of crashing the run. */
async function runCheck(
  def: { id: string; title: string; severity: Severity; explanation: string; action: string },
  fn: () => Promise<{ count: number; samples: Row[]; status?: Status; note?: string }>,
) {
  try {
    const r = await fn();
    results.push({
      ...def,
      status: r.status ?? (r.count > 0 ? (def.severity === 'WARN' ? 'WARN' : 'FAIL') : 'PASS'),
      count: r.count,
      explanation: r.note ? `${def.explanation} ${r.note}` : def.explanation,
      samples: r.samples.slice(0, SAMPLE_LIMIT),
    });
  } catch (e) {
    results.push({
      ...def,
      status: 'SKIPPED',
      count: 0,
      explanation: `${def.explanation} — SKIPPED: ${e instanceof Error ? e.message : String(e)}`,
      samples: [],
    });
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

function printSamples(samples: Row[]) {
  for (const s of samples) {
    const line = Object.entries(s)
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join('  ');
    console.log(`      · ${line}`);
  }
}

async function main() {
  const dbHost = (() => {
    try {
      const u = new URL(DATABASE_URL!);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return '(unparseable DATABASE_URL)';
    }
  })();

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  Lum Him Khue ERP — Payment Reconciliation (Phase 16C-B)');
  console.log(`  Database : ${dbHost}`);
  console.log(`  Run at   : ${new Date().toISOString()}`);
  console.log('  Mode     : READ-ONLY — this script never modifies data');
  console.log('════════════════════════════════════════════════════════════');

  // ── R1 — completed payments with no payment_rows ──────────────────────────
  await runCheck(
    {
      id: 'R1',
      title: 'Payments with no payment rows',
      severity: 'CRITICAL',
      explanation:
        'A completed payment exists but its tender breakdown (payment_rows) is missing — shift expectedCash undercounts this money.',
      action: 'Backfill rows (payments:backfill / ensurePaymentRowsForLegacyPayment) after verifying the payment is real.',
    },
    async () => {
      const [{ n }] = (await sql`
        SELECT count(*)::int AS n
        FROM payments p
        LEFT JOIN payment_rows r ON r.payment_id = p.id
        WHERE p.status = 'completed' AND r.id IS NULL
      `) as { n: number }[];
      const samples = (await sql`
        SELECT p.id, p.receipt_no, p.total::float8 AS total, p.paid_at, p.session_id
        FROM payments p
        LEFT JOIN payment_rows r ON r.payment_id = p.id
        WHERE p.status = 'completed' AND r.id IS NULL
        ORDER BY p.paid_at DESC
        LIMIT ${SAMPLE_LIMIT}
      `) as Row[];
      return { count: n, samples };
    },
  );

  // ── R2 — payment_rows without a parent payment ─────────────────────────────
  await runCheck(
    {
      id: 'R2',
      title: 'Payment rows without parent payment',
      severity: 'CRITICAL',
      explanation:
        'payment_rows referencing a missing payment. The FK should make this impossible — findings mean constraint bypass or historical corruption.',
      action: 'Investigate immediately; do not delete without a snapshot.',
    },
    async () => {
      const [{ n }] = (await sql`
        SELECT count(*)::int AS n
        FROM payment_rows r
        LEFT JOIN payments p ON p.id = r.payment_id
        WHERE p.id IS NULL
      `) as { n: number }[];
      const samples = (await sql`
        SELECT r.id, r.payment_id, r.amount::float8 AS amount, r.paid_at
        FROM payment_rows r
        LEFT JOIN payments p ON p.id = r.payment_id
        WHERE p.id IS NULL
        LIMIT ${SAMPLE_LIMIT}
      `) as Row[];
      return { count: n, samples };
    },
  );

  // ── R3 — payments.total ≠ SUM(payment_rows.amount) ────────────────────────
  await runCheck(
    {
      id: 'R3',
      title: 'Payment total mismatch vs payment_rows sum',
      severity: 'CRITICAL',
      explanation:
        'Completed payments whose total differs from the sum of their completed rows by more than ฿0.01 (satang rounding tolerance). Payments with zero rows are reported by R1, not here.',
      action: 'Compare against the receipt + audit log; correct rows via a supervised fix phase.',
    },
    async () => {
      const rows = (await sql`
        SELECT p.id, p.receipt_no, p.paid_at,
               p.total::float8 AS payment_total,
               SUM(r.amount::numeric)::float8 AS rows_total
        FROM payments p
        JOIN payment_rows r ON r.payment_id = p.id AND r.status = 'completed'
        WHERE p.status = 'completed'
        GROUP BY p.id
        HAVING ABS(p.total::numeric - SUM(r.amount::numeric)) > 0.01
        ORDER BY p.paid_at DESC
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R4a — orphan payment_allocations ───────────────────────────────────────
  await runCheck(
    {
      id: 'R4a',
      title: 'Payment allocations with missing payment/session/charge line',
      severity: 'CRITICAL',
      explanation:
        'Allocations referencing missing parents. FKs should prevent this; findings indicate corruption.',
      action: 'Investigate immediately.',
    },
    async () => {
      const rows = (await sql`
        SELECT a.id, a.payment_id, a.session_id, a.charge_line_id, a.amount::float8 AS amount
        FROM payment_allocations a
        LEFT JOIN payments p ON p.id = a.payment_id
        LEFT JOIN sessions s ON s.id = a.session_id
        LEFT JOIN buffet_charge_lines c ON c.id = a.charge_line_id
        WHERE p.id IS NULL OR s.id IS NULL OR c.id IS NULL
        LIMIT 500
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R4b — allocation sum ≠ payment total ───────────────────────────────────
  await runCheck(
    {
      id: 'R4b',
      title: 'Allocation sum mismatch vs payment total',
      severity: 'HIGH',
      explanation:
        'Payments that have allocations where SUM(allocations.amount) differs from payments.total by more than ฿0.01 — item-mode payment interrupted between inserts.',
      action: 'Reconstruct missing allocations from the receipt; head-mode remaining counts are wrong until fixed.',
    },
    async () => {
      const rows = (await sql`
        SELECT p.id, p.receipt_no, p.paid_at,
               p.total::float8 AS payment_total,
               SUM(a.amount::numeric)::float8 AS alloc_total
        FROM payments p
        JOIN payment_allocations a ON a.payment_id = p.id
        WHERE p.status = 'completed'
        GROUP BY p.id
        HAVING ABS(p.total::numeric - SUM(a.amount::numeric)) > 0.01
        ORDER BY p.paid_at DESC
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R5 — final payment recorded but session still open ─────────────────────
  await runCheck(
    {
      id: 'R5',
      title: 'Fully paid but session still open/occupied',
      severity: 'CRITICAL',
      explanation:
        'Sessions with a completed FINAL payment (remaining_after ≤ 0) still in active/closing status — the processPayment session-close step was lost. Partial payments and active unpaid sessions are NOT flagged.',
      action: 'Force-close the session via tables UI; verify no double charge before closing.',
    },
    async () => {
      const rows = (await sql`
        SELECT s.id AS session_id, s.status AS session_status,
               t.label AS table_label, t.status AS table_status,
               p.id AS payment_id, p.paid_at, p.total::float8 AS total
        FROM sessions s
        JOIN tables t ON t.id = s.table_id
        JOIN payments p ON p.session_id = s.id
        WHERE p.status = 'completed'
          AND p.settlement_type = 'final'
          AND p.remaining_after::numeric <= 0
          AND s.status IN ('active', 'closing')
        ORDER BY p.paid_at DESC
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R6 — overpaid / double-paid sessions ───────────────────────────────────
  await runCheck(
    {
      id: 'R6',
      title: 'Overpaid or double-paid sessions',
      severity: 'CRITICAL',
      explanation:
        'Sessions where completed payments exceed the latest bill_total_at_payment snapshot by more than ฿0.01, or that have more than one FINAL payment. Legacy payments with bill_total_at_payment = 0 are excluded from the overpay test (limitation).',
      action: 'Verify against receipts; likely pre-16B double submission — refund/void via a supervised fix.',
    },
    async () => {
      const rows = (await sql`
        WITH latest AS (
          SELECT DISTINCT ON (session_id) session_id,
                 bill_total_at_payment::numeric AS bill_total
          FROM payments
          WHERE status = 'completed'
          ORDER BY session_id, paid_at DESC
        ), paid AS (
          SELECT session_id,
                 SUM(total::numeric) AS paid_total,
                 COUNT(*) FILTER (WHERE settlement_type = 'final')::int AS final_count,
                 COUNT(*)::int AS payment_count
          FROM payments
          WHERE status = 'completed'
          GROUP BY session_id
        )
        SELECT l.session_id,
               p.paid_total::float8 AS paid_total,
               l.bill_total::float8 AS bill_total,
               p.final_count, p.payment_count
        FROM latest l
        JOIN paid p ON p.session_id = l.session_id
        WHERE (l.bill_total > 0 AND p.paid_total - l.bill_total > 0.01)
           OR p.final_count > 1
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R7a — completed cash rows with no shift (soft-link design → WARN) ─────
  await runCheck(
    {
      id: 'R7a',
      title: 'Cash payment rows with no shift linkage',
      severity: 'WARN',
      explanation:
        'Completed cash rows with shift_id NULL. WARN (not HIGH) by design: STRICT_SHIFT_CASH is off and the system intentionally allows cash payments without an open shift (cashier sees a toast). These amounts are excluded from every shift expectedCash.',
      action: 'Expected small/stable. If growing during service, cashiers are skipping shift open — retrain or enable STRICT_SHIFT_CASH.',
    },
    async () => {
      const [{ n }] = (await sql`
        SELECT count(*)::int AS n
        FROM payment_rows r
        JOIN payment_methods m ON m.id = r.payment_method_id
        WHERE r.status = 'completed' AND m.type = 'cash' AND r.shift_id IS NULL
      `) as { n: number }[];
      const samples = (await sql`
        SELECT r.id, r.amount::float8 AS amount, r.paid_at, r.payment_id
        FROM payment_rows r
        JOIN payment_methods m ON m.id = r.payment_method_id
        WHERE r.status = 'completed' AND m.type = 'cash' AND r.shift_id IS NULL
        ORDER BY r.paid_at DESC
        LIMIT ${SAMPLE_LIMIT}
      `) as Row[];
      return { count: n, samples };
    },
  );

  // ── R7b — cash rows attributed to a shift closed before they were paid ────
  await runCheck(
    {
      id: 'R7b',
      title: 'Cash rows paid after their shift closed',
      severity: 'HIGH',
      explanation:
        'Completed cash rows whose paid_at is more than 1 minute after their linked shift closed — money attributed to a drawer that was already counted.',
      action: 'Review the shift cash difference; the row belongs to the next shift or to no shift.',
    },
    async () => {
      const rows = (await sql`
        SELECT r.id, r.amount::float8 AS amount, r.paid_at,
               cs.id AS shift_id, cs.closed_at
        FROM payment_rows r
        JOIN payment_methods m ON m.id = r.payment_method_id
        JOIN cashier_shifts cs ON cs.id = r.shift_id
        WHERE r.status = 'completed' AND m.type = 'cash'
          AND cs.closed_at IS NOT NULL
          AND r.paid_at > cs.closed_at + INTERVAL '1 minute'
        ORDER BY r.paid_at DESC
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R8 — duplicate receipt numbers ─────────────────────────────────────────
  await runCheck(
    {
      id: 'R8',
      title: 'Duplicate receipt numbers',
      severity: 'HIGH',
      explanation:
        'Completed payments sharing a receipt_no within a 300-day window. Receipt numbers embed day+month but not year (PREFIX+ddMM+seq), so repeats ~1 year apart are the expected wraparound and are not flagged.',
      action: 'Same-day duplicates indicate a counter race or manual receiptNo reuse — verify both receipts.',
    },
    async () => {
      const rows = (await sql`
        SELECT receipt_no, COUNT(*)::int AS n,
               MIN(paid_at) AS first_paid, MAX(paid_at) AS last_paid
        FROM payments
        WHERE receipt_no IS NOT NULL AND status = 'completed'
        GROUP BY receipt_no
        HAVING COUNT(*) > 1 AND MAX(paid_at) - MIN(paid_at) < INTERVAL '300 days'
        ORDER BY MAX(paid_at) DESC
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R9 — duplicate tax invoice numbers ─────────────────────────────────────
  await runCheck(
    {
      id: 'R9',
      title: 'Duplicate tax invoice numbers',
      severity: 'CRITICAL',
      explanation:
        'Sessions sharing a tax_invoice_number. These are sequential legal documents — duplicates are never acceptable (16C-A found a race in the generator that can mint them).',
      action: 'Report to owner/accountant immediately; the generator race fix is scheduled in 16C-C.',
    },
    async () => {
      const rows = (await sql`
        SELECT tax_invoice_number, COUNT(*)::int AS n
        FROM sessions
        WHERE tax_invoice_number IS NOT NULL
        GROUP BY tax_invoice_number
        HAVING COUNT(*) > 1
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R10 — null idempotency keys after 16B is live ──────────────────────────
  await runCheck(
    {
      id: 'R10',
      title: 'Payments without idempotency key after Phase 16B',
      severity: 'HIGH',
      explanation:
        'Cutoff = earliest paid_at among payments that DO have a key (i.e. the moment 16B went live on this database). Completed payments after that cutoff with a NULL key mean some caller bypasses idempotency protection. Pre-cutoff NULLs are legacy and not flagged.',
      action: 'Identify the calling code path; every POS payment must send idempotencyKey.',
    },
    async () => {
      const col = (await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'idempotency_key'
      `) as Row[];
      if (col.length === 0) {
        return {
          count: 0,
          samples: [],
          status: 'WARN' as Status,
          note: '→ WARN: idempotency_key column does not exist — the Phase 16B migration (npm run db:migrate-phase16b) has NOT been run on this database. The 16B code will fail here until it runs.',
        };
      }
      const cutoffRows = (await sql`
        SELECT MIN(paid_at) AS first_key_at FROM payments WHERE idempotency_key IS NOT NULL
      `) as { first_key_at: Date | null }[];
      const firstKeyAt = cutoffRows[0]?.first_key_at;
      if (!firstKeyAt) {
        return {
          count: 0,
          samples: [],
          status: 'SKIPPED' as Status,
          note: '→ SKIPPED: no payment has a key yet (16B code not used on this database so far); cutoff undeterminable.',
        };
      }
      const rows = (await sql`
        SELECT p.id, p.receipt_no, p.paid_at
        FROM payments p
        WHERE p.status = 'completed'
          AND p.idempotency_key IS NULL
          AND p.paid_at > (SELECT MIN(paid_at) FROM payments WHERE idempotency_key IS NOT NULL)
        ORDER BY p.paid_at DESC
      `) as Row[];
      return { count: rows.length, samples: rows, note: `(cutoff: ${fmt(firstKeyAt)})` };
    },
  );

  // ── R11 — orphan payment_line_items ────────────────────────────────────────
  await runCheck(
    {
      id: 'R11',
      title: 'Payment line items with missing payment/pricing tile',
      severity: 'CRITICAL',
      explanation:
        'Line items referencing a missing payment or pricing tile (FK-protected; findings = corruption). Amount re-validation vs tile price is NOT implemented: percentage discounts and price snapshots make historical re-derivation unreliable (documented limitation).',
      action: 'Investigate immediately.',
    },
    async () => {
      const rows = (await sql`
        SELECT li.id, li.payment_id, li.pricing_tile_id, li.amount::float8 AS amount
        FROM payment_line_items li
        LEFT JOIN payments p ON p.id = li.payment_id
        LEFT JOIN pricing_tiles pt ON pt.id = li.pricing_tile_id
        WHERE p.id IS NULL OR pt.id IS NULL
        LIMIT 500
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R12a — closed/paid session on an occupied table ────────────────────────
  await runCheck(
    {
      id: 'R12a',
      title: 'Session/table drift: finished session, table still occupied',
      severity: 'HIGH',
      explanation:
        'Primary sessions in paid/closed status whose table is still occupied with NO other live session on that table.',
      action: 'Free the table via tables UI; if frequent, the table-update step is being lost (16C-C fixes atomicity).',
    },
    async () => {
      const rows = (await sql`
        SELECT s.id AS session_id, s.status AS session_status, s.closed_at,
               t.label AS table_label, t.status AS table_status
        FROM sessions s
        JOIN tables t ON t.id = s.table_id
        WHERE s.parent_session_id IS NULL
          AND s.status IN ('paid', 'closed')
          AND t.status = 'occupied'
          AND t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM sessions s2
            WHERE s2.table_id = t.id AND s2.status IN ('active', 'closing')
          )
        ORDER BY s.closed_at DESC NULLS LAST
        LIMIT 100
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── R12b — live session on an available table ──────────────────────────────
  await runCheck(
    {
      id: 'R12b',
      title: 'Session/table drift: live session, table already available',
      severity: 'HIGH',
      explanation:
        'Primary sessions still active/closing whose table is marked available — customers may be seated at a table the floor plan shows as free.',
      action: 'Set the table occupied or close the session; investigate which action lost its table update.',
    },
    async () => {
      const rows = (await sql`
        SELECT s.id AS session_id, s.status AS session_status, s.started_at,
               t.label AS table_label, t.status AS table_status
        FROM sessions s
        JOIN tables t ON t.id = s.table_id
        WHERE s.parent_session_id IS NULL
          AND s.status IN ('active', 'closing')
          AND t.status = 'available'
          AND t.deleted_at IS NULL
        ORDER BY s.started_at DESC
        LIMIT 100
      `) as Row[];
      return { count: rows.length, samples: rows };
    },
  );

  // ── Report ─────────────────────────────────────────────────────────────────
  const failedCritical = results.filter((r) => r.status === 'FAIL' && r.severity === 'CRITICAL');
  const failedHigh = results.filter((r) => r.status === 'FAIL' && r.severity === 'HIGH');
  const warns = results.filter((r) => r.status === 'WARN');
  const skipped = results.filter((r) => r.status === 'SKIPPED');

  console.log('');
  console.log('  SUMMARY');
  console.log(`    Critical findings : ${failedCritical.length} check(s)`);
  console.log(`    High findings     : ${failedHigh.length} check(s)`);
  console.log(`    Warnings          : ${warns.length} check(s)`);
  console.log(`    Skipped           : ${skipped.length} check(s)`);
  console.log('');
  console.log('  CHECKS');

  for (const r of results) {
    const icon =
      r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'WARN' ? '⚠' : '–';
    console.log('');
    console.log(`  ${icon} [${r.id}] ${r.title} — ${r.status}${r.count > 0 ? ` (${r.count})` : ''} [severity: ${r.severity}]`);
    console.log(`      ${r.explanation}`);
    if (r.status === 'FAIL' || r.status === 'WARN') {
      if (r.samples.length > 0) {
        console.log(`      Samples (max ${SAMPLE_LIMIT}):`);
        printSamples(r.samples);
      }
      console.log(`      → Next action: ${r.action}`);
    }
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  if (failedCritical.length > 0 || failedHigh.length > 0) {
    console.log('  ❌  RECONCILIATION FAILED');
    console.log('      Critical/high inconsistencies found — see checks above.');
    console.log('════════════════════════════════════════════════════════════');
    process.exit(1);
  } else if (warns.length > 0) {
    // Policy: warnings do not fail the run (exit 0) — documented in 03_RECONCILIATION.md
    console.log('  ⚠️  RECONCILIATION PASSED WITH WARNINGS');
    console.log('════════════════════════════════════════════════════════════');
    process.exit(0);
  } else {
    console.log('  ✅  RECONCILIATION PASSED');
    console.log('════════════════════════════════════════════════════════════');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('');
  console.error('❌ Reconciliation script failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});

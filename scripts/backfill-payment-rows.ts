import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { backfillMissingPaymentRows } = await import('../lib/payments/foundation');

  console.log('Payment rows backfill');
  const result = await backfillMissingPaymentRows();

  console.log(`Existing completed payments scanned: ${result.scanned}`);
  console.log(`Payment rows created: ${result.created}`);
  console.log(`Payments skipped: ${result.skipped}`);
  console.log(`Rows requiring legacy fallback: ${result.legacyFallback}`);
  console.log(`Total old payments amount: ${result.oldTotal.toFixed(2)}`);
  console.log(`Total completed payment_rows amount: ${result.newTotal.toFixed(2)}`);
  console.log(`Difference: ${result.difference.toFixed(2)}`);

  if (Math.abs(result.difference) > 0.009) {
    console.error('Backfill completed but totals do not match.');
    process.exit(1);
  }

  console.log('Backfill complete.');
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

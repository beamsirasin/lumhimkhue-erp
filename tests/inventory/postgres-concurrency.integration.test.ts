import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.PHASE17A_TEST_DATABASE_URL;
const disposableAcknowledged = process.env.PHASE17A_DISPOSABLE_DB_ACK === 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';
if (databaseUrl?.includes('-pooler')) {
  throw new Error('PHASE17A_TEST_DATABASE_URL must use a direct non-pooler connection');
}
const enabled = Boolean(databaseUrl && disposableAcknowledged);
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const itemTable = `phase17a_item_${suffix}`;
const receiptTable = `phase17a_receipt_${suffix}`;
const sql = enabled ? neon(databaseUrl as string) : null;

async function receive(receiptKey: string, quantity: number, failAfterInsert = false) {
  if (!sql) throw new Error('DISPOSABLE_DATABASE_NOT_CONFIGURED');
  try {
    await sql.transaction((tx) => [
      tx`SELECT id FROM ${tx.unsafe(itemTable)} WHERE id = 1 FOR UPDATE`,
      tx`SELECT 1 / CASE WHEN received + ${quantity} > ordered THEN 0 ELSE 1 END AS guard
         FROM ${tx.unsafe(itemTable)} WHERE id = 1`,
      tx`INSERT INTO ${tx.unsafe(receiptTable)} (receipt_key, quantity) VALUES (${receiptKey}, ${quantity})`,
      tx`UPDATE ${tx.unsafe(itemTable)} SET received = received + ${quantity} WHERE id = 1`,
      failAfterInsert
        ? tx`SELECT 1 / 0 AS forced_rollback`
        : tx`SELECT 1 AS committed`,
    ]);
    return { duplicate: false };
  } catch (error) {
    const existing = await sql`SELECT receipt_key FROM ${sql.unsafe(receiptTable)} WHERE receipt_key = ${receiptKey}`;
    if (existing.length > 0) return { duplicate: true };
    throw error;
  }
}

describe('Phase 17A.1 disposable PostgreSQL concurrency', { skip: !enabled }, () => {
  before(async () => {
    if (!sql) return;
    await sql`CREATE TABLE ${sql.unsafe(itemTable)} (
      id integer PRIMARY KEY,
      ordered numeric NOT NULL CHECK (ordered > 0),
      received numeric NOT NULL DEFAULT 0 CHECK (received >= 0)
    )`;
    await sql`CREATE TABLE ${sql.unsafe(receiptTable)} (
      receipt_key text PRIMARY KEY,
      quantity numeric NOT NULL CHECK (quantity > 0)
    )`;
  });

  beforeEach(async () => {
    if (!sql) return;
    await sql`TRUNCATE TABLE ${sql.unsafe(receiptTable)}, ${sql.unsafe(itemTable)}`;
    await sql`INSERT INTO ${sql.unsafe(itemTable)} (id, ordered, received) VALUES (1, 8, 0)`;
  });

  after(async () => {
    if (!sql) return;
    await sql`DROP TABLE IF EXISTS ${sql.unsafe(receiptTable)}`;
    await sql`DROP TABLE IF EXISTS ${sql.unsafe(itemTable)}`;
  });

  it('allows only one of concurrent 8 + 8 receipts with different keys', async () => {
    const outcomes = await Promise.allSettled([receive('a', 8), receive('b', 8)]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const [item] = await sql!`SELECT received FROM ${sql!.unsafe(itemTable)} WHERE id = 1`;
    const [sum] = await sql!`SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ${sql!.unsafe(receiptTable)}`;
    assert.equal(Number(item.received), 8);
    assert.equal(Number(sum.quantity), 8);
  });

  it('returns duplicate success for the same idempotency key retry', async () => {
    const first = await receive('retry', 1);
    const second = await receive('retry', 1);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
  });

  it('rolls back receipt insert and cached quantity when a later statement fails', async () => {
    const [beforeRow] = await sql!`SELECT received FROM ${sql!.unsafe(itemTable)} WHERE id = 1`;
    await assert.rejects(() => receive('rollback', 1, true));
    const [afterRow] = await sql!`SELECT received FROM ${sql!.unsafe(itemTable)} WHERE id = 1`;
    const rollbackRows = await sql!`SELECT receipt_key FROM ${sql!.unsafe(receiptTable)} WHERE receipt_key = 'rollback'`;
    assert.equal(Number(afterRow.received), Number(beforeRow.received));
    assert.equal(rollbackRows.length, 0);
  });
});

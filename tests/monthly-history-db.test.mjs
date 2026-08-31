import assert from 'node:assert/strict';
import test from 'node:test';

import { createHomeDatabase } from './d1-home-fixture.mjs';
import { readHomeResponse } from '../lib/home-response.ts';

const historyDb = await import('../lib/monthly-history-db.ts').catch(() => ({}));

test('empty-home clearing preserves actual fields and clears current estimates atomically', async () => {
  const { db, sqlite, batchCalls } = createHomeDatabase();
  sqlite.exec(`INSERT INTO monthly_energy_records
    (household_key, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES ('default-home', '2026-08', 100, 420, 110, 500, 1, 2)`);

  await historyDb.clearMonthlyEstimate(db, 'default-home', '2026-08');

  assert.equal(batchCalls.length, 1);
  assert.deepEqual({ ...sqlite.prepare(`SELECT estimated_kwh, estimated_bill, estimated_at, actual_kwh, actual_bill, actual_at
    FROM monthly_energy_records`).get() }, {
    estimated_kwh: null,
    estimated_bill: null,
    estimated_at: null,
    actual_kwh: 110,
    actual_bill: 500,
    actual_at: 2,
  });
});

test('empty-home clearing removes a current estimate-only row', async () => {
  const { db, sqlite } = createHomeDatabase();
  sqlite.exec(`INSERT INTO monthly_energy_records
    (household_key, billing_month, estimated_kwh, estimated_bill, estimated_at)
    VALUES ('default-home', '2026-08', 100, 420, 1)`);

  await historyDb.clearMonthlyEstimate(db, 'default-home', '2026-08');

  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM monthly_energy_records').get().count, 0);
});

test('an empty home response is read-only and retains the current month estimate', async () => {
  const { db, sqlite } = createHomeDatabase();
  sqlite.exec(`INSERT INTO monthly_energy_records
    (household_key, billing_month, estimated_kwh, estimated_bill, estimated_at)
    VALUES ('default-home', '2026-08', 100, 420, 1)`);

  const response = await readHomeResponse(db, 'default-home', [], Date.parse('2026-08-15T00:00:00+07:00'));

  assert.equal(response.history.length, 1);
  assert.deepEqual(response.history[0], {
    billingMonth: '2026-08',
    estimatedKwh: 100,
    estimatedBill: 420,
    actualKwh: null,
    actualBill: null,
    estimatedAt: 1,
    actualAt: null,
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM monthly_energy_records').get().count, 1);
});

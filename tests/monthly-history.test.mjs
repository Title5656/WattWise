import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBillingMonth,
  mergeActualBill,
  removeActualBill,
  selectRecentRecords,
  upsertEstimate,
  validateActualBillInput,
} from '../lib/monthly-history.ts';

const record = (billingMonth, overrides = {}) => ({
  billingMonth,
  estimatedKwh: 100,
  estimatedBill: 420,
  actualKwh: null,
  actualBill: null,
  estimatedAt: 1,
  actualAt: null,
  ...overrides,
});

test('derives the billing month in Bangkok time across a UTC date boundary', () => {
  assert.equal(getBillingMonth(new Date('2026-08-31T17:30:00.000Z')), '2026-09');
  assert.equal(getBillingMonth(new Date('2026-08-31T16:59:59.000Z')), '2026-08');
});

test('selects only the six newest records and preserves gaps', () => {
  const records = ['2024-01', '2025-01', '2025-03', '2025-07', '2025-09', '2026-01', '2026-03', '2026-05']
    .map((month) => record(month));

  assert.deepEqual(selectRecentRecords(records).map((item) => item.billingMonth), [
    '2025-03', '2025-07', '2025-09', '2026-01', '2026-03', '2026-05',
  ]);
});

test('does not invent chart records when history is empty', () => {
  assert.deepEqual(selectRecentRecords([]), []);
});

test('validates an actual bill with optional kWh and rejects invalid months and numbers', () => {
  assert.deepEqual(validateActualBillInput({ month: '2026-08', actualBill: 512.5 }), {
    month: '2026-08',
    actualBill: 512.5,
    actualKwh: null,
  });
  assert.deepEqual(validateActualBillInput({ month: '2026-08', actualBill: '512.5', actualKwh: '120' }), {
    month: '2026-08',
    actualBill: 512.5,
    actualKwh: 120,
  });
  assert.match(validateActualBillInput({ month: '2026-13', actualBill: 1 }).error, /เดือน/);
  assert.match(validateActualBillInput({ month: '2027-01', actualBill: 1 }, new Date('2026-08-15T00:00:00Z')).error, /อนาคต/);
  assert.match(validateActualBillInput({ month: '2026-08', actualBill: -1 }).error, /ยอดเงิน/);
  assert.match(validateActualBillInput({ month: '2026-08', actualBill: 1, actualKwh: 'nope' }).error, /kWh/);
});

test('merges actual bill fields without overwriting the monthly estimate', () => {
  assert.deepEqual(mergeActualBill(record('2026-08'), {
    month: '2026-08', actualBill: 500, actualKwh: 130,
  }, 99), record('2026-08', {
    actualKwh: 130, actualBill: 500, actualAt: 99,
  }));
});

test('removes actual values while retaining an estimate, or removes an actual-only record', () => {
  assert.deepEqual(removeActualBill(record('2026-08', { actualBill: 500, actualKwh: 130, actualAt: 99 })), record('2026-08'));
  assert.equal(removeActualBill(record('2026-08', { estimatedKwh: null, estimatedBill: null, estimatedAt: null, actualBill: 500 })), null);
});

test('updates only the current month estimate and leaves prior months unchanged', () => {
  const records = [record('2026-07', { estimatedBill: 400 })];
  const updated = upsertEstimate(records, '2026-08', { estimatedKwh: 120, estimatedBill: 530 }, 88, true);

  assert.deepEqual(updated.map((item) => [item.billingMonth, item.estimatedBill]), [['2026-07', 400], ['2026-08', 530]]);
  assert.deepEqual(upsertEstimate(updated, '2026-08', { estimatedKwh: 125, estimatedBill: 550 }, 90, true)
    .map((item) => [item.billingMonth, item.estimatedBill]), [['2026-07', 400], ['2026-08', 550]]);
});

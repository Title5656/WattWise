import assert from 'node:assert/strict';
import test from 'node:test';

import { createHomeDatabase, insertSaved } from './d1-home-fixture.mjs';

const homeApi = await import('../lib/home-api.ts').catch(() => ({}));

function request(items, method = 'PUT') {
  return new Request('https://wattwise.test/api/home', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

function handler(db) {
  assert.equal(typeof homeApi.createHomeHandlers, 'function');
  return homeApi.createHomeHandlers(() => db);
}

function validItem(id = 'active-fan', overrides = {}) {
  return {
    id,
    instanceId: `${id}-instance`,
    quantity: 1,
    hoursPerDay: 4,
    cyclesPerMonth: null,
    usageProfileId: 'fan',
    usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } },
    ...overrides,
  };
}

test('rejects an unknown catalog key without mutating the saved home', async () => {
  const { db, sqlite, batchCalls } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'active-fan', quantity: 4 });

  const response = await handler(db).PUT(request([validItem('unknown-model')]));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'ข้อมูลอุปกรณ์ไม่ถูกต้อง' });
  assert.equal(batchCalls.length, 0);
  assert.deepEqual(sqlite.prepare('SELECT appliance_key, quantity FROM saved_home_appliances').all().map((row) => ({ ...row })), [
    { appliance_key: 'active-fan', quantity: 4 },
  ]);
});

test('requires quantity to be a JSON integer from 1 through 99 before mutation', async () => {
  for (const quantity of ['2', null, true, 0, 100, 1.5]) {
    const { db, batchCalls } = createHomeDatabase();
    const response = await handler(db).PUT(request([validItem('active-fan', { quantity })]));
    assert.equal(response.status, 400, `quantity ${String(quantity)}`);
    assert.equal(batchCalls.length, 0, `quantity ${String(quantity)}`);
  }
});

test('validates every item before issuing replacement mutations', async () => {
  const { db, sqlite, batchCalls } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'active-fan', quantity: 4 });

  const response = await handler(db).PUT(request([
    validItem('active-fan'),
    validItem('missing-second-item'),
  ]));

  assert.equal(response.status, 400);
  assert.equal(batchCalls.length, 0);
  assert.equal(sqlite.prepare('SELECT quantity FROM saved_home_appliances').get().quantity, 4);
});

test('uses the D1 model profile to normalize schedules and cycles', async () => {
  const { db, sqlite } = createHomeDatabase();
  const response = await handler(db).POST(request([validItem('inactive-cycle', {
    usageProfileId: 'television',
    quantity: 2,
    cyclesPerMonth: 13,
    usageSchedule: { kind: 'hours', hoursByPeriod: { night: 1, morning: 1, daytime: 1, evening: 1 } },
  })], 'POST'));

  assert.equal(response.status, 200);
  assert.deepEqual({ ...sqlite.prepare(`SELECT appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule
    FROM saved_home_appliances`).get() }, {
    appliance_key: 'inactive-cycle',
    quantity: 2,
    hours_per_day: 0,
    cycles_per_month: 13,
    usage_schedule: JSON.stringify({ kind: 'periods', periods: ['daytime'] }),
  });
});

test('rejects malformed cycles for a D1 cycle profile without mutation', async () => {
  const { db, batchCalls } = createHomeDatabase();
  const response = await handler(db).PUT(request([validItem('inactive-cycle', { cyclesPerMonth: '13' })]));

  assert.equal(response.status, 400);
  assert.equal(batchCalls.length, 0);
});

test('keeps duplicate model keys as separate validated instances', async () => {
  const { db, sqlite } = createHomeDatabase();
  const response = await handler(db).PUT(request([
    validItem('active-fan', { instanceId: 'fan-one' }),
    validItem('active-fan', { instanceId: 'fan-two', quantity: 2 }),
  ]));

  assert.equal(response.status, 200);
  assert.deepEqual(sqlite.prepare('SELECT appliance_key, quantity FROM saved_home_appliances ORDER BY position').all().map((row) => ({ ...row })), [
    { appliance_key: 'active-fan', quantity: 1 },
    { appliance_key: 'active-fan', quantity: 2 },
  ]);
});

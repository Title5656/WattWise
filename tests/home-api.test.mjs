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

function gateFirstSavedHomeRead(db) {
  let releaseRead;
  let reachedRead;
  let didGate = false;
  const released = new Promise((resolve) => { releaseRead = resolve; });
  const reached = new Promise((resolve) => { reachedRead = resolve; });
  const wrap = (statement) => ({
    ...statement,
    bind(...values) {
      return wrap(statement.bind(...values));
    },
    async all() {
      if (!didGate && statement.sql.includes('FROM saved_home_appliances s')) {
        didGate = true;
        const result = await statement.all();
        reachedRead();
        await released;
        return result;
      }
      return statement.all();
    },
  });
  return {
    db: { ...db, prepare: (sql) => wrap(db.prepare(sql)) },
    reached,
    release: () => releaseRead(),
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

test('a stale GET cannot overwrite monthly history before or after a newer PUT', async () => {
  const { db, sqlite } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'active-fan', quantity: 1, hoursPerDay: 4 });
  const controlled = gateFirstSavedHomeRead(db);
  const handlers = handler(controlled.db);

  const staleGet = handlers.GET();
  await controlled.reached;
  const putResponse = await handlers.PUT(request([validItem('active-fan', { quantity: 2 })]));
  assert.equal(putResponse.status, 200);
  const putBody = await putResponse.json();
  controlled.release();
  assert.equal((await staleGet).status, 200);

  const stored = sqlite.prepare(`SELECT estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill
    FROM monthly_energy_records WHERE household_key = 'default-home'`).get();
  assert.deepEqual({ ...stored }, {
    estimatedKwh: putBody.summary.monthlyKwh,
    estimatedBill: putBody.summary.monthlyBill,
  });
});

test('nonempty replacement and its current-month estimate share one ordered atomic batch', async () => {
  const { db, batchCalls } = createHomeDatabase();
  const response = await handler(db).PUT(request([
    validItem('active-fan', { instanceId: 'fan-one' }),
    validItem('active-fan', { instanceId: 'fan-two', quantity: 2 }),
  ]));

  assert.equal(response.status, 200);
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].length, 3);
  assert.match(batchCalls[0][0].sql, /^DELETE FROM saved_home_appliances/);
  assert.match(batchCalls[0][1].sql, /^INSERT INTO saved_home_appliances/);
  assert.equal(batchCalls[0][1].values.length, 16);
  assert.match(batchCalls[0][2].sql, /^INSERT INTO monthly_energy_records/);
});

test('empty replacement and both estimate-clearing statements share one ordered atomic batch', async () => {
  const { db, sqlite, batchCalls } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'active-fan', quantity: 1 });
  sqlite.exec(`INSERT INTO monthly_energy_records
    (household_key, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES ('default-home', '2026-08', 100, 420, 110, 500, 1, 2)`);

  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-08-15T00:00:00+07:00');
  try {
    const response = await handler(db).PUT(request([]));
    assert.equal(response.status, 200);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].length, 3);
  assert.match(batchCalls[0][0].sql, /^DELETE FROM saved_home_appliances/);
  assert.match(batchCalls[0][1].sql, /^DELETE FROM monthly_energy_records/);
  assert.match(batchCalls[0][2].sql, /^UPDATE monthly_energy_records/);
  assert.deepEqual({ ...sqlite.prepare(`SELECT estimated_kwh, estimated_bill, estimated_at, actual_kwh, actual_bill, actual_at
    FROM monthly_energy_records`).get() }, {
    estimated_kwh: null, estimated_bill: null, estimated_at: null,
    actual_kwh: 110, actual_bill: 500, actual_at: 2,
  });
});

test('100-item saves stay below D1 free query and parameter limits while preserving order and duplicates', async () => {
  const { db, sqlite, batchCalls } = createHomeDatabase();
  const modelKeys = ['active-fan', 'active-annual', 'active-fan', 'inactive-cycle'];
  const items = Array.from({ length: 100 }, (_, index) => validItem(modelKeys[index % modelKeys.length], {
    instanceId: `instance-${index}`,
    quantity: index % 7 + 1,
    cyclesPerMonth: modelKeys[index % modelKeys.length] === 'inactive-cycle' ? 10 + index % 5 : null,
  }));

  const response = await handler(db).PUT(request(items));

  assert.equal(response.status, 200);
  assert.equal(batchCalls.length, 1);
  const statements = batchCalls[0];
  assert.equal(statements.length, 11);
  assert.ok(statements.length < 50);
  assert.match(statements[0].sql, /^DELETE FROM saved_home_appliances/);
  assert.match(statements.at(-1).sql, /^INSERT INTO monthly_energy_records/);
  const inserts = statements.slice(1, -1);
  assert.equal(inserts.length, 9);
  assert.ok(inserts.every(({ values }) => values.length <= 96));
  assert.ok(statements.every(({ values }) => values.length <= 96));
  assert.deepEqual(sqlite.prepare(`SELECT appliance_key AS applianceKey, quantity, position
    FROM saved_home_appliances ORDER BY position, id`).all().map((row) => ({ ...row })), items.map((item, position) => ({
    applianceKey: item.id,
    quantity: item.quantity,
    position,
  })));
});

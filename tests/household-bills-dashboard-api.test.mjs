import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthDatabase } from './d1-auth-fixture.mjs';

const billsModule = await import('../lib/server/household-bills-api.ts').catch(() => ({}));
const dashboardModule = await import('../lib/server/household-dashboard-api.ts').catch(() => ({}));

const NOW = Date.parse('2026-08-15T00:00:00+07:00');

const identities = {
  owner: { subject: 'owner-sub', email: 'owner@example.com', name: 'Owner' },
  admin: { subject: 'admin-sub', email: 'admin@example.com', name: 'Admin' },
  member: { subject: 'member-sub', email: 'member@example.com', name: 'Member' },
  viewer: { subject: 'viewer-sub', email: 'viewer@example.com', name: 'Viewer' },
  outsider: { subject: 'outsider-sub', email: 'outsider@example.com', name: 'Outsider' },
};

function request(path, { method = 'GET', user = identities.owner, json, raw } = {}) {
  return new Request(`https://wattwise.test${path}`, {
    method,
    headers: {
      'oai-authenticated-user-id': user.subject,
      'oai-authenticated-user-email': user.email,
      'oai-authenticated-user-name': user.name,
      ...((json !== undefined || raw !== undefined) ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
}

function setup() {
  const fixture = createAuthDatabase();
  const { sqlite } = fixture;
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, display_name, created_at, updated_at) VALUES
      (1, 'usr_owner', 'owner@example.com', 'Owner', ${NOW}, ${NOW}),
      (2, 'usr_admin', 'admin@example.com', 'Admin', ${NOW}, ${NOW}),
      (3, 'usr_member', 'member@example.com', 'Member', ${NOW}, ${NOW}),
      (4, 'usr_viewer', 'viewer@example.com', 'Viewer', ${NOW}, ${NOW}),
      (5, 'usr_outsider', 'outsider@example.com', 'Outsider', ${NOW}, ${NOW});
    INSERT INTO user_identities (user_id, provider, subject, created_at) VALUES
      (1, 'openai-sites', 'owner-sub', ${NOW}),
      (2, 'openai-sites', 'admin-sub', ${NOW}),
      (3, 'openai-sites', 'member-sub', ${NOW}),
      (4, 'openai-sites', 'viewer-sub', ${NOW}),
      (5, 'openai-sites', 'outsider-sub', ${NOW});
    INSERT INTO households
      (id, public_id, name, province, electricity_provider, home_revision, status, created_at, updated_at)
    VALUES
      (10, 'hh_alpha', 'Alpha House', 'Bangkok', 'MEA', 7, 'active', ${NOW}, ${NOW}),
      (20, 'hh_beta', 'Beta House', 'Chiang Mai', 'PEA', 3, 'active', ${NOW}, ${NOW});
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at) VALUES
      (10, 1, 'owner', ${NOW}, ${NOW}),
      (10, 2, 'admin', ${NOW}, ${NOW}),
      (10, 3, 'member', ${NOW}, ${NOW}),
      (10, 4, 'viewer', ${NOW}, ${NOW}),
      (20, 5, 'owner', ${NOW}, ${NOW});
    INSERT INTO categories VALUES (1, 'fan', 'พัดลม');
    INSERT INTO brands VALUES (1, 'Alpha');
    INSERT INTO appliance_models VALUES
      (101, 'active-fan', 1, 1, 'F-1', 'Active Fan', 'rated_power', 45, NULL, NULL, 0.8, 'fan', 16, 'in', '5', 'https://example.test/fan', 'EGAT', 103, 'high', 1, 1);
    INSERT INTO household_appliances
      (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
    VALUES
      (10, 101, 2, 4, 30, 'alpha-fan', '${JSON.stringify({ kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } })}', 0, ${NOW}, ${NOW});
  `);
  assert.equal(typeof billsModule.createHouseholdBillsApi, 'function');
  assert.equal(typeof dashboardModule.createHouseholdDashboardApi, 'function');
  return {
    ...fixture,
    bills: billsModule.createHouseholdBillsApi(() => fixture.db, { now: () => NOW }),
    dashboard: dashboardModule.createHouseholdDashboardApi(() => fixture.db, { now: () => NOW }),
  };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

function canonicalRows(sqlite, householdId) {
  return sqlite.prepare(`SELECT billing_month, estimated_kwh, estimated_bill,
      actual_kwh, actual_bill, estimated_at, actual_at
    FROM household_monthly_energy_records WHERE household_id = ? ORDER BY billing_month`).all(householdId)
    .map((row) => ({ ...row }));
}

test('owner, admin, and member can upsert actual bills without overwriting estimates; viewer cannot write', async () => {
  const { bills, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, estimated_kwh, estimated_bill, estimated_at)
    VALUES (10, '2026-08', 100, 420, 11)`);

  for (const [index, user] of [identities.owner, identities.admin, identities.member].entries()) {
    const response = await json(await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
      method: 'PUT', user, json: { actualBill: 500 + index, actualKwh: 120 + index, month: '1999-01' },
    }), { householdId: 'hh_alpha', month: '2026-08' }));
    assert.equal(response.status, 200);
    assert.equal(response.body.householdId, 'hh_alpha');
    assert.equal(response.body.records.at(-1).actualBill, 500 + index);
  }

  assert.deepEqual(canonicalRows(sqlite, 10), [{
    billing_month: '2026-08', estimated_kwh: 100, estimated_bill: 420,
    actual_kwh: 122, actual_bill: 502, estimated_at: 11, actual_at: NOW,
  }]);
  const denied = await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
    method: 'PUT', user: identities.viewer, json: { actualBill: 999 },
  }), { householdId: 'hh_alpha', month: '2026-08' });
  assert.equal(denied.status, 403);
  assert.equal(canonicalRows(sqlite, 10)[0].actual_bill, 502);
});

test('bill reads are available to every member while outsiders cannot read or mutate another household', async () => {
  const { bills, dashboard, sqlite } = setup();
  sqlite.exec(`
    INSERT INTO household_monthly_energy_records (household_id, billing_month, actual_bill, actual_at)
      VALUES (10, '2026-07', 410, 1), (20, '2026-07', 910, 2);
  `);

  for (const user of [identities.owner, identities.admin, identities.member, identities.viewer]) {
    const response = await json(await bills.GET(request('/api/households/hh_alpha/bills', { user }), { householdId: 'hh_alpha' }));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.records.map((record) => record.actualBill), [410]);
    assert.equal((await dashboard.GET(request('/api/households/hh_alpha/dashboard', { user }), { householdId: 'hh_alpha' })).status, 200);
  }

  assert.equal((await bills.GET(request('/api/households/hh_beta/bills'), { householdId: 'hh_beta' })).status, 404);
  assert.equal((await dashboard.GET(request('/api/households/hh_beta/dashboard'), { householdId: 'hh_beta' })).status, 404);
  assert.equal((await bills.PUT(request('/api/households/hh_beta/bills/2026-07', {
    method: 'PUT', json: { actualBill: 1 },
  }), { householdId: 'hh_beta', month: '2026-07' })).status, 404);
  assert.equal((await bills.DELETE(request('/api/households/hh_beta/bills/2026-07', {
    method: 'DELETE',
  }), { householdId: 'hh_beta', month: '2026-07' })).status, 404);
  assert.equal(canonicalRows(sqlite, 20)[0].actual_bill, 910);
});

test('an authorized household with no monthly rows returns an empty list without weakening outsider isolation', async () => {
  const { bills } = setup();

  const authorized = await json(await bills.GET(request('/api/households/hh_alpha/bills', {
    user: identities.viewer,
  }), { householdId: 'hh_alpha' }));
  assert.equal(authorized.status, 200);
  assert.deepEqual(authorized.body, { householdId: 'hh_alpha', records: [] });

  const outsider = await bills.GET(request('/api/households/hh_alpha/bills', {
    user: identities.outsider,
  }), { householdId: 'hh_alpha' });
  assert.equal(outsider.status, 404);
});

test('the same billing month stays isolated between two household public paths', async () => {
  const { bills, sqlite } = setup();

  assert.equal((await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
    method: 'PUT', user: identities.owner, json: { actualBill: 400 },
  }), { householdId: 'hh_alpha', month: '2026-08' })).status, 200);
  assert.equal((await bills.PUT(request('/api/households/hh_beta/bills/2026-08', {
    method: 'PUT', user: identities.outsider, json: { actualBill: 900 },
  }), { householdId: 'hh_beta', month: '2026-08' })).status, 200);

  assert.equal(canonicalRows(sqlite, 10)[0].actual_bill, 400);
  assert.equal(canonicalRows(sqlite, 20)[0].actual_bill, 900);
  const alpha = await json(await bills.GET(request('/api/households/hh_alpha/bills'), { householdId: 'hh_alpha' }));
  const beta = await json(await bills.GET(request('/api/households/hh_beta/bills', { user: identities.outsider }), { householdId: 'hh_beta' }));
  assert.deepEqual(alpha.body.records.map((record) => record.actualBill), [400]);
  assert.deepEqual(beta.body.records.map((record) => record.actualBill), [900]);
});

test('delete clears actual fields on estimate rows and removes actual-only rows in one atomic batch', async () => {
  const { bills, sqlite, batchCalls } = setup();
  sqlite.exec(`
    INSERT INTO household_monthly_energy_records
      (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES
      (10, '2026-07', 100, 420, 110, 500, 1, 2),
      (10, '2026-08', NULL, NULL, 120, 550, NULL, 3);
  `);

  const estimateDelete = await bills.DELETE(request('/api/households/hh_alpha/bills/2026-07', { method: 'DELETE' }), {
    householdId: 'hh_alpha', month: '2026-07',
  });
  assert.equal(estimateDelete.status, 200);
  assert.equal(batchCalls.length, 1);
  assert.match(batchCalls[0][0].sql, /^DELETE FROM household_monthly_energy_records/);
  assert.match(batchCalls[0][1].sql, /^UPDATE household_monthly_energy_records/);

  const actualOnlyDelete = await bills.DELETE(request('/api/households/hh_alpha/bills/2026-08', { method: 'DELETE' }), {
    householdId: 'hh_alpha', month: '2026-08',
  });
  assert.equal(actualOnlyDelete.status, 200);
  assert.deepEqual(canonicalRows(sqlite, 10), [{
    billing_month: '2026-07', estimated_kwh: 100, estimated_bill: 420,
    actual_kwh: null, actual_bill: null, estimated_at: 1, actual_at: null,
  }]);
});

test('validation runs after authorization and rejects bad months, JSON, and values without mutation', async () => {
  const cases = [
    { month: '2026-8', json: { actualBill: 1 } },
    { month: '2026-09', json: { actualBill: 1 } },
    { month: '2026-08', json: { actualBill: -1 } },
    { month: '2026-08', json: { actualBill: 'nope' } },
    { month: '2026-08', json: { actualBill: 1, actualKwh: -1 } },
    { month: '2026-08', json: { actualBill: 1, actualKwh: 'nope' } },
  ];
  for (const input of cases) {
    const { bills, sqlite } = setup();
    const response = await bills.PUT(request(`/api/households/hh_alpha/bills/${input.month}`, {
      method: 'PUT', json: input.json,
    }), { householdId: 'hh_alpha', month: input.month });
    assert.equal(response.status, 400, `${input.month} ${JSON.stringify(input.json)}`);
    assert.deepEqual(canonicalRows(sqlite, 10), []);
  }

  const { bills, sqlite } = setup();
  const malformed = await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
    method: 'PUT', raw: '{',
  }), { householdId: 'hh_alpha', month: '2026-08' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(canonicalRows(sqlite, 10), []);

  const outsiderMalformed = await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
    method: 'PUT', user: identities.outsider, raw: '{',
  }), { householdId: 'hh_alpha', month: '2026-08' });
  assert.equal(outsiderMalformed.status, 404);
  const viewerMalformed = await bills.PUT(request('/api/households/hh_alpha/bills/2026-08', {
    method: 'PUT', user: identities.viewer, raw: '{',
  }), { householdId: 'hh_alpha', month: '2026-08' });
  assert.equal(viewerMalformed.status, 403);
});

test('a writer demoted or removed immediately before mutation receives 403/404 and cannot change bills', async () => {
  for (const scenario of [
    { sql: "UPDATE household_members SET role = 'viewer' WHERE household_id = 10 AND user_id = 3", status: 403 },
    { sql: 'DELETE FROM household_members WHERE household_id = 10 AND user_id = 3', status: 404 },
  ]) {
    for (const method of ['PUT', 'DELETE']) {
      const { db, sqlite } = setup();
      sqlite.exec(`INSERT INTO household_monthly_energy_records
        (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
        VALUES (10, '2026-08', 100, 420, 120, 500, 1, 2)`);
      let hookFired = false;
      const racingDb = {
        ...db,
        async batch(statements) {
          hookFired = true;
          sqlite.exec(scenario.sql);
          return db.batch(statements);
        },
      };
      const api = billsModule.createHouseholdBillsApi(() => racingDb, { now: () => NOW });
      const response = method === 'PUT'
        ? await api.PUT(request('/api/households/hh_alpha/bills/2026-08', {
          method, user: identities.member, json: { actualBill: 999, actualKwh: 999 },
        }), { householdId: 'hh_alpha', month: '2026-08' })
        : await api.DELETE(request('/api/households/hh_alpha/bills/2026-08', {
          method, user: identities.member,
        }), { householdId: 'hh_alpha', month: '2026-08' });
      assert.equal(hookFired, true);
      assert.equal(response.status, scenario.status);
      assert.equal(canonicalRows(sqlite, 10)[0].actual_bill, 500);
    }
  }
});

test('dashboard returns canonical Home snapshot, dynamic household role, and recent history without writes', async () => {
  const { dashboard, sqlite, batchCalls } = setup();
  sqlite.exec(`
    INSERT INTO household_monthly_energy_records
      (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES
      (10, '2026-06', 90, 380, 95, 400, 1, 2),
      (10, '2026-08', 100, 420, 110, 500, 3, 4);
  `);
  const before = canonicalRows(sqlite, 10);

  const response = await json(await dashboard.GET(request('/api/households/hh_alpha/dashboard', {
    user: identities.viewer,
  }), { householdId: 'hh_alpha' }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.household, {
    id: 'hh_alpha', name: 'Alpha House', province: 'Bangkok', electricityProvider: 'MEA', role: 'viewer',
  });
  assert.equal(response.body.revision, 7);
  assert.deepEqual(response.body.items.map((item) => item.instanceId), ['alpha-fan']);
  assert.equal(typeof response.body.summary.monthlyBill, 'number');
  assert.deepEqual(response.body.history.map((record) => record.billingMonth), ['2026-06', '2026-08']);
  assert.equal(Object.hasOwn(response.body.household, 'householdId'), false);
  assert.equal(Object.hasOwn(response.body.items[0], 'rowId'), false);
  assert.deepEqual(canonicalRows(sqlite, 10), before);
  assert.equal(batchCalls.length, 1);
  assert.ok(batchCalls[0].every((statement) => /^\s*SELECT\b/i.test(statement.sql)));
});

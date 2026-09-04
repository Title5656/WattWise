import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthDatabase } from './d1-auth-fixture.mjs';

const homeModule = await import('../lib/server/household-home-api.ts').catch(() => ({}));

const NOW = Date.parse('2026-08-15T00:00:00+07:00');

const identities = {
  owner: { subject: 'owner-sub', email: 'owner@example.com', name: 'Owner' },
  member: { subject: 'member-sub', email: 'member@example.com', name: 'Member' },
  viewer: { subject: 'viewer-sub', email: 'viewer@example.com', name: 'Viewer' },
  outsider: { subject: 'outsider-sub', email: 'outsider@example.com', name: 'Outsider' },
};

function request(path, { method = 'GET', user = identities.owner, json } = {}) {
  return new Request(`https://wattwise.test${path}`, {
    method,
    headers: {
      'oai-authenticated-user-id': user.subject,
      'oai-authenticated-user-email': user.email,
      'oai-authenticated-user-name': user.name,
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

function setup() {
  const fixture = createAuthDatabase();
  const { sqlite } = fixture;
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, display_name, created_at, updated_at) VALUES
      (1, 'usr_owner', 'owner@example.com', 'Owner', ${NOW}, ${NOW}),
      (2, 'usr_member', 'member@example.com', 'Member', ${NOW}, ${NOW}),
      (3, 'usr_viewer', 'viewer@example.com', 'Viewer', ${NOW}, ${NOW}),
      (4, 'usr_outsider', 'outsider@example.com', 'Outsider', ${NOW}, ${NOW});
    INSERT INTO user_identities (user_id, provider, subject, created_at) VALUES
      (1, 'openai-sites', 'owner-sub', ${NOW}),
      (2, 'openai-sites', 'member-sub', ${NOW}),
      (3, 'openai-sites', 'viewer-sub', ${NOW}),
      (4, 'openai-sites', 'outsider-sub', ${NOW});
    INSERT INTO households (id, public_id, name, home_revision, status, created_at, updated_at) VALUES
      (10, 'hh_alpha', 'Alpha', 0, 'active', ${NOW}, ${NOW}),
      (20, 'hh_beta', 'Beta', 4, 'active', ${NOW}, ${NOW});
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at) VALUES
      (10, 1, 'owner', ${NOW}, ${NOW}),
      (10, 2, 'member', ${NOW}, ${NOW}),
      (10, 3, 'viewer', ${NOW}, ${NOW}),
      (20, 4, 'owner', ${NOW}, ${NOW});
    INSERT INTO categories VALUES (1, 'fan', 'พัดลม'), (2, 'washing-machine', 'เครื่องซักผ้า');
    INSERT INTO brands VALUES (1, 'Alpha');
    INSERT INTO appliance_models VALUES
      (101, 'active-fan', 1, 1, 'F-1', 'Active Fan', 'rated_power', 45, NULL, NULL, 0.8, 'fan', 16, 'in', '5', 'https://example.test/fan', 'EGAT', 103, 'high', 1, 1),
      (102, 'active-cycle', 2, 1, 'W-1', 'Active Washer', 'per_cycle', NULL, NULL, 1.25, NULL, 'washing_machine', 9, 'kg', '5', 'https://example.test/washer', 'EGAT', 104, 'high', 1, 2),
      (103, 'inactive-fan', 1, 1, 'F-OLD', 'Inactive Fan', 'rated_power', 60, NULL, NULL, 1, 'fan', 18, 'in', NULL, NULL, NULL, NULL, 'sample', 0, 3);
  `);
  assert.equal(typeof homeModule.createHouseholdHomeApi, 'function');
  return {
    ...fixture,
    api: homeModule.createHouseholdHomeApi(() => fixture.db, { now: () => NOW }),
  };
}

function validItem(instanceId = 'fan-main', overrides = {}) {
  return {
    id: 'active-fan',
    instanceId,
    quantity: 1,
    hoursPerDay: 4,
    cyclesPerMonth: null,
    usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } },
    ...overrides,
  };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('owner and member can save/read stable household instances while viewer cannot save', async () => {
  const { api, sqlite } = setup();

  const saved = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', user: identities.member, json: { expectedRevision: 0, items: [validItem('stable-fan')] },
  }), { householdId: 'hh_alpha' }));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.householdId, 'hh_alpha');
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.items[0].instanceId, 'stable-fan');

  const read = await json(await api.GET(request('/api/households/hh_alpha/home'), { householdId: 'hh_alpha' }));
  assert.equal(read.status, 200);
  assert.equal(read.body.revision, 1);
  assert.equal(read.body.items[0].instanceId, 'stable-fan');
  assert.equal(Object.hasOwn(read.body.items[0], 'rowId'), false);
  assert.equal(typeof read.body.summary.monthlyKwh, 'number');
  assert.ok(Array.isArray(read.body.history));

  const denied = await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', user: identities.viewer, json: { expectedRevision: 1, items: [] },
  }), { householdId: 'hh_alpha' });
  assert.equal(denied.status, 403);
  assert.equal(sqlite.prepare('SELECT home_revision FROM households WHERE id = 10').get().home_revision, 1);
});

test("inactive catalog models are accepted only for the household's existing instance identities", async () => {
  const { api, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_appliances
    (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
    VALUES (10, 103, 1, 4, 30, 'legacy-fan', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW})`);
  const existing = validItem('legacy-fan', { id: 'inactive-fan', quantity: 2 });

  const addedInactive = await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT',
    json: { expectedRevision: 0, items: [existing, validItem('new-inactive', { id: 'inactive-fan' })] },
  }), { householdId: 'hh_alpha' });
  assert.equal(addedInactive.status, 400);
  assert.deepEqual(sqlite.prepare(`SELECT instance_key AS instanceId, quantity FROM household_appliances
    WHERE household_id = 10`).all().map((row) => ({ ...row })), [{ instanceId: 'legacy-fan', quantity: 1 }]);

  const preserved = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 0, items: [existing] },
  }), { householdId: 'hh_alpha' }));
  assert.equal(preserved.status, 200);
  assert.equal(preserved.body.revision, 1);
  assert.equal(preserved.body.items[0].id, 'inactive-fan');
  assert.deepEqual({ ...sqlite.prepare(`SELECT appliance_model_id AS modelId, instance_key AS instanceId, quantity
    FROM household_appliances WHERE household_id = 10`).get() }, {
    modelId: 103, instanceId: 'legacy-fan', quantity: 2,
  });
});

test('a stale snapshot preserving an inactive instance gets a revision conflict before catalog validation', async () => {
  const { api, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_appliances
    (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
    VALUES (10, 103, 1, 4, 30, 'legacy-fan', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW})`);

  const winner = await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 0, items: [] },
  }), { householdId: 'hh_alpha' });
  assert.equal(winner.status, 200);

  const stale = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT',
    json: {
      expectedRevision: 0,
      items: [validItem('legacy-fan', { id: 'inactive-fan' })],
    },
  }), { householdId: 'hh_alpha' }));

  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'HOME_REVISION_CONFLICT');
  assert.equal(stale.body.currentRevision, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_appliances WHERE household_id = 10').get().count, 0);
});

test('non-members cannot read or write another household and cannot mutate it', async () => {
  const { api, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_appliances
    (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
    VALUES (20, 101, 3, 2, 30, 'beta-fan', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW})`);

  assert.equal((await api.GET(request('/api/households/hh_beta/home'), { householdId: 'hh_beta' })).status, 404);
  assert.equal((await api.PUT(request('/api/households/hh_beta/home', {
    method: 'PUT', json: { expectedRevision: 4, items: [] },
  }), { householdId: 'hh_beta' })).status, 404);
  assert.deepEqual({ ...sqlite.prepare('SELECT instance_key, quantity FROM household_appliances WHERE household_id = 20').get() }, {
    instance_key: 'beta-fan', quantity: 3,
  });
  assert.equal(sqlite.prepare('SELECT home_revision FROM households WHERE id = 20').get().home_revision, 4);
});

test('PUT enforces the household authorization boundary before parsing malformed JSON', async () => {
  const { api } = setup();
  const malformed = (user) => new Request('https://wattwise.test/api/households/hh_alpha/home', {
    method: 'PUT',
    headers: {
      'oai-authenticated-user-id': user.subject,
      'oai-authenticated-user-email': user.email,
      'content-type': 'application/json',
    },
    body: '{',
  });

  assert.equal((await api.PUT(malformed(identities.outsider), { householdId: 'hh_alpha' })).status, 404);
  assert.equal((await api.PUT(malformed(identities.viewer), { householdId: 'hh_alpha' })).status, 403);
  assert.equal((await api.PUT(new Request('https://wattwise.test/api/households/hh_alpha/home', {
    method: 'PUT', body: '{',
  }), { householdId: 'hh_alpha' })).status, 401);
});

test('a stale editor receives a revision conflict and the winning snapshot remains intact', async () => {
  const { api, sqlite } = setup();
  const first = await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', user: identities.owner, json: { expectedRevision: 0, items: [validItem('winner', { quantity: 2 })] },
  }), { householdId: 'hh_alpha' });
  assert.equal(first.status, 200);
  const winningEstimate = sqlite.prepare(`SELECT estimated_kwh, estimated_bill, estimated_at
    FROM household_monthly_energy_records WHERE household_id = 10 AND billing_month = '2026-08'`).get();

  const stale = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', user: identities.member, json: { expectedRevision: 0, items: [validItem('loser', { quantity: 9 })] },
  }), { householdId: 'hh_alpha' }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'HOME_REVISION_CONFLICT');
  assert.equal(stale.body.currentRevision, 1);
  assert.deepEqual(sqlite.prepare('SELECT instance_key, quantity FROM household_appliances WHERE household_id = 10').all().map((row) => ({ ...row })), [
    { instance_key: 'winner', quantity: 2 },
  ]);
  assert.equal(sqlite.prepare('SELECT home_revision FROM households WHERE id = 10').get().home_revision, 1);
  assert.deepEqual({ ...sqlite.prepare(`SELECT estimated_kwh, estimated_bill, estimated_at
    FROM household_monthly_energy_records WHERE household_id = 10 AND billing_month = '2026-08'`).get() }, {
    ...winningEstimate,
  });
});

test('GET returns revision, appliances, and history from one snapshot when a concurrent save interleaves', async () => {
  const { db, sqlite } = setup();
  sqlite.exec(`
    INSERT INTO household_appliances
      (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
    VALUES (10, 101, 1, 4, 30, 'old-item', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW});
    INSERT INTO household_monthly_energy_records
      (household_id, billing_month, estimated_kwh, estimated_bill, estimated_at)
    VALUES (10, '2026-08', 10, 50, 1);
  `);
  let hookFired = false;
  let insideBatch = false;
  const installConcurrentSave = () => {
    if (hookFired) return;
    hookFired = true;
    sqlite.exec(`
      UPDATE households SET home_revision = 1 WHERE id = 10;
      DELETE FROM household_appliances WHERE household_id = 10;
      INSERT INTO household_appliances
        (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
      VALUES (10, 101, 2, 4, 30, 'new-item', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW});
      UPDATE household_monthly_energy_records
        SET estimated_kwh = 99, estimated_bill = 499, estimated_at = 2
        WHERE household_id = 10 AND billing_month = '2026-08';
    `);
  };
  const racingDb = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      const wrap = (bound) => ({
        sql,
        values: bound.values,
        bind(...values) {
          return wrap(statement.bind(...values));
        },
        async all() {
          if (!insideBatch && sql.includes('FROM household_monthly_energy_records')) installConcurrentSave();
          return bound.all();
        },
        run: () => bound.run(),
      });
      return wrap(statement);
    },
    async batch(statements) {
      if (statements.every((statement) => /^\s*SELECT\b/i.test(statement.sql))) installConcurrentSave();
      insideBatch = true;
      try {
        return await db.batch(statements);
      } finally {
        insideBatch = false;
      }
    },
  };
  const api = homeModule.createHouseholdHomeApi(() => racingDb, { now: () => NOW });

  const response = await json(await api.GET(request('/api/households/hh_alpha/home'), { householdId: 'hh_alpha' }));

  assert.equal(response.status, 200);
  const observed = JSON.stringify({
    revision: response.body.revision,
    instanceIds: response.body.items.map((item) => item.instanceId),
    estimatedKwh: response.body.history[0]?.estimatedKwh,
  });
  assert.equal(hookFired, true, 'concurrent-save hook must fire');
  assert.ok(new Set([
    JSON.stringify({ revision: 0, instanceIds: ['old-item'], estimatedKwh: 10 }),
    JSON.stringify({ revision: 1, instanceIds: ['new-item'], estimatedKwh: 99 }),
  ]).has(observed), observed);
});

test('GET returns 404 when membership is removed before its transactional reads', async () => {
  const { db, sqlite } = setup();
  let hookFired = false;
  const racingDb = {
    ...db,
    async batch(statements) {
      hookFired = true;
      sqlite.exec('DELETE FROM household_members WHERE household_id = 10 AND user_id = 2');
      return db.batch(statements);
    },
  };
  const api = homeModule.createHouseholdHomeApi(() => racingDb, { now: () => NOW });

  const response = await api.GET(request('/api/households/hh_alpha/home', {
    user: identities.member,
  }), { householdId: 'hh_alpha' });

  assert.equal(hookFired, true, 'transactional-read hook must fire');
  assert.equal(response.status, 404);
});

test('successful PUT returns history captured before the final bump even when another save follows', async () => {
  const { db, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES (10, '2026-08', 10, 50, 110, 500, 1, 2)`);
  let hookFired = false;
  const racingDb = {
    ...db,
    async batch(statements) {
      const results = await db.batch(statements);
      if (statements.at(-1)?.sql.startsWith('UPDATE households SET home_revision = home_revision + 1')) {
        hookFired = true;
        sqlite.exec(`
          UPDATE households SET home_revision = home_revision + 1 WHERE id = 10;
          UPDATE household_monthly_energy_records
            SET actual_kwh = 999, actual_bill = 9999, actual_at = 3
            WHERE household_id = 10 AND billing_month = '2026-08';
        `);
      }
      return results;
    },
  };
  const api = homeModule.createHouseholdHomeApi(() => racingDb, { now: () => NOW });

  const response = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 0, items: [validItem('saved-item')] },
  }), { householdId: 'hh_alpha' }));

  assert.equal(hookFired, true, 'post-save hook must fire');
  assert.equal(response.status, 200);
  assert.equal(response.body.revision, 1);
  assert.equal(response.body.history[0].estimatedKwh, response.body.summary.monthlyKwh);
  assert.equal(response.body.history[0].actualBill, 500);
  assert.equal(sqlite.prepare(`SELECT actual_bill FROM household_monthly_energy_records
    WHERE household_id = 10 AND billing_month = '2026-08'`).get().actual_bill, 9999);
});

test('conflict resolution atomically returns 404 or 403 when access changes during resolution', async () => {
  for (const scenario of [
    { mutation: 'DELETE FROM household_members WHERE household_id = 10 AND user_id = 2', status: 404 },
    { mutation: "UPDATE household_members SET role = 'viewer' WHERE household_id = 10 AND user_id = 2", status: 403 },
  ]) {
    const { db, sqlite } = setup();
    sqlite.exec('UPDATE households SET home_revision = 1 WHERE id = 10');
    let accessReads = 0;
    let hookFired = false;
    const racingDb = {
      ...db,
      prepare(sql) {
        const statement = db.prepare(sql);
        const wrap = (bound) => ({
          sql,
          values: bound.values,
          bind(...values) {
            return wrap(statement.bind(...values));
          },
          async all() {
            if (sql.includes('households.home_revision AS currentRevision')) {
              sqlite.exec(scenario.mutation);
              hookFired = true;
              return bound.all();
            }
            if (sql.includes('SELECT household_members.user_id AS userId')) {
              accessReads += 1;
              if (accessReads === 2) {
                const result = await bound.all();
                sqlite.exec(scenario.mutation);
                hookFired = true;
                return result;
              }
            }
            return bound.all();
          },
          run: () => bound.run(),
        });
        return wrap(statement);
      },
    };
    const api = homeModule.createHouseholdHomeApi(() => racingDb, { now: () => NOW });

    const response = await api.PUT(request('/api/households/hh_alpha/home', {
      method: 'PUT', user: identities.member, json: { expectedRevision: 0, items: [validItem()] },
    }), { householdId: 'hh_alpha' });

    assert.equal(hookFired, true, 'conflict-resolution hook must fire');
    assert.equal(response.status, scenario.status);
  }
});

test('a writer demoted or removed before the batch cannot mutate the household', async () => {
  for (const membershipMutation of [
    "UPDATE household_members SET role = 'viewer' WHERE household_id = 10 AND user_id = 2",
    'DELETE FROM household_members WHERE household_id = 10 AND user_id = 2',
  ]) {
    const { db, sqlite } = setup();
    sqlite.exec(`
      INSERT INTO household_appliances
        (household_id, appliance_model_id, quantity, hours_per_day, days_per_month, instance_key, usage_schedule, position, created_at, updated_at)
      VALUES (10, 101, 3, 4, 30, 'original', '${JSON.stringify(validItem().usageSchedule)}', 0, ${NOW}, ${NOW});
      INSERT INTO household_monthly_energy_records
        (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
      VALUES (10, '2026-08', 10, 50, 12, 60, 1, 2);
    `);
    let intercepted = false;
    const racingDb = {
      ...db,
      async batch(statements) {
        if (!intercepted) {
          intercepted = true;
          sqlite.exec(membershipMutation);
        }
        return db.batch(statements);
      },
    };
    const api = homeModule.createHouseholdHomeApi(() => racingDb, { now: () => NOW });

    const response = await api.PUT(request('/api/households/hh_alpha/home', {
      method: 'PUT', user: identities.member, json: { expectedRevision: 0, items: [validItem('replacement')] },
    }), { householdId: 'hh_alpha' });

    assert.equal(response.status, membershipMutation.startsWith('DELETE') ? 404 : 403);
    assert.deepEqual({ ...sqlite.prepare('SELECT instance_key, quantity FROM household_appliances WHERE household_id = 10').get() }, {
      instance_key: 'original', quantity: 3,
    });
    assert.deepEqual({ ...sqlite.prepare(`SELECT estimated_kwh, estimated_bill, actual_kwh, actual_bill
      FROM household_monthly_energy_records WHERE household_id = 10 AND billing_month = '2026-08'`).get() }, {
      estimated_kwh: 10, estimated_bill: 50, actual_kwh: 12, actual_bill: 60,
    });
    assert.equal(sqlite.prepare('SELECT home_revision FROM households WHERE id = 10').get().home_revision, 0);
  }
});

test('malformed snapshots are rejected before any mutation', async () => {
  const invalidBodies = [
    { expectedRevision: -1, items: [] },
    { expectedRevision: 0.5, items: [] },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1, items: [] },
    { expectedRevision: 0, items: [validItem('   ')] },
    { expectedRevision: 0, items: [validItem('same'), validItem('same')] },
    { expectedRevision: 0, items: [validItem('unknown', { id: 'unknown-model' })] },
    { expectedRevision: 0, items: [validItem('inactive', { id: 'inactive-fan' })] },
    { expectedRevision: 0, items: [validItem('bad-usage', { hoursPerDay: -1 })] },
    { expectedRevision: 0, items: Array.from({ length: 101 }, (_, index) => validItem(`fan-${index}`)) },
  ];

  for (const body of invalidBodies) {
    const { api, sqlite, batchCalls } = setup();
    const response = await api.PUT(request('/api/households/hh_alpha/home', {
      method: 'PUT', json: body,
    }), { householdId: 'hh_alpha' });
    assert.equal(response.status, 400);
    assert.equal(batchCalls.length, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_appliances').get().count, 0);
    assert.equal(sqlite.prepare('SELECT home_revision FROM households WHERE id = 10').get().home_revision, 0);
  }
});

test('estimate replacement and clearing preserve actual fields in the canonical monthly row', async () => {
  const { api, sqlite } = setup();
  sqlite.exec(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
    VALUES (10, '2026-08', 1, 2, 110, 500, 3, 4)`);

  const saved = await json(await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 0, items: [validItem()] },
  }), { householdId: 'hh_alpha' }));
  const afterSave = sqlite.prepare(`SELECT estimated_kwh, estimated_bill, actual_kwh, actual_bill, actual_at
    FROM household_monthly_energy_records WHERE household_id = 10 AND billing_month = '2026-08'`).get();
  assert.equal(afterSave.estimated_kwh, saved.body.summary.monthlyKwh);
  assert.equal(afterSave.estimated_bill, saved.body.summary.monthlyBill);
  assert.equal(afterSave.actual_kwh, 110);
  assert.equal(afterSave.actual_bill, 500);
  assert.equal(afterSave.actual_at, 4);

  assert.equal((await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 1, items: [] },
  }), { householdId: 'hh_alpha' })).status, 200);
  assert.deepEqual({ ...sqlite.prepare(`SELECT estimated_kwh, estimated_bill, estimated_at, actual_kwh, actual_bill, actual_at
    FROM household_monthly_energy_records WHERE household_id = 10 AND billing_month = '2026-08'`).get() }, {
    estimated_kwh: null, estimated_bill: null, estimated_at: null,
    actual_kwh: 110, actual_bill: 500, actual_at: 4,
  });
});

test('a 100-item snapshot is chunked below D1 bind limits and keeps every position', async () => {
  const { api, sqlite, batchCalls } = setup();
  const items = Array.from({ length: 100 }, (_, index) => validItem(`fan-${index}`, { quantity: index % 9 + 1 }));

  const response = await api.PUT(request('/api/households/hh_alpha/home', {
    method: 'PUT', json: { expectedRevision: 0, items },
  }), { householdId: 'hh_alpha' });

  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_appliances WHERE household_id = 10').get().count, 100);
  assert.deepEqual(sqlite.prepare(`SELECT instance_key AS instanceId, position FROM household_appliances
    WHERE household_id = 10 ORDER BY position`).all().map((row) => ({ ...row })), items.map((item, position) => ({
    instanceId: item.instanceId, position,
  })));
  assert.equal(batchCalls.length, 1);
  assert.ok(batchCalls[0].every((statement) => statement.values.length <= 100));
  assert.match(batchCalls[0].at(-2).sql, /^SELECT records\.billing_month AS billingMonth/);
  assert.match(batchCalls[0].at(-1).sql, /^UPDATE households SET home_revision = home_revision \+ 1/);
});

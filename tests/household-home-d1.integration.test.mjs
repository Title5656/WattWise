import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Miniflare } from 'miniflare';

import { createHouseholdHomeService } from '../lib/server/household-home-service.ts';

const NOW = Date.parse('2026-08-15T00:00:00+07:00');
const MIGRATIONS_TO_APPLY = /^(000[0-5]|000[89]|0010)_.*\.sql$/;
const user = {
  userId: 1,
  publicId: 'usr_d1_owner',
  provider: 'cloudflare-access',
  subject: 'd1-owner-subject',
  email: 'owner@example.test',
  displayName: 'D1 Owner',
};

async function createMigratedDatabase(t) {
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: 'wattwise-home-integration',
        type: 'worker',
        compatibilityDate: '2026-08-26',
        manifest: {
          mainModule: 'index.js',
          modulesRoot: path.resolve('.'),
          modules: {
            'index.js': {
              type: 'esm',
              contents: 'export default { fetch() { return new Response("ok"); } };',
            },
          },
        },
        env: { DB: { type: 'd1', name: 'wattwise-home-integration' } },
      },
      dev: {},
    }],
  });
  t.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database('DB');
  const migrationDirectory = path.resolve('drizzle');
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => MIGRATIONS_TO_APPLY.test(name))
    .sort();
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(migrationDirectory, migrationFile), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  await db.batch([
    db.prepare(`INSERT INTO categories (id, slug, name_th, name_en, calculation_method)
      VALUES (1, 'fan', 'พัดลม', 'Fan', 'rated_power')`),
    db.prepare(`INSERT INTO brands (id, name, country_code) VALUES (1, 'Integration', 'TH')`),
    db.prepare(`INSERT INTO appliance_models
      (id, catalog_key, category_id, brand_id, model_code, display_name, calculation_method,
       rated_power_w, load_factor, usage_profile, confidence, is_active, sort_order, created_at, updated_at)
      VALUES (101, 'd1-fan', 1, 1, 'D1-FAN', 'D1 Integration Fan', 'rated_power',
        45, 0.8, 'fan', 'high', 1, 1, ?, ?)`)
      .bind(NOW, NOW),
    db.prepare(`INSERT INTO users (id, public_id, email, display_name, created_at, updated_at)
      VALUES (1, 'usr_d1_owner', 'owner@example.test', 'D1 Owner', ?, ?)`)
      .bind(NOW, NOW),
    db.prepare(`INSERT INTO households
      (id, public_id, name, home_revision, status, created_at, updated_at)
      VALUES (10, 'hh_d1_integration', 'D1 Integration Home', 0, 'active', ?, ?)`)
      .bind(NOW, NOW),
    db.prepare(`INSERT INTO household_members
      (household_id, user_id, role, created_at, updated_at)
      VALUES (10, 1, 'owner', ?, ?)`)
      .bind(NOW, NOW),
  ]);
  return db;
}

function item(index) {
  return {
    id: 'd1-fan',
    instanceId: `d1-fan-${index}`,
    quantity: index % 9 + 1,
    hoursPerDay: 4,
    cyclesPerMonth: null,
    usageSchedule: {
      kind: 'hours',
      hoursByPeriod: { night: 0, morning: 1, daytime: 1, evening: 2 },
    },
  };
}

function saveRequest(expectedRevision, items) {
  return new Request('https://wattwise.test/api/households/hh_d1_integration/home', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision, items }),
  });
}

test('real D1 migrations save 0, 1, 7, 8, and 100-item snapshots atomically', async (t) => {
  const db = await createMigratedDatabase(t);
  const service = createHouseholdHomeService({ now: () => NOW });
  let revision = 0;

  for (const count of [0, 1, 7, 8, 100]) {
    const items = Array.from({ length: count }, (_, index) => item(index));
    const result = await service.put(
      db,
      user,
      'hh_d1_integration',
      saveRequest(revision, items),
    );
    revision += 1;
    assert.equal(result.revision, revision);
    assert.equal(result.items.length, count);

    const stored = await db.prepare(`SELECT instance_key AS instanceId, position, usage_schedule AS usageSchedule
      FROM household_appliances WHERE household_id = 10 ORDER BY position`).all();
    assert.equal(stored.results.length, count);
    assert.deepEqual(stored.results.map((row) => row.position), Array.from({ length: count }, (_, index) => index));
    assert.deepEqual(stored.results.map((row) => JSON.parse(row.usageSchedule)), items.map((entry) => entry.usageSchedule));

    const monthly = await db.prepare(`SELECT estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill
      FROM household_monthly_energy_records WHERE household_id = 10`).first();
    if (count === 0) {
      assert.equal(monthly, null);
    } else {
      assert.equal(monthly.estimatedKwh, result.summary.monthlyKwh);
      assert.equal(monthly.estimatedBill, result.summary.monthlyBill);
    }
  }

  const beforeRows = await db.prepare(`SELECT instance_key AS instanceId, quantity, position
    FROM household_appliances WHERE household_id = 10 ORDER BY position`).all();
  const beforeHistory = await db.prepare(`SELECT * FROM household_monthly_energy_records
    WHERE household_id = 10 ORDER BY billing_month`).all();
  await db.prepare(`CREATE TRIGGER reject_forced_home_insert
    BEFORE INSERT ON household_appliances
    WHEN NEW.instance_key = 'force-failure'
    BEGIN SELECT RAISE(ABORT, 'forced integration failure'); END`).run();

  await assert.rejects(
    service.put(db, user, 'hh_d1_integration', saveRequest(revision, [{ ...item(0), instanceId: 'force-failure' }])),
    (error) => error?.code === 'HOME_SAVE_FAILED',
  );

  const afterRows = await db.prepare(`SELECT instance_key AS instanceId, quantity, position
    FROM household_appliances WHERE household_id = 10 ORDER BY position`).all();
  const afterHistory = await db.prepare(`SELECT * FROM household_monthly_energy_records
    WHERE household_id = 10 ORDER BY billing_month`).all();
  const household = await db.prepare('SELECT home_revision AS revision FROM households WHERE id = 10').first();
  assert.deepEqual(afterRows.results, beforeRows.results);
  assert.deepEqual(afterHistory.results, beforeHistory.results);
  assert.equal(household.revision, revision);
});

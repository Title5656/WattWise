import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { readCatalog, readCatalogModelsByKeys } from '../lib/catalog-repository.ts';
import { readSavedHomeItems } from '../lib/home-storage.ts';

const migrationTags = [
  '0000_many_scarlet_witch',
  '0001_cloudy_starfox',
  '0002_realistic_usage',
  '0003_monthly_energy_records',
  '0004_usage_schedule',
  '0005_mixed_ultimatum',
  '0006_egat_catalog_seed',
  '0007_repair_legacy_profiles',
];

function executeMigration(db, migration) {
  db.exec('BEGIN');
  try {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function d1Database(sqlite) {
  function statement(sql, values = []) {
    return {
      bind(...nextValues) {
        return statement(sql, nextValues);
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return sqlite.prepare(sql).run(...values);
      },
    };
  }
  return { prepare: (sql) => statement(sql) };
}

async function createUpgradeFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const tag of migrationTags.slice(0, 5)) {
    executeMigration(sqlite, await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO categories (id, slug, name_th, name_en, calculation_method) VALUES
      (101, 'refrigerator', 'ตู้เย็นเดิม', 'Legacy refrigerator', 'annual_energy'),
      (102, 'legacy-device', 'อุปกรณ์เดิม', 'Legacy device', 'unknown');
    INSERT INTO brands (id, name) VALUES (101, 'Legacy Fixture');
    INSERT INTO households (id, name, created_at, updated_at) VALUES (101, 'Fixture home', 1, 1);
    INSERT INTO appliance_models (
      id, category_id, brand_id, model_code, display_name, rated_power_w, annual_energy_kwh,
      source_name, confidence, created_at, updated_at
    ) VALUES
      (17, 101, 101, 'UNMATCHED-KNOWN', 'Unmatched known-category model', NULL, 420, 'Legacy import', 'low', 1, 1),
      (18, 102, 101, 'UNSUPPORTED-SAVED', 'Unsupported saved reference', NULL, NULL, NULL, 'sample', 1, 1),
      (19, 102, 101, 'UNSUPPORTED-ANNUAL', 'Unsupported annual model', NULL, 120, 'Legacy direct value', 'low', 1, 1);
    INSERT INTO household_appliances (id, household_id, appliance_model_id, created_at, updated_at) VALUES
      (31, 101, 17, 1, 1),
      (32, 101, 18, 1, 1);
    INSERT INTO saved_home_appliances (
      id, household_key, appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule, position, updated_at
    ) VALUES
      (41, 'default-home', 'legacy-17', 1, 24, NULL, NULL, 0, 1),
      (42, 'default-home', 'legacy-18', 2, 4, NULL, NULL, 1, 1);
  `);
  for (const tag of migrationTags.slice(5)) {
    executeMigration(sqlite, await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
  }
  return sqlite;
}

test('0007 is journaled after the seed and replays without changing repaired rows', async () => {
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    journal.entries.slice(0, migrationTags.length).map(({ idx, tag }) => ({ idx, tag })),
    migrationTags.map((tag, idx) => ({ idx, tag })),
  );

  const sqlite = await createUpgradeFixture();
  const before = sqlite.prepare(`SELECT id, catalog_key, calculation_method, rated_power_w, annual_energy_kwh,
    energy_per_cycle_kwh, usage_profile, source_name, confidence, is_active
    FROM appliance_models ORDER BY id`).all().map((row) => ({ ...row }));
  const migration = await readFile(new URL('../drizzle/0007_repair_legacy_profiles.sql', import.meta.url), 'utf8');
  executeMigration(sqlite, migration);
  const after = sqlite.prepare(`SELECT id, catalog_key, calculation_method, rated_power_w, annual_energy_kwh,
    energy_per_cycle_kwh, usage_profile, source_name, confidence, is_active
    FROM appliance_models ORDER BY id`).all().map((row) => ({ ...row }));

  assert.deepEqual(after, before);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('0000 to 0007 repairs unmatched rows while preserving saved references and foreign keys', async () => {
  const sqlite = await createUpgradeFixture();
  const db = d1Database(sqlite);

  assert.deepEqual(sqlite.prepare(`SELECT id, appliance_model_id AS applianceModelId
    FROM household_appliances WHERE id IN (31, 32) ORDER BY id`).all().map((row) => ({ ...row })), [
    { id: 31, applianceModelId: 17 },
    { id: 32, applianceModelId: 18 },
  ]);
  assert.deepEqual(sqlite.prepare(`SELECT id, appliance_key AS applianceKey
    FROM saved_home_appliances ORDER BY id`).all().map((row) => ({ ...row })), [
    { id: 41, applianceKey: 'legacy-17' },
    { id: 42, applianceKey: 'legacy-18' },
  ]);

  const known = sqlite.prepare(`SELECT calculation_method AS calculationMethod, annual_energy_kwh AS annualEnergyKwh,
    usage_profile AS usageProfile, is_active AS isActive FROM appliance_models WHERE id = 17`).get();
  assert.deepEqual({ ...known }, {
    calculationMethod: 'annual_energy', annualEnergyKwh: 420, usageProfile: 'refrigerator', isActive: 1,
  });
  const unsupportedSaved = sqlite.prepare(`SELECT calculation_method AS calculationMethod, rated_power_w AS ratedPowerW,
    usage_profile AS usageProfile, source_name AS sourceName, source_url AS sourceUrl,
    verified_at AS verifiedAt, confidence, is_active AS isActive FROM appliance_models WHERE id = 18`).get();
  assert.deepEqual({ ...unsupportedSaved }, {
    calculationMethod: 'rated_power', ratedPowerW: 1, usageProfile: 'fan',
    sourceName: 'WattWise legacy catalog (unverified)', sourceUrl: null, verifiedAt: null,
    confidence: 'low', isActive: 0,
  });
  const unsupportedAnnual = sqlite.prepare(`SELECT calculation_method AS calculationMethod,
    annual_energy_kwh AS annualEnergyKwh, usage_profile AS usageProfile, source_name AS sourceName,
    confidence, is_active AS isActive FROM appliance_models WHERE id = 19`).get();
  assert.deepEqual({ ...unsupportedAnnual }, {
    calculationMethod: 'annual_energy', annualEnergyKwh: 120, usageProfile: 'refrigerator',
    sourceName: 'Legacy direct value', confidence: 'low', isActive: 0,
  });

  assert.deepEqual(sqlite.prepare(`SELECT catalog_key FROM appliance_models
    WHERE usage_profile NOT IN ('inverter_ac', 'refrigerator', 'television', 'washing_machine',
      'fan', 'water_heater', 'microwave', 'rice_cooker_hours')`).all(), []);
  const publicUnsupported = await readCatalog(db, { q: 'UNSUPPORTED', category: null, page: 1, pageSize: 50 });
  assert.deepEqual(publicUnsupported.items, []);
  assert.equal(publicUnsupported.categories.some(({ slug }) => slug === 'legacy-device'), false);
  const publicKnown = await readCatalog(db, { q: 'UNMATCHED-KNOWN', category: null, page: 1, pageSize: 50 });
  assert.deepEqual(publicKnown.items.map(({ id }) => id), ['legacy-17']);

  const savedItems = await readSavedHomeItems(db);
  assert.deepEqual(savedItems.map(({ id, instanceId, energySpec, usageProfileId }) => ({ id, instanceId, energySpec, usageProfileId })), [
    { id: 'legacy-17', instanceId: 'saved-41', energySpec: { calculationMethod: 'annual_energy', annualEnergyKwh: 420 }, usageProfileId: 'refrigerator' },
    { id: 'legacy-18', instanceId: 'saved-42', energySpec: { calculationMethod: 'rated_power', ratedPowerW: 1, loadFactor: null }, usageProfileId: 'fan' },
  ]);
  const savedModels = await readCatalogModelsByKeys(db, ['legacy-17', 'legacy-18']);
  assert.equal(savedModels.length, 2);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { applianceModels } from '../db/schema.ts';

const migrationTags = [
  '0000_many_scarlet_witch',
  '0001_cloudy_starfox',
  '0002_realistic_usage',
  '0003_monthly_energy_records',
  '0004_usage_schedule',
];

function createLegacyCatalogFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE categories (id integer PRIMARY KEY AUTOINCREMENT NOT NULL);
    CREATE TABLE brands (id integer PRIMARY KEY AUTOINCREMENT NOT NULL);
    CREATE TABLE households (id integer PRIMARY KEY AUTOINCREMENT NOT NULL);
    CREATE TABLE appliance_models (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      category_id integer NOT NULL REFERENCES categories(id),
      brand_id integer NOT NULL REFERENCES brands(id),
      model_code text NOT NULL,
      display_name text NOT NULL,
      rated_power_w real,
      standby_power_w real,
      annual_energy_kwh real,
      energy_per_cycle_kwh real,
      capacity_value real,
      capacity_unit text,
      efficiency_label text,
      source_url text,
      source_name text,
      verified_at integer,
      confidence text DEFAULT 'sample' NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX idx_appliance_models_brand_model ON appliance_models (brand_id, model_code);
    CREATE INDEX idx_appliance_models_category ON appliance_models (category_id);
    CREATE TABLE household_appliances (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      household_id integer NOT NULL REFERENCES households(id) ON DELETE cascade,
      appliance_model_id integer REFERENCES appliance_models(id),
      custom_name text,
      custom_power_w real,
      room text DEFAULT 'ไม่ระบุ' NOT NULL,
      quantity integer DEFAULT 1 NOT NULL,
      hours_per_day real,
      days_per_month integer DEFAULT 30 NOT NULL,
      cycles_per_month real,
      load_factor real,
      start_minute integer,
      end_minute integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE INDEX idx_household_appliances_household ON household_appliances (household_id);
    INSERT INTO categories (id) VALUES (1);
    INSERT INTO brands (id) VALUES (1);
    INSERT INTO households (id) VALUES (1);
    INSERT INTO appliance_models (
      id, category_id, brand_id, model_code, display_name, rated_power_w, standby_power_w,
      annual_energy_kwh, energy_per_cycle_kwh, confidence, created_at, updated_at
    ) VALUES (17, 1, 1, 'RF-17', 'Legacy refrigerator', 120, 2, 420, NULL, 'high', 10, 11);
    INSERT INTO household_appliances (id, household_id, appliance_model_id, created_at, updated_at)
    VALUES (31, 1, 17, 12, 13);
  `);
  return db;
}

function executeMigrationInTransaction(db, migration) {
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

test('appliance model catalog contract uses a stable key and catalog metadata', () => {
  const columns = applianceModels;

  assert.equal(columns.catalogKey.name, 'catalog_key');
  assert.equal(columns.catalogKey.notNull, true);
  assert.equal(columns.calculationMethod.name, 'calculation_method');
  assert.equal(columns.ratedPowerW.notNull, false);
  assert.equal(columns.annualEnergyKwh.notNull, false);
  assert.equal(columns.energyPerCycleKwh.notNull, false);
  assert.equal(columns.loadFactor.name, 'load_factor');
  assert.equal(columns.usageProfile.name, 'usage_profile');
  assert.equal(columns.displayName.name, 'display_name');
  assert.equal(columns.sourceUrl.name, 'source_url');
  assert.equal(columns.sourceName.name, 'source_name');
  assert.equal(columns.isActive.name, 'is_active');
  assert.equal(columns.sortOrder.name, 'sort_order');

  const indexes = Object.values(applianceModels[Symbol.for('drizzle:ExtraConfigBuilder')](applianceModels));
  assert.deepEqual(indexes.map((item) => item.config.name).sort(), [
    'idx_appliance_models_active_category_sort',
    'idx_appliance_models_active_search',
    'idx_appliance_models_catalog_key',
  ]);
});

test('Drizzle journal and baseline register every existing migration in order', async () => {
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  const baseline = await readFile(new URL('../scripts/d1-baseline.sql', import.meta.url), 'utf8');

  assert.deepEqual(journal.entries.slice(0, migrationTags.length).map((entry) => entry.tag), migrationTags);
  assert.equal(journal.entries[5].idx, 5);
  for (const tag of migrationTags) {
    await assert.doesNotReject(readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
    assert.match(baseline, new RegExp(`'${tag}\\.sql'`));
  }
});

test('0005 migrates a referenced legacy catalog row without foreign-key violations', async () => {
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  const snapshot = JSON.parse(await readFile(new URL('../drizzle/meta/0005_snapshot.json', import.meta.url), 'utf8'));
  const priorSnapshot = JSON.parse(await readFile(new URL('../drizzle/meta/0004_snapshot.json', import.meta.url), 'utf8'));
  const entry = journal.entries[5];
  const migration = await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
  const db = createLegacyCatalogFixture();

  assert.deepEqual(entry, {
    idx: 5,
    version: '6',
    when: entry.when,
    tag: '0005_mixed_ultimatum',
    breakpoints: true,
  });
  assert.equal(snapshot.prevId, priorSnapshot.id);
  assert.ok(snapshot.tables.appliance_models.columns.catalog_key);

  executeMigrationInTransaction(db, migration);

  assert.equal(db.prepare(`
    SELECT appliance_model_id AS applianceModelId
    FROM household_appliances
    WHERE id = 31
  `).get().applianceModelId, 17);
  const migratedModel = db.prepare(`
    SELECT id, catalog_key AS catalogKey, calculation_method AS calculationMethod,
      rated_power_w AS ratedPowerW, annual_energy_kwh AS annualEnergyKwh
    FROM appliance_models
    WHERE id = 17
  `).get();
  assert.equal(migratedModel.id, 17);
  assert.equal(migratedModel.catalogKey, 'legacy-17');
  assert.equal(migratedModel.calculationMethod, 'annual_energy');
  assert.equal(migratedModel.ratedPowerW, 120);
  assert.equal(migratedModel.annualEnergyKwh, 420);
  assert.deepEqual(db.prepare("SELECT name FROM pragma_index_list('appliance_models') ORDER BY name").all().map(({ name }) => name), [
    'idx_appliance_models_active_category_sort',
    'idx_appliance_models_active_search',
    'idx_appliance_models_catalog_key',
  ]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

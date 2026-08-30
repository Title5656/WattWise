import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { applianceModels } from '../db/schema.ts';

const migrationTags = [
  '0000_many_scarlet_witch',
  '0001_cloudy_starfox',
  '0002_realistic_usage',
  '0003_monthly_energy_records',
  '0004_usage_schedule',
];

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

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationTag = '0006_egat_catalog_seed';
const migrationFiles = [
  '0000_many_scarlet_witch',
  '0001_cloudy_starfox',
  '0002_realistic_usage',
  '0003_monthly_energy_records',
  '0004_usage_schedule',
  '0005_mixed_ultimatum',
  migrationTag,
];
const verifiedAt = Math.floor(Date.parse('2026-08-30T00:00:00+07:00') / 1000);
const legacyKeys = [
  'ac-daikin-ftkd18',
  'ac-mitsubishi-ky13',
  'fridge-samsung-rt35',
  'fridge-lg-gnb392',
  'tv-lg-ut80-55',
  'tv-sony-bravia3-55',
  'washer-electrolux-9',
  'washer-samsung-9',
  'fan-hatari-s16m7',
  'fan-xiaomi-smart2',
  'heater-stiebel-xg45',
  'microwave-toshiba-sm20',
  'rice-sharp-com18',
];
const officialSources = new Map([
  ['air-conditioner', 'https://labelno5.egat.co.th/home/stamp/index1.php?tname=air'],
  ['refrigerator', 'https://labelno5.egat.co.th/home/stamp/index1.php?tname=ref'],
  ['washing-machine', 'https://labelno5.egat.co.th/home/stamp/index1.php?tname=washer'],
  ['water-heater', 'https://labelno5.egat.co.th/home/stamp/index1.php?tname=heat'],
  ['rice-cooker', 'https://labelno5.egat.co.th/home/stamp/index1.php?tname=cook'],
]);

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

async function createSeededDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const tag of migrationFiles) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8');
    executeMigration(db, migration);
  }
  return db;
}

function createPre0005LegacyFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE categories (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      slug text NOT NULL UNIQUE,
      name_th text NOT NULL,
      name_en text NOT NULL,
      calculation_method text NOT NULL
    );
    CREATE TABLE brands (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL UNIQUE,
      country_code text
    );
    CREATE TABLE households (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      province text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
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
    INSERT INTO categories (id, slug, name_th, name_en, calculation_method)
    VALUES (1, 'air-conditioner', 'เครื่องปรับอากาศ', 'Air conditioner', 'variable_load');
    INSERT INTO brands (id, name) VALUES (1, 'Daikin');
    INSERT INTO households (id, name, created_at, updated_at) VALUES (1, 'Home', 1, 1);
    INSERT INTO appliance_models (
      id, category_id, brand_id, model_code, display_name, rated_power_w, confidence, created_at, updated_at
    ) VALUES (17, 1, 1, 'FTKD18ZV2S', 'Existing Daikin', 1540, 'sample', 1, 1);
    INSERT INTO household_appliances (id, household_id, appliance_model_id, created_at, updated_at)
    VALUES (31, 1, 17, 1, 1);
  `);
  return db;
}

test('seed migration is journaled and creates the accepted active catalog snapshot', async () => {
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  const db = await createSeededDatabase();
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      COUNT(DISTINCT catalog_key) AS uniqueKeys,
      SUM(CASE WHEN catalog_key LIKE 'egat-%' THEN 1 ELSE 0 END) AS egatRows
    FROM appliance_models
    WHERE is_active = 1
  `).get();

  assert.equal(journal.entries.at(-1).tag, migrationTag);
  assert.equal(journal.entries.at(-1).idx, 6);
  assert.ok(counts.total >= 300 && counts.total <= 500, `active count ${counts.total}`);
  assert.ok(counts.total >= 350 && counts.total <= 380, `preferred active count ${counts.total}`);
  assert.equal(counts.uniqueKeys, counts.total);
  assert.equal(counts.egatRows, counts.total - legacyKeys.length);
});

test('seed preserves every legacy key and enforces energy-spec invariants', async () => {
  const db = await createSeededDatabase();
  const actualLegacyKeys = db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE catalog_key NOT LIKE 'egat-%'
    ORDER BY catalog_key
  `).all().map(({ catalogKey }) => catalogKey);
  const invalidSpecs = db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE is_active = 1 AND NOT (
      (calculation_method = 'rated_power' AND rated_power_w > 0
        AND annual_energy_kwh IS NULL AND energy_per_cycle_kwh IS NULL)
      OR
      (calculation_method = 'annual_energy' AND annual_energy_kwh > 0
        AND rated_power_w IS NULL AND energy_per_cycle_kwh IS NULL)
      OR
      (calculation_method = 'per_cycle' AND energy_per_cycle_kwh > 0
        AND rated_power_w IS NULL AND annual_energy_kwh IS NULL)
    )
  `).all();

  assert.deepEqual(actualLegacyKeys, legacyKeys.toSorted());
  assert.deepEqual(invalidSpecs, []);
  assert.deepEqual(db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE is_active = 1 AND (
      calculation_method NOT IN ('rated_power', 'annual_energy', 'per_cycle')
      OR model_code = '' OR display_name = '' OR usage_profile IS NULL
      OR category_id IS NULL OR brand_id IS NULL
    )
  `).all(), []);
});

test('EGAT rows use exact direct values and permitted conversion formulas', async () => {
  const db = await createSeededDatabase();
  const ac = db.prepare(`
    SELECT rated_power_w AS watts, capacity_value AS btu, capacity_unit AS unit
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-ac-%' AND b.name = 'CARRIER'
      AND m.model_code = '42CVFA010/38CVFA010'
  `).get();
  const refrigerator = db.prepare(`
    SELECT annual_energy_kwh AS annual, capacity_value AS capacity, capacity_unit AS unit
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-ref-%' AND b.name = 'ACONATIC' AND m.model_code = 'AN-FR112'
  `).get();
  const washer = db.prepare(`
    SELECT energy_per_cycle_kwh AS cycle, capacity_value AS capacity, capacity_unit AS unit
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-washer-%' AND b.name = 'BEKO' AND m.model_code = 'WTLJI10C1WT'
  `).get();
  const heater = db.prepare(`
    SELECT rated_power_w AS watts
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-heat-%' AND b.name = 'ALPHA' AND m.model_code = 'EVO-4500E'
  `).get();
  const cooker = db.prepare(`
    SELECT rated_power_w AS watts, capacity_value AS capacity, capacity_unit AS unit
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-cook-%' AND b.name = 'ELECTROLUX' AND m.model_code = 'E5RC1-600P'
  `).get();

  assert.ok(ac);
  assert.equal(ac.watts, 9200 / 19);
  assert.equal(ac.btu, 9200);
  assert.equal(ac.unit, 'BTU/h');
  assert.equal(refrigerator.annual, 347);
  assert.equal(refrigerator.capacity, 112);
  assert.equal(refrigerator.unit, 'L');
  assert.equal(washer.cycle, 0.1164);
  assert.equal(washer.capacity, 10);
  assert.equal(washer.unit, 'kg');
  assert.equal(heater.watts, 4373);
  assert.equal(cooker.watts, 860);
  assert.equal(cooker.capacity, 1.4);
  assert.equal(cooker.unit, 'L');
});

test('seed removes identical specs but retains same-model energy variants', async () => {
  const db = await createSeededDatabase();
  const duplicateSpecs = db.prepare(`
    SELECT category_id, brand_id, model_code
    FROM appliance_models
    WHERE catalog_key LIKE 'egat-%'
    GROUP BY category_id, brand_id, model_code, calculation_method,
      rated_power_w, annual_energy_kwh, energy_per_cycle_kwh,
      capacity_value, capacity_unit, efficiency_label
    HAVING COUNT(*) > 1
  `).all();
  const retainedVariants = db.prepare(`
    SELECT rated_power_w AS watts
    FROM appliance_models m JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-heat-%' AND b.name = 'ALPHA' AND m.model_code = 'EVO-EM'
    ORDER BY rated_power_w
  `).all().map(({ watts }) => watts);

  assert.deepEqual(duplicateSpecs, []);
  assert.deepEqual(retainedVariants, [5839, 8031]);
});

test('EGAT provenance, category caps, AC eligibility, and fingerprints are intact', async () => {
  const db = await createSeededDatabase();
  const categoryCounts = db.prepare(`
    SELECT c.slug, COUNT(*) AS count
    FROM appliance_models m JOIN categories c ON c.id = m.category_id
    WHERE m.catalog_key LIKE 'egat-%'
    GROUP BY c.slug ORDER BY c.slug
  `).all();

  assert.ok(categoryCounts.length === officialSources.size);
  for (const row of categoryCounts) assert.ok(row.count <= 80, `${row.slug}: ${row.count}`);
  assert.deepEqual(db.prepare(`
    SELECT m.catalog_key AS catalogKey
    FROM appliance_models m JOIN categories c ON c.id = m.category_id
    WHERE m.catalog_key LIKE 'egat-%' AND (
      m.source_name != 'EGAT Label No.5'
      OR m.source_url != CASE c.slug
        WHEN 'air-conditioner' THEN '${officialSources.get('air-conditioner')}'
        WHEN 'refrigerator' THEN '${officialSources.get('refrigerator')}'
        WHEN 'washing-machine' THEN '${officialSources.get('washing-machine')}'
        WHEN 'water-heater' THEN '${officialSources.get('water-heater')}'
        WHEN 'rice-cooker' THEN '${officialSources.get('rice-cooker')}'
      END
      OR m.verified_at != ${verifiedAt}
      OR m.confidence != 'high'
    )
  `).all(), []);
  assert.deepEqual(db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE catalog_key LIKE 'egat-ac-%'
      AND (usage_profile != 'inverter_ac' OR display_name NOT LIKE '%WALL TYPE%INVERTER%')
  `).all(), []);
  assert.deepEqual(db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-%' AND catalog_key NOT GLOB 'egat-*-????????????'
  `).all(), []);
});

test('seed is idempotent and safe after 0005 backfilled a referenced legacy model', async () => {
  const seed = await readFile(new URL(`../drizzle/${migrationTag}.sql`, import.meta.url), 'utf8');
  const db = await createSeededDatabase();
  const before = db.prepare('SELECT COUNT(*) AS count FROM appliance_models').get().count;
  executeMigration(db, seed);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM appliance_models').get().count, before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const populated = createPre0005LegacyFixture();
  const migration0005 = await readFile(new URL('../drizzle/0005_mixed_ultimatum.sql', import.meta.url), 'utf8');
  executeMigration(populated, migration0005);
  executeMigration(populated, seed);
  const retained = populated.prepare(`
    SELECT h.appliance_model_id AS id, m.catalog_key AS catalogKey
    FROM household_appliances h JOIN appliance_models m ON m.id = h.appliance_model_id
    WHERE h.id = 31
  `).get();
  assert.equal(retained.id, 17);
  assert.equal(retained.catalogKey, 'ac-daikin-ftkd18');
  assert.equal(populated.prepare(`
    SELECT COUNT(*) AS count FROM appliance_models
    WHERE catalog_key = 'ac-daikin-ftkd18'
  `).get().count, 1);
  assert.deepEqual(populated.prepare('PRAGMA foreign_key_check').all(), []);
});

test('runtime code has no EGAT fetch or scraper', async () => {
  const roots = ['app', 'components', 'db', 'lib', 'scripts'];
  const files = [];
  async function walk(relativePath) {
    for (const entry of await readdir(new URL(`../${relativePath}/`, import.meta.url), { withFileTypes: true })) {
      const child = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else files.push(child);
    }
  }
  for (const root of roots) await walk(root);

  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /labelno5\.egat\.co\.th|index1\.php\?tname=/i, file);
  }
});

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
const expectedEgatCategoryCounts = {
  'air-conditioner': 80,
  refrigerator: 80,
  'rice-cooker': 41,
  'washing-machine': 80,
  'water-heater': 80,
};

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

function findInvalidEnergySpecs(db) {
  return db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE is_active = 1 AND (
      calculation_method IS NULL
      OR calculation_method NOT IN ('rated_power', 'annual_energy', 'per_cycle')
      OR (calculation_method = 'rated_power' AND (
        rated_power_w IS NULL OR rated_power_w <= 0
        OR annual_energy_kwh IS NOT NULL OR energy_per_cycle_kwh IS NOT NULL
      ))
      OR (calculation_method = 'annual_energy' AND (
        annual_energy_kwh IS NULL OR annual_energy_kwh <= 0
        OR rated_power_w IS NOT NULL OR energy_per_cycle_kwh IS NOT NULL
      ))
      OR (calculation_method = 'per_cycle' AND (
        energy_per_cycle_kwh IS NULL OR energy_per_cycle_kwh <= 0
        OR rated_power_w IS NOT NULL OR annual_energy_kwh IS NOT NULL
      ))
    )
    ORDER BY catalog_key
  `).all().map(({ catalogKey }) => catalogKey);
}

function getEgatCategoryCounts(db) {
  return Object.fromEntries(db.prepare(`
    SELECT c.slug, COUNT(*) AS count
    FROM appliance_models m JOIN categories c ON c.id = m.category_id
    WHERE m.catalog_key LIKE 'egat-%'
    GROUP BY c.slug ORDER BY c.slug
  `).all().map(({ slug, count }) => [slug, count]));
}

function findInvalidEgatProvenance(db) {
  return db.prepare(`
    SELECT m.catalog_key AS catalogKey
    FROM appliance_models m JOIN categories c ON c.id = m.category_id
    WHERE m.catalog_key LIKE 'egat-%' AND (
      c.slug NOT IN ('air-conditioner', 'refrigerator', 'washing-machine', 'water-heater', 'rice-cooker')
      OR m.source_name IS NULL OR m.source_name != 'EGAT Label No.5'
      OR m.source_url IS NULL OR m.source_url != CASE c.slug
        WHEN 'air-conditioner' THEN '${officialSources.get('air-conditioner')}'
        WHEN 'refrigerator' THEN '${officialSources.get('refrigerator')}'
        WHEN 'washing-machine' THEN '${officialSources.get('washing-machine')}'
        WHEN 'water-heater' THEN '${officialSources.get('water-heater')}'
        WHEN 'rice-cooker' THEN '${officialSources.get('rice-cooker')}'
      END
      OR m.verified_at IS NULL OR m.verified_at != ${verifiedAt}
      OR m.confidence IS NULL OR m.confidence != 'high'
    )
    ORDER BY m.catalog_key
  `).all().map(({ catalogKey }) => catalogKey);
}

function splitSqlValues(source) {
  const values = [];
  let start = 0;
  let depth = 0;
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'") {
      if (quoted && source[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && char === '(') {
      depth += 1;
    } else if (!quoted && char === ')') {
      depth -= 1;
    } else if (!quoted && depth === 0 && char === ',') {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(source.slice(start).trim());
  return values;
}

function unquoteSqlString(value) {
  assert.match(value, /^'(?:[^']|'')*'$/);
  return value.slice(1, -1).replaceAll("''", "'");
}

function parseImportedSeedRows(migration) {
  return migration.split(/\r?\n/)
    .filter((line) => line.startsWith('INSERT INTO appliance_models') && line.includes("VALUES ('egat-"))
    .map((line) => {
      const valuesStart = line.indexOf(' VALUES (') + ' VALUES ('.length;
      const valuesEnd = line.indexOf(') ON CONFLICT(catalog_key)');
      const values = splitSqlValues(line.slice(valuesStart, valuesEnd));
      assert.equal(values.length, 23);
      return {
        key: unquoteSqlString(values[0]),
        ratedPowerExpression: values[6],
        annualEnergyExpression: values[8],
        perCycleExpression: values[9],
        capacityExpression: values[12],
      };
    });
}

function fingerprintForEgatRow(row) {
  const canonical = [
    'egat-spec-v1',
    row.slug,
    row.brand,
    row.modelCode,
    row.calculationMethod,
    row.ratedPowerW == null ? '' : String(row.ratedPowerW),
    row.annualEnergyKwh == null ? '' : String(row.annualEnergyKwh),
    row.energyPerCycleKwh == null ? '' : String(row.energyPerCycleKwh),
    row.capacityValue == null ? '' : String(row.capacityValue),
    row.capacityUnit ?? '',
    row.efficiencyLabel ?? '',
  ].join('\u001f');
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(canonical, 'utf8')) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(-12);
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

  assert.deepEqual(actualLegacyKeys, legacyKeys.toSorted());
  assert.deepEqual(findInvalidEnergySpecs(db), []);
  assert.deepEqual(db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE is_active = 1 AND (
      calculation_method NOT IN ('rated_power', 'annual_energy', 'per_cycle')
      OR model_code = '' OR display_name = '' OR usage_profile IS NULL
      OR category_id IS NULL OR brand_id IS NULL
    )
  `).all(), []);

  const requiredEnergyColumns = new Map([
    ['rated_power', 'rated_power_w'],
    ['annual_energy', 'annual_energy_kwh'],
    ['per_cycle', 'energy_per_cycle_kwh'],
  ]);
  const expectedInvalidKeys = [];
  for (const [method, column] of requiredEnergyColumns) {
    const rows = db.prepare(`
      SELECT catalog_key AS catalogKey
      FROM appliance_models
      WHERE calculation_method = ? AND catalog_key LIKE 'egat-%'
      ORDER BY catalog_key LIMIT 2
    `).all(method);
    assert.equal(rows.length, 2);
    db.prepare(`UPDATE appliance_models SET ${column} = NULL WHERE catalog_key = ?`).run(rows[0].catalogKey);
    db.prepare(`UPDATE appliance_models SET ${column} = 0 WHERE catalog_key = ?`).run(rows[1].catalogKey);
    expectedInvalidKeys.push(rows[0].catalogKey, rows[1].catalogKey);
  }
  assert.deepEqual(findInvalidEnergySpecs(db), expectedInvalidKeys.toSorted());
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

test('every imported AC and washer keeps its literal permitted conversion expression', async () => {
  const migration = await readFile(new URL(`../drizzle/${migrationTag}.sql`, import.meta.url), 'utf8');
  const db = await createSeededDatabase();
  const actualByKey = new Map(db.prepare(`
    SELECT catalog_key AS catalogKey, rated_power_w AS ratedPowerW,
      annual_energy_kwh AS annualEnergyKwh, energy_per_cycle_kwh AS energyPerCycleKwh,
      capacity_value AS capacityValue
    FROM appliance_models
    WHERE catalog_key LIKE 'egat-%'
  `).all().map((row) => [row.catalogKey, row]));
  const importedRows = parseImportedSeedRows(migration);
  const acRows = importedRows.filter(({ key }) => key.startsWith('egat-ac-'));
  const washerRows = importedRows.filter(({ key }) => key.startsWith('egat-washer-'));

  assert.equal(acRows.length, 80);
  assert.equal(washerRows.length, 80);
  for (const row of acRows) {
    const formula = /^\((\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)\)$/.exec(row.ratedPowerExpression);
    assert.ok(formula, `${row.key}: ${row.ratedPowerExpression}`);
    const btuPerHour = Number(formula[1]);
    const eer = Number(formula[2]);
    assert.ok(btuPerHour > 0 && eer > 0, row.key);
    assert.equal(Number(row.capacityExpression), btuPerHour, row.key);
    assert.equal(row.annualEnergyExpression, 'NULL', row.key);
    assert.equal(row.perCycleExpression, 'NULL', row.key);
    assert.equal(actualByKey.get(row.key).ratedPowerW, btuPerHour / eer, row.key);
    assert.equal(actualByKey.get(row.key).capacityValue, btuPerHour, row.key);
  }
  for (const row of washerRows) {
    const formula = /^\((\d+(?:\.\d+)?) \* (\d+(?:\.\d+)?) \/ 1000\.0\)$/.exec(row.perCycleExpression);
    assert.ok(formula, `${row.key}: ${row.perCycleExpression}`);
    const wattHoursPerKg = Number(formula[1]);
    const capacityKg = Number(formula[2]);
    assert.ok(wattHoursPerKg > 0 && capacityKg > 0, row.key);
    assert.equal(Number(row.capacityExpression), capacityKg, row.key);
    assert.equal(row.ratedPowerExpression, 'NULL', row.key);
    assert.equal(row.annualEnergyExpression, 'NULL', row.key);
    assert.equal(actualByKey.get(row.key).energyPerCycleKwh, wattHoursPerKg * capacityKg / 1000, row.key);
    assert.equal(actualByKey.get(row.key).capacityValue, capacityKg, row.key);
  }
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

test('EGAT provenance, exact category counts, and AC eligibility are intact', async () => {
  const db = await createSeededDatabase();
  assert.deepEqual(getEgatCategoryCounts(db), expectedEgatCategoryCounts);
  assert.deepEqual(findInvalidEgatProvenance(db), []);
  assert.deepEqual(db.prepare(`
    SELECT catalog_key AS catalogKey
    FROM appliance_models
    WHERE catalog_key LIKE 'egat-ac-%'
      AND (usage_profile != 'inverter_ac' OR display_name NOT LIKE '%WALL TYPE%INVERTER%')
  `).all(), []);

  const nullSourceKey = db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-ref-%' ORDER BY catalog_key LIMIT 1
  `).get().catalogKey;
  const unexpectedCategoryKey = db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-ac-%' ORDER BY catalog_key LIMIT 1
  `).get().catalogKey;
  const nullSourceNameKey = db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-ref-%' ORDER BY catalog_key LIMIT 1 OFFSET 1
  `).get().catalogKey;
  const nullVerifiedAtKey = db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-washer-%' ORDER BY catalog_key LIMIT 1
  `).get().catalogKey;
  const wrongConfidenceKey = db.prepare(`
    SELECT catalog_key AS catalogKey FROM appliance_models
    WHERE catalog_key LIKE 'egat-heat-%' ORDER BY catalog_key LIMIT 1
  `).get().catalogKey;
  db.prepare('UPDATE appliance_models SET source_url = NULL WHERE catalog_key = ?').run(nullSourceKey);
  db.prepare('UPDATE appliance_models SET source_name = NULL WHERE catalog_key = ?').run(nullSourceNameKey);
  db.prepare('UPDATE appliance_models SET verified_at = NULL WHERE catalog_key = ?').run(nullVerifiedAtKey);
  db.prepare("UPDATE appliance_models SET confidence = 'medium' WHERE catalog_key = ?").run(wrongConfidenceKey);
  db.prepare(`
    UPDATE appliance_models
    SET category_id = (SELECT id FROM categories WHERE slug = 'television')
    WHERE catalog_key = ?
  `).run(unexpectedCategoryKey);

  assert.deepEqual(findInvalidEgatProvenance(db), [
    nullSourceKey,
    nullSourceNameKey,
    nullVerifiedAtKey,
    unexpectedCategoryKey,
    wrongConfidenceKey,
  ].toSorted());
  assert.throws(() => assert.deepEqual(getEgatCategoryCounts(db), expectedEgatCategoryCounts));
});

test('every EGAT key fingerprint recomputes from canonical direct fields', async () => {
  const db = await createSeededDatabase();
  const rows = db.prepare(`
    SELECT m.catalog_key AS catalogKey, c.slug, b.name AS brand,
      m.model_code AS modelCode, m.calculation_method AS calculationMethod,
      m.rated_power_w AS ratedPowerW, m.annual_energy_kwh AS annualEnergyKwh,
      m.energy_per_cycle_kwh AS energyPerCycleKwh, m.capacity_value AS capacityValue,
      m.capacity_unit AS capacityUnit, m.efficiency_label AS efficiencyLabel
    FROM appliance_models m
    JOIN categories c ON c.id = m.category_id
    JOIN brands b ON b.id = m.brand_id
    WHERE m.catalog_key LIKE 'egat-%'
    ORDER BY m.catalog_key
  `).all();

  assert.equal(rows.length, 361);
  for (const row of rows) {
    const match = /-([0-9a-f]{12})$/.exec(row.catalogKey);
    assert.ok(match, row.catalogKey);
    assert.equal(match[1], fingerprintForEgatRow(row), row.catalogKey);
  }
});

test('seed is idempotent and safe after 0005 backfilled a referenced legacy model', async () => {
  const seed = await readFile(new URL(`../drizzle/${migrationTag}.sql`, import.meta.url), 'utf8');
  const db = await createSeededDatabase();
  const before = db.prepare('SELECT COUNT(*) AS count FROM appliance_models').get().count;
  executeMigration(db, seed);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM appliance_models').get().count, before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const priorFingerprintRekey = /UPDATE appliance_models SET catalog_key = '(egat-[^']+)' WHERE catalog_key = '(egat-[^']+)'/.exec(seed);
  assert.ok(priorFingerprintRekey);
  const [, revisedKey, priorKey] = priorFingerprintRekey;
  const retainedImportedId = db.prepare('SELECT id FROM appliance_models WHERE catalog_key = ?').get(revisedKey).id;
  db.prepare('UPDATE appliance_models SET catalog_key = ? WHERE id = ?').run(priorKey, retainedImportedId);
  executeMigration(db, seed);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM appliance_models').get().count, before);
  assert.equal(db.prepare('SELECT catalog_key AS catalogKey FROM appliance_models WHERE id = ?').get(retainedImportedId).catalogKey, revisedKey);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM appliance_models WHERE catalog_key = ?').get(priorKey).count, 0);

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

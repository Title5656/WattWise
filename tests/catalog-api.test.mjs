import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const catalogApi = await import('../lib/catalog-api.ts').catch(() => ({}));

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const queries = [];
  sqlite.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL,
      name_th TEXT NOT NULL,
      name_en TEXT NOT NULL
    );
    CREATE TABLE brands (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE appliance_models (
      id INTEGER PRIMARY KEY,
      catalog_key TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      model_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      calculation_method TEXT,
      rated_power_w REAL,
      annual_energy_kwh REAL,
      energy_per_cycle_kwh REAL,
      load_factor REAL,
      usage_profile TEXT,
      capacity_value REAL,
      capacity_unit TEXT,
      efficiency_label TEXT,
      source_url TEXT,
      source_name TEXT,
      verified_at INTEGER,
      confidence TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
    INSERT INTO categories VALUES
      (1, 'refrigerator', 'ตู้เย็น', 'Refrigerator'),
      (2, 'fan', 'พัดลม', 'Fan'),
      (3, 'water-heater', 'เครื่องทำน้ำอุ่น', 'Water heater');
    INSERT INTO brands VALUES (1, 'alpha'), (2, 'Bravo'), (3, 'charlie');
  `);
  const insert = sqlite.prepare(`INSERT INTO appliance_models VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rows = [
    [1, 'fan-alpha-a', 2, 1, 'A-100', 'Alpha Fan', 'rated_power', 45, null, null, null, 'fan', 16, 'in', '5', 'https://example.test/fan-a', 'EGAT', 100, 'high', 1, 1],
    [2, 'fan-alpha-wild', 2, 1, 'A%_\\', 'Alpha literal % _ \\', 'rated_power', 46, null, null, null, 'fan', 16, 'in', '5', 'https://example.test/fan-wild', 'EGAT', 100, 'high', 1, 2],
    [3, 'fan-bravo-a', 2, 2, 'A-101', 'Bravo Fan', 'rated_power', 50, null, null, null, 'fan', 16, 'in', '4', 'https://example.test/fan-b', 'EGAT', 100, 'high', 1, 2],
    [4, 'fan-charlie-a', 2, 3, 'A-102', 'Charlie Fan', 'rated_power', 55, null, null, null, 'fan', 16, 'in', '4', 'https://example.test/fan-c', 'EGAT', 100, 'high', 1, 3],
    [5, 'fridge-bravo-a', 1, 2, 'REF-1', 'Bravo Refrigerator', 'annual_energy', null, 365, null, null, 'refrigerator', 12, 'cu ft', '5', 'https://example.test/fridge', 'EGAT', 101, 'high', 1, 1],
    [6, 'heater-charlie-a', 3, 3, 'H-1', 'Charlie Heater', 'per_cycle', null, null, 1.25, null, 'water_heater', null, null, '5', 'https://example.test/heater', 'EGAT', 102, 'high', 1, 1],
    [7, 'fan-inactive', 2, 1, 'OLD', 'Inactive Fan', 'rated_power', 40, null, null, null, 'fan', null, null, null, null, null, null, 'sample', 0, 0],
  ];
  for (const row of rows) insert.run(...row);

  return {
    queries,
    execute(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      return {
        bind(...values) {
          queries.push({ sql, values });
          return {
            async all() {
              return { results: sqlite.prepare(sql).all(...values) };
            },
          };
        },
      };
    },
  };
}

function request(query = '') {
  return new Request(`https://wattwise.test/api/catalog${query}`);
}

async function response(query = '', db = createDatabase()) {
  const handler = catalogApi.createCatalogGetHandler?.(() => db);
  assert.equal(typeof handler, 'function', 'catalog GET handler is exported');
  const result = await handler(request(query));
  return { status: result.status, body: await result.json() };
}

async function expectCatalogServerError(db, expectedLog) {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const result = await response('', db);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'ไม่สามารถโหลดแคตตาล็อกได้' });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'Unable to read catalog');
  assert.match(String(logs[0][1]), expectedLog);
}

test('catalog defaults to the first 24 active records and returns active category metadata', async () => {
  const { status, body } = await response();

  assert.equal(status, 200);
  assert.deepEqual(body.items.map((item) => item.id), [
    'fridge-bravo-a', 'fan-alpha-a', 'heater-charlie-a', 'fan-alpha-wild', 'fan-bravo-a', 'fan-charlie-a',
  ]);
  assert.deepEqual(body.pagination, { page: 1, pageSize: 24, total: 6, totalPages: 1, hasMore: false });
  assert.deepEqual(body.categories.map((category) => [category.slug, category.name, category.count, category.image]), [
    ['refrigerator', 'ตู้เย็น', 1, '/products/samsung-rt35cg5544b1sv.png'],
    ['fan', 'พัดลม', 4, '/products/hatari-ht-s16m7.jpg'],
    ['water-heater', 'เครื่องทำน้ำอุ่น', 1, '/products/stiebel-xg45ec.jpg'],
  ]);
});

test('catalog searches case-insensitively across brand, model, display name, and detail fields', async () => {
  const byBrand = await response('?q=BRAVO');
  const byModel = await response('?q=ref-1');
  const byDetail = await response('?q=cu%20ft');

  assert.deepEqual(byBrand.body.items.map((item) => item.id), ['fridge-bravo-a', 'fan-bravo-a']);
  assert.deepEqual(byModel.body.items.map((item) => item.id), ['fridge-bravo-a']);
  assert.deepEqual(byDetail.body.items.map((item) => item.id), ['fridge-bravo-a']);
});

test('catalog treats percent, underscore, and backslash query characters literally', async () => {
  const db = createDatabase();
  const query = '%_\\';
  const { body } = await response(`?q=${encodeURIComponent(query)}`, db);

  assert.deepEqual(body.items.map((item) => item.id), ['fan-alpha-wild']);
  const searchQueries = db.queries.filter(({ sql }) => sql.includes('COUNT(*) AS total') || sql.includes('ORDER BY m.sort_order'));
  assert.equal(searchQueries.length, 2);
  for (const prepared of searchQueries) {
    assert.doesNotMatch(prepared.sql, /\bLIKE\b|\bESCAPE\b/i);
    assert.deepEqual(prepared.values.slice(0, 4), [query, query, query, query]);
  }
});

test('catalog accepts the full 100-character query contract for ASCII and multibyte Thai text', async () => {
  const ascii = 'x'.repeat(100);
  const thai = 'ก'.repeat(100);
  const db = createDatabase();
  db.execute(`UPDATE appliance_models SET display_name = '${ascii}' WHERE catalog_key = 'fan-alpha-a'`);
  db.execute(`UPDATE appliance_models SET display_name = '${thai}' WHERE catalog_key = 'fan-bravo-a'`);

  const asciiResult = await response(`?q=${ascii}`, db);
  const thaiResult = await response(`?q=${encodeURIComponent(thai)}`, db);

  assert.equal(asciiResult.status, 200);
  assert.deepEqual(asciiResult.body.items.map((item) => item.id), ['fan-alpha-a']);
  assert.equal(thaiResult.status, 200);
  assert.deepEqual(thaiResult.body.items.map((item) => item.id), ['fan-bravo-a']);
  const searchQueries = db.queries.filter(({ sql }) => sql.includes('COUNT(*) AS total') || sql.includes('ORDER BY m.sort_order'));
  assert.equal(searchQueries.length, 4);
  for (const prepared of searchQueries) assert.doesNotMatch(prepared.sql, /\bLIKE\b|\bESCAPE\b/i);
  assert.equal(searchQueries.filter(({ values }) => values[0] === ascii).length, 2);
  assert.equal(searchQueries.filter(({ values }) => values[0] === thai).length, 2);
});

test('catalog applies an exact category slug and leaves metadata available for an unknown category', async () => {
  const selected = await response('?category=fan');
  const unknown = await response('?category=unknown');

  assert.deepEqual(selected.body.items.map((item) => item.id), ['fan-alpha-a', 'fan-alpha-wild', 'fan-bravo-a', 'fan-charlie-a']);
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body.items, []);
  assert.deepEqual(unknown.body.pagination, { page: 1, pageSize: 24, total: 0, totalPages: 0, hasMore: false });
  assert.equal(unknown.body.categories.length, 3);
});

test('catalog validates pagination and query bounds', async () => {
  for (const query of ['?page=0', '?page=1.5', '?page=two', '?pageSize=0', '?pageSize=1.5', '?pageSize=51']) {
    const { status } = await response(query);
    assert.equal(status, 400, query);
  }
  assert.equal((await response(`?q=${'x'.repeat(101)}`)).status, 400);
  assert.equal((await response('?q=%20%20')).status, 200);
});

test('catalog stable paging has no duplicates and caps requested page size', async () => {
  const first = await response('?page=1&pageSize=2');
  const second = await response('?page=2&pageSize=2');
  const capped = await response('?pageSize=50');

  assert.deepEqual(first.body.items.map((item) => item.id), ['fridge-bravo-a', 'fan-alpha-a']);
  assert.deepEqual(second.body.items.map((item) => item.id), ['heater-charlie-a', 'fan-alpha-wild']);
  assert.deepEqual(new Set([...first.body.items, ...second.body.items].map((item) => item.id)).size, 4);
  assert.equal(capped.body.pagination.pageSize, 50);
});

test('catalog maps nullable energy columns to honest energy specs and surface source metadata', async () => {
  const { body } = await response('?pageSize=50');
  const byId = new Map(body.items.map((item) => [item.id, item]));

  assert.deepEqual(byId.get('fan-alpha-a').energySpec, { calculationMethod: 'rated_power', ratedPowerW: 45, loadFactor: null });
  assert.deepEqual(byId.get('fridge-bravo-a').energySpec, { calculationMethod: 'annual_energy', annualEnergyKwh: 365 });
  assert.deepEqual(byId.get('heater-charlie-a').energySpec, { calculationMethod: 'per_cycle', energyPerCycleKwh: 1.25 });
  assert.equal(byId.get('fridge-bravo-a').watts, null);
  assert.deepEqual(byId.get('fridge-bravo-a').source, { name: 'EGAT', url: 'https://example.test/fridge', verifiedAt: 101, confidence: 'high' });
});

test('catalog rejects null and unknown usage profiles instead of inventing one', async () => {
  for (const statement of [
    "UPDATE appliance_models SET usage_profile = NULL WHERE catalog_key = 'fan-alpha-a'",
    "UPDATE appliance_models SET usage_profile = 'unknown_profile' WHERE catalog_key = 'fan-alpha-a'",
  ]) {
    const db = createDatabase();
    db.execute(statement);
    await expectCatalogServerError(db, /usage_profile/);
  }
});

test('catalog rejects unknown and null calculation method discriminators', async () => {
  for (const statement of [
    "UPDATE appliance_models SET calculation_method = 'unexpected' WHERE catalog_key = 'fan-alpha-a'",
    "UPDATE appliance_models SET calculation_method = NULL WHERE catalog_key = 'fan-alpha-a'",
  ]) {
    const db = createDatabase();
    db.execute(statement);
    await expectCatalogServerError(db, /calculation_method/);
  }
});

test('catalog reports an unavailable D1 binding as a server error', async () => {
  const handler = catalogApi.createCatalogGetHandler?.(() => {
    throw new Error('D1 binding DB is unavailable');
  });
  assert.equal(typeof handler, 'function', 'catalog GET handler is exported');
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const result = await handler(request());
    assert.equal(result.status, 500);
    assert.deepEqual(await result.json(), { error: 'ไม่สามารถโหลดแคตตาล็อกได้' });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'Unable to read catalog');
  assert.match(String(logs[0][1]), /D1 binding DB is unavailable/);
});

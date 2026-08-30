import { DatabaseSync } from 'node:sqlite';

function createStatement(sqlite, sql, values = []) {
  return {
    sql,
    values,
    bind(...nextValues) {
      return createStatement(sqlite, sql, nextValues);
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      return sqlite.prepare(sql).run(...values);
    },
  };
}

export function createHomeDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, name_th TEXT NOT NULL);
    CREATE TABLE brands (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE appliance_models (
      id INTEGER PRIMARY KEY,
      catalog_key TEXT NOT NULL UNIQUE,
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
    CREATE TABLE saved_home_appliances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_key TEXT NOT NULL,
      appliance_key TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      hours_per_day REAL NOT NULL,
      cycles_per_month REAL,
      usage_schedule TEXT,
      position INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE monthly_energy_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_key TEXT NOT NULL,
      billing_month TEXT NOT NULL,
      estimated_kwh REAL,
      estimated_bill REAL,
      actual_kwh REAL,
      actual_bill REAL,
      estimated_at INTEGER,
      actual_at INTEGER,
      UNIQUE (household_key, billing_month)
    );
    INSERT INTO categories VALUES
      (1, 'fan', 'พัดลม'),
      (2, 'refrigerator', 'ตู้เย็น'),
      (3, 'washing-machine', 'เครื่องซักผ้า'),
      (4, 'rice-cooker', 'หม้อหุงข้าว');
    INSERT INTO brands VALUES (1, 'Alpha'), (2, 'Legacy');
    INSERT INTO appliance_models VALUES
      (1, 'active-annual', 2, 1, 'A-1', 'Active Annual', 'annual_energy', NULL, 365, NULL, NULL, 'refrigerator', 12, 'cu ft', '5', 'https://example.test/annual', 'EGAT', 101, 'high', 1, 1),
      (2, 'inactive-cycle', 3, 2, 'C-1', 'Inactive Cycle', 'per_cycle', NULL, NULL, 1.25, NULL, 'washing_machine', 9, 'kg', '5', 'https://example.test/cycle', 'EGAT', 102, 'medium', 0, 2),
      (3, 'active-fan', 1, 1, 'F-1', 'Active Fan', 'rated_power', 45, NULL, NULL, 0.8, 'fan', 16, 'in', '5', 'https://example.test/fan', 'EGAT', 103, 'high', 1, 3),
      (4, 'legacy-rice', 4, 2, 'R-1', 'Legacy Rice Cooker', 'rated_power', 600, NULL, NULL, NULL, 'rice_cooker', 1.8, 'L', '5', 'https://example.test/rice', 'EGAT', 104, 'high', 1, 4);
  `);

  const batchCalls = [];
  const db = {
    prepare(sql) {
      return createStatement(sqlite, sql);
    },
    async batch(statements) {
      batchCalls.push(statements);
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, sqlite, batchCalls };
}

export function insertSaved(sqlite, values) {
  sqlite.prepare(`INSERT INTO saved_home_appliances
    (household_key, appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule, position, updated_at)
    VALUES ('default-home', ?, ?, ?, ?, ?, ?, 1)`).run(
    values.applianceKey,
    values.quantity ?? 1,
    values.hoursPerDay ?? 0,
    values.cyclesPerMonth ?? null,
    values.usageSchedule ?? null,
    values.position ?? 0,
  );
}

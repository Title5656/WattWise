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
      const result = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
  };
}

export function createAuthDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (provider, subject)
    );
    CREATE TABLE households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      province TEXT,
      electricity_provider TEXT,
      tariff_product_id INTEGER,
      home_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE household_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (household_id, user_id)
    );
    CREATE UNIQUE INDEX idx_household_members_one_owner
      ON household_members (household_id) WHERE role = 'owner';
    CREATE TABLE household_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      invited_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL,
      name_th TEXT NOT NULL
    );
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE appliance_models (
      id INTEGER PRIMARY KEY,
      catalog_key TEXT NOT NULL UNIQUE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      brand_id INTEGER NOT NULL REFERENCES brands(id),
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
    CREATE TABLE household_appliances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      appliance_model_id INTEGER REFERENCES appliance_models(id),
      custom_name TEXT,
      custom_power_w REAL,
      room TEXT NOT NULL DEFAULT 'ไม่ระบุ',
      quantity INTEGER NOT NULL DEFAULT 1,
      hours_per_day REAL,
      days_per_month INTEGER NOT NULL DEFAULT 30,
      cycles_per_month REAL,
      load_factor REAL,
      start_minute INTEGER,
      end_minute INTEGER,
      instance_key TEXT,
      usage_schedule TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (household_id, instance_key)
    );
    CREATE TABLE household_monthly_energy_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      billing_month TEXT NOT NULL,
      estimated_kwh REAL,
      estimated_bill REAL,
      actual_kwh REAL,
      actual_bill REAL,
      estimated_at INTEGER,
      actual_at INTEGER,
      UNIQUE (household_id, billing_month)
    );
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

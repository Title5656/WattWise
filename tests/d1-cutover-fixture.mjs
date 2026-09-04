import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

function executeMigration(sqlite, migration) {
  sqlite.exec('BEGIN');
  try {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

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

export async function createCutoverDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));

  for (const entry of journal.entries.slice(0, 8)) {
    const migration = await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    executeMigration(sqlite, migration);
  }

  const models = sqlite.prepare('SELECT id, catalog_key AS catalogKey FROM appliance_models ORDER BY id LIMIT 2').all();
  assert.equal(models.length, 2);
  sqlite.prepare('UPDATE appliance_models SET is_active = 0 WHERE id = ?').run(models[0].id);
  sqlite.exec(`
    INSERT INTO households (id, name, province, created_at, updated_at)
      VALUES (701, 'Legacy relational', 'Chiang Mai', 10, 11);
    INSERT INTO household_appliances
      (id, household_id, appliance_model_id, custom_name, room, quantity, hours_per_day,
       days_per_month, cycles_per_month, load_factor, start_minute, end_minute, created_at, updated_at)
      VALUES
      (801, 701, ${models[0].id}, 'Inactive duplicate A', 'Kitchen', 1, 4, 30, NULL, 0.8, 60, 180, 12, 13),
      (802, 701, ${models[0].id}, 'Inactive duplicate B', 'Bedroom', 2, 5, 28, NULL, 0.7, 240, 360, 14, 15);
    INSERT INTO saved_home_appliances
      (id, household_key, appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule, position, updated_at)
      VALUES
      (901, 'clean-home', '${models[1].catalogKey}', 1, 2, NULL, NULL, 0, 20),
      (902, 'clean-home', '${models[1].catalogKey}', 3, 6, NULL, NULL, 1, 21),
      (903, 'default-home', '${models[0].catalogKey}', 1, 3, NULL, NULL, 0, 22),
      (904, 'default-home', 'missing-catalog-key', 1, 1, NULL, NULL, 1, 23);
    INSERT INTO monthly_energy_records
      (id, household_key, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at)
      VALUES
      (1001, 'clean-home', '2026-07', 100, 420, 98, 410, 30, 31),
      (1002, 'default-home', '2026-08', 120, 500, NULL, NULL, 32, NULL);
  `);

  for (const entry of journal.entries.slice(8)) {
    const migration = await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    executeMigration(sqlite, migration);
  }
  sqlite.exec(`
    INSERT INTO tariff_products (id, product_key, name, provider, created_at, updated_at)
      VALUES (601, 'legacy-residential', 'Legacy residential', 'PEA', 1, 1);
    UPDATE households SET electricity_provider = 'PEA', tariff_product_id = 601 WHERE id = 701;
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
        for (const statement of statements) {
          results.push(/^\s*(?:SELECT|PRAGMA)\b/i.test(statement.sql)
            ? await statement.all()
            : await statement.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  return { db, sqlite, batchCalls, models };
}

-- Reconcile databases created before Wrangler migration tracking was enabled.
-- Each statement is additive and safe to run before every deployment.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0000_many_scarlet_witch.sql'
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'appliance_models');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0001_cloudy_starfox.sql'
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_home_appliances');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0002_realistic_usage.sql'
WHERE EXISTS (
  SELECT 1 FROM pragma_table_info('saved_home_appliances') WHERE name = 'cycles_per_month'
);

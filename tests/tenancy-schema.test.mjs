import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import * as schema from '../db/schema.ts';

const legacyMigrationTags = [
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

async function createExpandedFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const tag of legacyMigrationTags) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8');
    executeMigration(db, migration);
  }

  const applianceModelId = db.prepare('SELECT id FROM appliance_models ORDER BY id LIMIT 1').get().id;
  db.exec(`
    INSERT INTO households (id, name, province, created_at, updated_at)
    VALUES (101, 'Legacy household', 'Chiang Mai', 10, 11);
    INSERT INTO household_appliances (
      id, household_id, appliance_model_id, custom_name, room, quantity,
      hours_per_day, days_per_month, created_at, updated_at
    ) VALUES (201, 101, ${applianceModelId}, 'Legacy fridge', 'Kitchen', 1, 24, 30, 12, 13);
    INSERT INTO saved_home_appliances (
      id, household_key, appliance_key, quantity, hours_per_day, position, updated_at
    ) VALUES (301, 'default-home', 'legacy-item', 2, 4, 3, 14);
    INSERT INTO monthly_energy_records (
      id, household_key, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill,
      estimated_at, actual_at
    ) VALUES (401, 'default-home', '2026-07', 123.4, 456.7, 120.5, 440.1, 15, 16);
    INSERT INTO tariff_plans (
      id, name, provider, effective_from, service_charge, ft_rate_per_kwh, vat_rate
    ) VALUES (501, 'Legacy tariff', 'PEA', 1, 0, 0, 0.07);
  `);

  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  const entry = journal.entries[8];
  assert.equal(entry?.idx, 8);
  assert.match(entry?.tag ?? '', /^0008_/);
  const migration = await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
  executeMigration(db, migration);
  return { db, entry };
}

function indexNames(db, table) {
  return db.prepare(`SELECT name FROM pragma_index_list(?) ORDER BY name`).all(table).map(({ name }) => name);
}

test('schema exposes relational tenancy and canonical household-owned records', () => {
  assert.ok(schema.users);
  assert.ok(schema.userIdentities);
  assert.ok(schema.householdMembers);
  assert.ok(schema.householdInvites);
  assert.ok(schema.tariffProducts);
  assert.ok(schema.monthlyEnergyRecords);
  assert.ok(schema.legacyMonthlyEnergyRecords);

  assert.equal(schema.users.publicId.name, 'public_id');
  assert.equal(schema.households.publicId.name, 'public_id');
  assert.equal(schema.households.tariffProductId.name, 'tariff_product_id');
  assert.equal(schema.households.homeRevision.name, 'home_revision');
  assert.equal(schema.householdAppliances.instanceKey.name, 'instance_key');
  assert.equal(schema.householdAppliances.usageSchedule.name, 'usage_schedule');
  assert.equal(schema.householdAppliances.position.name, 'position');
  assert.equal(schema.monthlyEnergyRecords.householdId.name, 'household_id');
  assert.equal(schema.legacyMonthlyEnergyRecords.householdKey.name, 'household_key');
});

test('0008 replays over populated legacy data without discarding monthly or saved-home rows', async () => {
  const { db } = await createExpandedFixture();

  assert.deepEqual({ ...db.prepare(`SELECT household_key AS householdKey, billing_month AS billingMonth,
    estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill, actual_kwh AS actualKwh,
    actual_bill AS actualBill FROM monthly_energy_records WHERE id = 401`).get() }, {
    householdKey: 'default-home', billingMonth: '2026-07', estimatedKwh: 123.4,
    estimatedBill: 456.7, actualKwh: 120.5, actualBill: 440.1,
  });
  assert.deepEqual({ ...db.prepare(`SELECT household_key AS householdKey, appliance_key AS applianceKey,
    quantity, hours_per_day AS hoursPerDay, position FROM saved_home_appliances WHERE id = 301`).get() }, {
    householdKey: 'default-home', applianceKey: 'legacy-item', quantity: 2, hoursPerDay: 4, position: 3,
  });
  assert.deepEqual({ ...db.prepare(`SELECT instance_key AS instanceKey, usage_schedule AS usageSchedule,
    position FROM household_appliances WHERE id = 201`).get() }, {
    instanceKey: null, usageSchedule: null, position: 0,
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM household_monthly_energy_records').get().count, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('user identities enforce opaque IDs, provider subjects, and foreign keys', async () => {
  const { db } = await createExpandedFixture();
  db.exec(`INSERT INTO users (id, public_id, email, display_name, created_at, updated_at)
    VALUES (1, 'usr_opaque_a', 'owner@example.com', 'Owner', 1, 1)`);
  db.exec(`INSERT INTO user_identities (id, user_id, provider, subject, created_at)
    VALUES (1, 1, 'openai', 'subject-a', 1)`);

  assert.throws(() => db.exec(`INSERT INTO users (public_id, email, created_at, updated_at)
    VALUES ('usr_opaque_a', 'other@example.com', 1, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO user_identities (user_id, provider, subject, created_at)
    VALUES (1, 'openai', 'subject-a', 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO user_identities (user_id, provider, subject, created_at)
    VALUES (999, 'openai', 'subject-b', 1)`), /foreign key/i);
});

test('household membership checks roles and permits only one owner per household', async () => {
  const { db } = await createExpandedFixture();
  db.exec(`
    INSERT INTO users (id, public_id, email, created_at, updated_at) VALUES
      (1, 'usr_a', 'a@example.com', 1, 1),
      (2, 'usr_b', 'b@example.com', 1, 1),
      (3, 'usr_c', 'c@example.com', 1, 1);
    INSERT INTO households (id, public_id, name, status, created_at, updated_at)
      VALUES (102, 'hh_a', 'Home A', 'active', 1, 1);
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at)
      VALUES (102, 1, 'owner', 1, 1), (102, 2, 'member', 1, 1);
  `);

  assert.throws(() => db.exec(`INSERT INTO household_members
    (household_id, user_id, role, created_at, updated_at) VALUES (102, 3, 'owner', 1, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_members
    (household_id, user_id, role, created_at, updated_at) VALUES (102, 2, 'viewer', 1, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_members
    (household_id, user_id, role, created_at, updated_at) VALUES (102, 3, 'superuser', 1, 1)`), /check|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO households (public_id, name, status, created_at, updated_at)
    VALUES ('hh_a', 'Duplicate', 'active', 1, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO households (public_id, name, status, created_at, updated_at)
    VALUES ('hh_bad', 'Bad status', 'pending', 1, 1)`), /check|constraint/i);

  assert.ok(indexNames(db, 'household_members').includes('idx_household_members_one_owner'));
  assert.ok(indexNames(db, 'household_members').includes('idx_household_members_user'));
});

test('household invitations require normalized email, a non-owner role, and unique tokens', async () => {
  const { db } = await createExpandedFixture();
  db.exec(`
    INSERT INTO users (id, public_id, email, created_at, updated_at)
      VALUES (1, 'usr_inviter', 'inviter@example.com', 1, 1);
    INSERT INTO households (id, public_id, name, status, created_at, updated_at)
      VALUES (102, 'hh_invites', 'Invite home', 'active', 1, 1);
    INSERT INTO household_invites (
      household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at
    ) VALUES (102, 1, 'member@example.com', 'member', 'hash-a', 100, 1);
  `);

  assert.throws(() => db.exec(`INSERT INTO household_invites
    (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
    VALUES (102, 1, 'other@example.com', 'viewer', 'hash-a', 100, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_invites
    (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
    VALUES (102, 1, 'owner@example.com', 'owner', 'hash-owner', 100, 1)`), /check|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_invites
    (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
    VALUES (102, 1, 'MixedCase@example.com', 'member', 'hash-case', 100, 1)`), /check|constraint/i);

  assert.ok(indexNames(db, 'household_invites').includes('idx_household_invites_household_email'));
  assert.ok(indexNames(db, 'household_invites').includes('idx_household_invites_email'));
});

test('canonical appliances enforce stable household instances and position lookup', async () => {
  const { db } = await createExpandedFixture();
  db.exec(`INSERT INTO households (id, public_id, name, status, created_at, updated_at)
    VALUES (102, 'hh_appliances', 'Appliance home', 'active', 1, 1)`);
  db.exec(`INSERT INTO household_appliances
    (household_id, instance_key, custom_name, custom_power_w, usage_schedule, position, created_at, updated_at)
    VALUES (102, 'instance-a', 'Lamp', 10, '{"kind":"daily"}', 4, 1, 1)`);

  assert.throws(() => db.exec(`INSERT INTO household_appliances
    (household_id, instance_key, custom_name, custom_power_w, position, created_at, updated_at)
    VALUES (102, 'instance-a', 'Lamp 2', 20, 5, 1, 1)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_appliances
    (household_id, instance_key, custom_name, custom_power_w, position, created_at, updated_at)
    VALUES (999, 'instance-b', 'Lamp 3', 30, 6, 1, 1)`), /foreign key/i);

  assert.ok(indexNames(db, 'household_appliances').includes('idx_household_appliances_household_instance'));
  assert.ok(indexNames(db, 'household_appliances').includes('idx_household_appliances_household_position'));
});

test('tariff versions and monthly records enforce household-owned foreign keys and uniqueness', async () => {
  const { db } = await createExpandedFixture();
  db.exec(`
    INSERT INTO tariff_products (id, product_key, name, provider, created_at, updated_at)
      VALUES (1, 'pea-residential-standard', 'Residential standard', 'PEA', 1, 1);
    INSERT INTO tariff_plans (
      id, product_id, name, provider, effective_from, service_charge, ft_rate_per_kwh, vat_rate
    ) VALUES (502, 1, 'Residential standard 2026', 'PEA', 100, 0, 0, 0.07);
    INSERT INTO households (id, public_id, name, tariff_product_id, status, created_at, updated_at)
      VALUES (102, 'hh_monthly', 'Monthly home', 1, 'active', 1, 1);
    INSERT INTO household_monthly_energy_records (
      household_id, billing_month, estimated_kwh, estimated_bill, estimated_at
    ) VALUES (102, '2026-08', 150, 600, 10);
  `);

  assert.throws(() => db.exec(`INSERT INTO tariff_plans
    (product_id, name, provider, effective_from, service_charge, ft_rate_per_kwh, vat_rate)
    VALUES (999, 'Unknown', 'PEA', 100, 0, 0, 0.07)`), /foreign key/i);
  assert.throws(() => db.exec(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, actual_kwh, actual_bill, actual_at)
    VALUES (102, '2026-08', 145, 580, 11)`), /unique|constraint/i);
  assert.throws(() => db.exec(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, estimated_kwh) VALUES (999, '2026-08', 1)`), /foreign key/i);

  assert.ok(indexNames(db, 'tariff_plans').includes('idx_tariff_plans_product_effective'));
  assert.ok(indexNames(db, 'household_monthly_energy_records').includes('idx_household_monthly_energy_records_household_month'));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

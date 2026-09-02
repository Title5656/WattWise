import assert from 'node:assert/strict';
import test from 'node:test';

import { createCutoverDatabase } from './d1-cutover-fixture.mjs';
import {
  claimQuarantinedHousehold,
  issueHouseholdClaimToken,
  readLegacyCutoverVerification,
  runLegacyCutover,
} from '../lib/server/legacy-cutover.ts';

test('cutover deterministically preserves relational and saved-home duplicates, inactive models, and monthly history', async () => {
  const { db, sqlite, models } = await createCutoverDatabase();

  const first = await runLegacyCutover(db, { now: 1_800_000_000_000 });
  assert.deepEqual(first.sources.map(({ sourceKind, sourceKey, status }) => ({ sourceKind, sourceKey, status })), [
    { sourceKind: 'relational', sourceKey: '701', status: 'verified' },
    { sourceKind: 'saved-home', sourceKey: 'clean-home', status: 'verified' },
    { sourceKind: 'saved-home', sourceKey: 'default-home', status: 'blocked' },
  ]);

  const quarantineRows = sqlite.prepare(`SELECT public_id AS publicId, status
    FROM households WHERE id IN (SELECT household_id FROM legacy_cutover_sources) ORDER BY public_id`).all();
  assert.equal(quarantineRows.length, 3);
  assert.ok(quarantineRows.every(({ publicId, status }) => publicId.startsWith('hh_legacy_') && status === 'quarantined'));
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM household_members
    WHERE household_id IN (SELECT household_id FROM legacy_cutover_sources)`).get().count, 0);

  const relational = sqlite.prepare(`SELECT household_id AS householdId FROM legacy_cutover_sources
    WHERE source_kind = 'relational' AND source_key = '701'`).get();
  assert.deepEqual({ ...sqlite.prepare(`SELECT name, province, electricity_provider AS electricityProvider,
      tariff_product_id AS tariffProductId FROM households WHERE id = ?`).get(relational.householdId) }, {
    name: 'Legacy relational',
    province: 'Chiang Mai',
    electricityProvider: 'PEA',
    tariffProductId: 601,
  });
  assert.deepEqual(sqlite.prepare(`SELECT appliance_model_id AS applianceModelId, instance_key AS instanceKey,
      custom_name AS customName FROM household_appliances WHERE household_id = ? ORDER BY position`)
    .all(relational.householdId).map((row) => ({ ...row })), [
    { applianceModelId: models[0].id, instanceKey: 'legacy-relational:801', customName: 'Inactive duplicate A' },
    { applianceModelId: models[0].id, instanceKey: 'legacy-relational:802', customName: 'Inactive duplicate B' },
  ]);

  const clean = sqlite.prepare(`SELECT household_id AS householdId FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  assert.deepEqual(sqlite.prepare(`SELECT appliance_model_id AS applianceModelId, instance_key AS instanceKey,
      quantity FROM household_appliances WHERE household_id = ? ORDER BY position`).all(clean.householdId)
    .map((row) => ({ ...row })), [
    { applianceModelId: models[1].id, instanceKey: 'legacy-saved:901', quantity: 1 },
    { applianceModelId: models[1].id, instanceKey: 'legacy-saved:902', quantity: 3 },
  ]);
  assert.deepEqual({ ...sqlite.prepare(`SELECT billing_month AS billingMonth, estimated_kwh AS estimatedKwh,
      estimated_bill AS estimatedBill, actual_kwh AS actualKwh, actual_bill AS actualBill
    FROM household_monthly_energy_records WHERE household_id = ?`).get(clean.householdId) }, {
    billingMonth: '2026-07', estimatedKwh: 100, estimatedBill: 420, actualKwh: 98, actualBill: 410,
  });

  const blocked = sqlite.prepare(`SELECT id, source_appliance_count AS sourceCount,
      copied_appliance_count AS copiedCount, issue_count AS issueCount, verification_status AS status
    FROM legacy_cutover_sources WHERE source_kind = 'saved-home' AND source_key = 'default-home'`).get();
  assert.deepEqual({ ...blocked }, { id: blocked.id, sourceCount: 2, copiedCount: 1, issueCount: 1, status: 'blocked' });
  assert.deepEqual(sqlite.prepare(`SELECT code, source_table AS sourceTable, source_row_id AS sourceRowId
    FROM legacy_cutover_issues WHERE source_id = ?`).all(blocked.id).map((row) => ({ ...row })), [
    { code: 'UNKNOWN_CATALOG_KEY', sourceTable: 'saved_home_appliances', sourceRowId: '904' },
  ]);

  const before = sqlite.prepare(`SELECT source_kind, source_key, household_id, source_checksum, target_checksum,
    source_appliance_count, copied_appliance_count, source_monthly_count, copied_monthly_count
    FROM legacy_cutover_sources ORDER BY source_kind, source_key`).all();
  await runLegacyCutover(db, { now: 1_800_000_000_100 });
  const after = sqlite.prepare(`SELECT source_kind, source_key, household_id, source_checksum, target_checksum,
    source_appliance_count, copied_appliance_count, source_monthly_count, copied_monthly_count
    FROM legacy_cutover_sources ORDER BY source_kind, source_key`).all();
  assert.deepEqual(after, before);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('the raw manifest and issue history are immutable and source drift cannot become a new baseline', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id, source_appliance_count AS applianceCount,
      source_checksum AS sourceChecksum, manifest_row_count AS manifestCount
    FROM legacy_cutover_sources WHERE source_kind = 'saved-home' AND source_key = 'default-home'`).get();
  const originalManifestRows = sqlite.prepare(`SELECT item_kind, source_row_id, payload, payload_checksum
    FROM legacy_cutover_manifest_rows WHERE source_id = ? ORDER BY item_kind, source_row_id`).all(source.id);
  const originalEvents = sqlite.prepare(`SELECT code, source_row_id FROM legacy_cutover_issue_events
    WHERE source_id = ? ORDER BY id`).all(source.id);
  assert.equal(source.applianceCount, 2);
  assert.equal(source.manifestCount, 4);
  assert.deepEqual(originalEvents.map((row) => ({ ...row })), [{ code: 'UNKNOWN_CATALOG_KEY', source_row_id: '904' }]);
  assert.throws(() => sqlite.prepare(`UPDATE legacy_cutover_manifest_rows SET payload = '{}' WHERE source_id = ?`).run(source.id), /immutable/i);
  assert.throws(() => sqlite.prepare('DELETE FROM legacy_cutover_issue_events WHERE source_id = ?').run(source.id), /immutable/i);
  assert.throws(() => sqlite.prepare(`INSERT INTO legacy_cutover_manifest_rows
    (source_id, item_kind, source_table, source_row_id, payload, payload_checksum, captured_at)
    VALUES (?, 'config', 'injected', 'injected', '{}', 'bad', 1)`).run(source.id), /immutable/i);

  sqlite.prepare('DELETE FROM saved_home_appliances WHERE id = 904').run();
  await runLegacyCutover(db, { now: 1_800_000_000_100 });
  const drifted = sqlite.prepare(`SELECT source_appliance_count AS applianceCount, source_checksum AS sourceChecksum,
      source_drift AS sourceDrift, verification_status AS status FROM legacy_cutover_sources WHERE id = ?`).get(source.id);
  assert.deepEqual({ ...drifted }, {
    applianceCount: 2,
    sourceChecksum: source.sourceChecksum,
    sourceDrift: 1,
    status: 'blocked',
  });
  assert.deepEqual(sqlite.prepare(`SELECT item_kind, source_row_id, payload, payload_checksum
    FROM legacy_cutover_manifest_rows WHERE source_id = ? ORDER BY item_kind, source_row_id`).all(source.id), originalManifestRows);
  assert.deepEqual(sqlite.prepare(`SELECT code, source_row_id FROM legacy_cutover_issue_events
    WHERE source_id = ? ORDER BY id`).all(source.id).map((row) => ({ ...row })), [
    ...originalEvents.map((row) => ({ ...row })),
    { code: 'SOURCE_DRIFT', source_row_id: 'default-home' },
  ]);
});

test('an interrupted unsealed manifest capture is replaced instead of becoming the baseline', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  sqlite.exec(`
    INSERT INTO households (public_id, name, status, created_at, updated_at)
      VALUES ('hh_partial_capture', 'Partial capture', 'quarantined', 1, 1);
    INSERT INTO legacy_cutover_sources
      (source_kind, source_key, household_id, verification_status, created_at, updated_at)
      SELECT 'saved-home', 'clean-home', id, 'pending', 1, 1 FROM households
      WHERE public_id = 'hh_partial_capture';
    INSERT INTO legacy_cutover_manifest_rows
      (source_id, item_kind, source_table, source_row_id, payload, payload_checksum, captured_at)
      SELECT id, 'config', 'legacy_keyed_home', 'clean-home', '{}', 'interrupted', 1
      FROM legacy_cutover_sources WHERE source_key = 'clean-home';
  `);

  await runLegacyCutover(db, { now: 1_800_000_000_000 });

  const source = sqlite.prepare(`SELECT id, manifest_row_count AS manifestCount,
      verification_status AS status FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  assert.deepEqual({ ...source }, { id: source.id, manifestCount: 4, status: 'verified' });
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM legacy_cutover_manifest_rows
    WHERE source_id = ? AND payload_checksum = 'interrupted'`).get(source.id).count, 0);
});

test('adding a formerly unknown catalog model resolves the frozen manifest without deleting its raw row or audit event', async () => {
  const { db, sqlite, models } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'default-home'`).get();
  sqlite.exec(`INSERT INTO appliance_models
    (id, catalog_key, category_id, brand_id, model_code, display_name, calculation_method,
     rated_power_w, confidence, is_active, sort_order, created_at, updated_at)
    SELECT 9999, 'missing-catalog-key', category_id, brand_id, 'RECOVERED', 'Recovered legacy model',
      'rated_power', 1, 'sample', 0, 9999, 1, 1 FROM appliance_models WHERE id = ${models[0].id}`);

  await runLegacyCutover(db, { now: 1_800_000_000_100 });
  assert.deepEqual({ ...sqlite.prepare(`SELECT verification_status AS status, issue_count AS issueCount,
      source_drift AS sourceDrift FROM legacy_cutover_sources WHERE id = ?`).get(source.id) }, {
    status: 'verified', issueCount: 0, sourceDrift: 0,
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM saved_home_appliances WHERE id = 904').get().count, 1);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM household_appliances
    WHERE household_id = (SELECT household_id FROM legacy_cutover_sources WHERE id = ?)`).get(source.id).count, 2);
  assert.deepEqual(sqlite.prepare(`SELECT code, source_row_id FROM legacy_cutover_issue_events
    WHERE source_id = ? ORDER BY id`).all(source.id).map((row) => ({ ...row })), [
    { code: 'UNKNOWN_CATALOG_KEY', source_row_id: '904' },
  ]);
});

test('a verified quarantine can be claimed exactly once with only a hashed expiring token', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const clean = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  sqlite.exec(`INSERT INTO users (id, public_id, email, created_at, updated_at)
    VALUES (41, 'usr_claimant', 'claimant@example.com', 1, 1), (42, 'usr_other', 'other@example.com', 1, 1)`);

  const issued = await issueHouseholdClaimToken(db, clean.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
    randomBytes: () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  });
  assert.match(issued.token, /^[A-Za-z0-9_-]{40,}$/);
  const stored = sqlite.prepare('SELECT token_hash AS tokenHash FROM household_claim_tokens WHERE source_id = ?').get(clean.id);
  assert.notEqual(stored.tokenHash, issued.token);
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);

  const claimed = await claimQuarantinedHousehold(db, 41, issued.token, 1_800_000_000_020);
  assert.equal(claimed.publicId, issued.householdPublicId);
  assert.deepEqual({ ...sqlite.prepare(`SELECT households.status, household_members.user_id AS userId,
      household_members.role FROM households INNER JOIN household_members
      ON household_members.household_id = households.id WHERE households.public_id = ?`).get(claimed.publicId) }, {
    status: 'active', userId: 41, role: 'owner',
  });
  assert.deepEqual({ ...sqlite.prepare(`SELECT verification_status AS status, claimed_at AS claimedAt
    FROM legacy_cutover_sources WHERE id = ?`).get(clean.id) }, {
    status: 'claimed', claimedAt: 1_800_000_000_020,
  });
  await assert.rejects(() => claimQuarantinedHousehold(db, 42, issued.token, 1_800_000_000_030), /not found/i);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM household_members
    WHERE household_id = (SELECT household_id FROM legacy_cutover_sources WHERE id = ?)`).get(clean.id).count, 1);
});

test('blocked quarantines cannot receive claim tokens', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const blocked = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE verification_status = 'blocked'`).get();

  await assert.rejects(() => issueHouseholdClaimToken(db, blocked.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
  }), /not verified/i);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_claim_tokens').get().count, 0);
});

test('an expired unused claim token can be replaced without reviving the old secret', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  sqlite.exec(`INSERT INTO users (id, public_id, email, created_at, updated_at)
    VALUES (41, 'usr_claimant', 'claimant@example.com', 1, 1)`);
  const first = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_000_000_020,
    randomBytes: () => new Uint8Array(32).fill(1),
  });
  await assert.rejects(() => claimQuarantinedHousehold(db, 41, first.token, 1_800_000_000_020), /not found/i);
  assert.equal(sqlite.prepare('SELECT consumed_at AS consumedAt FROM household_claim_tokens').get().consumedAt, null);

  const replacement = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_020,
    expiresAt: 1_800_000_000_100,
    randomBytes: () => new Uint8Array(32).fill(2),
  });
  assert.notEqual(replacement.token, first.token);
  await assert.rejects(() => claimQuarantinedHousehold(db, 41, first.token, 1_800_000_000_030), /not found/i);
  assert.equal((await claimQuarantinedHousehold(db, 41, replacement.token, 1_800_000_000_030)).publicId,
    replacement.householdPublicId);
});

test('target drift invalidates sealing and every bound token until a fresh verification epoch', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id, household_id AS householdId FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  sqlite.exec(`INSERT INTO users (id, public_id, email, created_at, updated_at)
    VALUES (41, 'usr_claimant', 'claimant@example.com', 1, 1)`);
  const first = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
    randomBytes: () => new Uint8Array(32).fill(3),
  });

  sqlite.prepare(`UPDATE household_appliances SET quantity = quantity + 1
    WHERE household_id = ? AND id = (SELECT id FROM household_appliances WHERE household_id = ? ORDER BY id LIMIT 1)`)
    .run(source.householdId, source.householdId);
  const drifted = await readLegacyCutoverVerification(db);
  assert.equal(drifted.readyForClaims, false);
  await assert.rejects(() => issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_020,
    expiresAt: 1_800_003_600_020,
  }), /not verified/i);
  await assert.rejects(() => claimQuarantinedHousehold(db, 41, first.token, 1_800_000_000_020), /not found/i);

  await runLegacyCutover(db, { now: 1_800_000_000_030 });
  const second = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_040,
    expiresAt: 1_800_003_600_040,
    randomBytes: () => new Uint8Array(32).fill(4),
  });
  const claimed = await claimQuarantinedHousehold(db, 41, second.token, 1_800_000_000_050);
  sqlite.prepare(`UPDATE household_appliances SET quantity = quantity + 1 WHERE household_id = ?`).run(source.householdId);
  assert.equal(sqlite.prepare('SELECT status FROM households WHERE public_id = ?').get(claimed.publicId).status, 'active');
  assert.equal(sqlite.prepare('SELECT verification_status AS status FROM legacy_cutover_sources WHERE id = ?').get(source.id).status, 'claimed');
});

test('relational source configuration drift after token issuance prevents claim', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'relational' AND source_key = '701'`).get();
  sqlite.exec(`INSERT INTO users (id, public_id, email, created_at, updated_at)
    VALUES (41, 'usr_claimant', 'claimant@example.com', 1, 1)`);
  const issued = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
    randomBytes: () => new Uint8Array(32).fill(5),
  });

  sqlite.prepare(`UPDATE households SET province = 'Bangkok' WHERE id = 701`).run();

  await assert.rejects(
    () => claimQuarantinedHousehold(db, 41, issued.token, 1_800_000_000_020),
    /not found/i,
  );
});

test('relational source appliance insertion after token issuance prevents claim', async () => {
  const { db, sqlite, models } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'relational' AND source_key = '701'`).get();
  sqlite.exec(`INSERT INTO users (id, public_id, email, created_at, updated_at)
    VALUES (41, 'usr_claimant', 'claimant@example.com', 1, 1)`);
  const issued = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
    randomBytes: () => new Uint8Array(32).fill(6),
  });

  sqlite.prepare(`INSERT INTO household_appliances
      (household_id, appliance_model_id, room, quantity, days_per_month, instance_key,
       usage_schedule, position, created_at, updated_at)
    VALUES (701, ?, 'Kitchen', 1, 30, 'late-source-row', '[]', 99, 1, 1)`)
    .run(models[0].id);

  await assert.rejects(
    () => claimQuarantinedHousehold(db, 41, issued.token, 1_800_000_000_020),
    /not found/i,
  );
});

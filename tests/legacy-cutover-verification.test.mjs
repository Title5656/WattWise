import assert from 'node:assert/strict';
import test from 'node:test';

import * as cutover from '../lib/server/legacy-cutover.ts';
import { createCutoverDatabase } from './d1-cutover-fixture.mjs';

test('verification reports blockers and detects target changes after a clean backfill', async () => {
  assert.equal(typeof cutover.readLegacyCutoverVerification, 'function');
  const { db, sqlite } = await createCutoverDatabase();
  await cutover.runLegacyCutover(db, { now: 1_800_000_000_000 });

  const blocked = await cutover.readLegacyCutoverVerification(db);
  assert.equal(blocked.readyForClaims, false);
  assert.deepEqual(blocked.totals, { sources: 3, verified: 2, blocked: 1, claimed: 0, issues: 1, foreignKeyViolations: 0 });

  sqlite.exec(`INSERT INTO appliance_models
    (id, catalog_key, category_id, brand_id, model_code, display_name, calculation_method,
     rated_power_w, confidence, is_active, sort_order, created_at, updated_at)
    SELECT 9999, 'missing-catalog-key', category_id, brand_id, 'RECOVERED', 'Recovered legacy model',
      'rated_power', 1, 'sample', 0, 9999, 1, 1 FROM appliance_models ORDER BY id LIMIT 1`);
  await cutover.runLegacyCutover(db, { now: 1_800_000_000_100 });
  const clean = await cutover.readLegacyCutoverVerification(db);
  assert.equal(clean.readyForClaims, true);
  assert.ok(clean.sources.every(({ countsMatch, checksumsMatch, liveTargetMatches }) =>
    countsMatch && checksumsMatch && liveTargetMatches));

  sqlite.exec(`UPDATE household_appliances SET quantity = quantity + 1
    WHERE household_id = (SELECT household_id FROM legacy_cutover_sources ORDER BY id LIMIT 1)
      AND id = (SELECT id FROM household_appliances
        WHERE household_id = (SELECT household_id FROM legacy_cutover_sources ORDER BY id LIMIT 1)
        ORDER BY id LIMIT 1)`);
  const changed = await cutover.readLegacyCutoverVerification(db);
  assert.equal(changed.readyForClaims, false);
  assert.ok(changed.sources.some(({ liveTargetMatches }) => !liveTargetMatches));
});

test('a database with no legacy sources is ready without inventing a household', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  sqlite.exec(`
    DELETE FROM household_appliances;
    DELETE FROM households;
    DELETE FROM saved_home_appliances;
    DELETE FROM monthly_energy_records;
  `);

  assert.deepEqual(await cutover.runLegacyCutover(db), { sources: [] });
  const verification = await cutover.readLegacyCutoverVerification(db);
  assert.equal(verification.readyForClaims, true);
  assert.equal(verification.totals.sources, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM households').get().count, 0);
});

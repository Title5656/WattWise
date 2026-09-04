import assert from 'node:assert/strict';
import test from 'node:test';

import { createD1RestDatabase } from '../scripts/d1-rest-database.mjs';
import { executeCutoverCommand } from '../scripts/legacy-cutover.mjs';
import { createCutoverDatabase } from './d1-cutover-fixture.mjs';

test('D1 REST adapter sends bound statements through the authenticated administrative API', async () => {
  const requests = [];
  const db = createD1RestDatabase({
    accountId: 'account-id',
    databaseId: 'database-id',
    apiToken: 'secret-api-token',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: [{ success: true, results: [{ value: 7 }], meta: { changes: 0 } }],
      });
    },
  });

  const result = await db.prepare('SELECT ? AS value').bind(7).all();

  assert.deepEqual(result.results, [{ value: 7 }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url,
    'https://api.cloudflare.com/client/v4/accounts/account-id/d1/database/database-id/query');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-api-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), { sql: 'SELECT ? AS value', params: [7] });
});

test('D1 REST adapter submits a prepared batch atomically in one API request', async () => {
  const bodies = [];
  const db = createD1RestDatabase({
    accountId: 'account-id', databaseId: 'database-id', apiToken: 'secret-api-token',
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: [
          { success: true, results: [], meta: { changes: 1 } },
          { success: true, results: [], meta: { changes: 1 } },
        ],
      });
    },
  });

  const results = await db.batch([
    db.prepare('UPDATE one SET value = ?').bind(1),
    db.prepare('UPDATE two SET value = ?').bind(2),
  ]);

  assert.equal(results.length, 2);
  assert.deepEqual(bodies, [{ batch: [
    { sql: 'UPDATE one SET value = ?', params: [1] },
    { sql: 'UPDATE two SET value = ?', params: [2] },
  ] }]);
});

test('maintenance command exposes preview, backfill, verification, and explicit claim issuance', async () => {
  const { db, sqlite } = await createCutoverDatabase();

  const preview = await executeCutoverCommand(['preview'], { db });
  assert.equal(preview.sources.length, 3);
  assert.equal(preview.sources.every(({ captured }) => captured === false), true);

  const backfill = await executeCutoverCommand(['backfill'], { db, now: 1_800_000_000_000 });
  assert.equal(backfill.sources.length, 3);
  const blockedSource = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'default-home'`).get();
  sqlite.exec(`INSERT INTO appliance_models
    (id, catalog_key, category_id, brand_id, model_code, display_name, calculation_method,
     rated_power_w, confidence, is_active, sort_order, created_at, updated_at)
    SELECT 9999, 'missing-catalog-key', category_id, brand_id, 'RECOVERED', 'Recovered legacy model',
      'rated_power', 1, 'sample', 0, 9999, 1, 1 FROM appliance_models ORDER BY id LIMIT 1`);
  await executeCutoverCommand(['backfill'], { db, now: 1_800_000_000_010 });
  const verification = await executeCutoverCommand(['verify'], { db });
  assert.equal(verification.readyForClaims, true);

  const token = await executeCutoverCommand([
    'issue-token', '--source-id', String(blockedSource.id), '--expires-at', '2027-01-15T09:00:00.000Z',
  ], {
    db,
    now: Date.parse('2027-01-15T08:00:00.000Z'),
    randomBytes: () => new Uint8Array(32).fill(7),
  });
  assert.equal(token.householdPublicId.startsWith('hh_legacy_'), true);
  assert.equal(typeof token.token, 'string');
  assert.equal(token.expiresAt, Date.parse('2027-01-15T09:00:00.000Z'));
});

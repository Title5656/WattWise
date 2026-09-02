import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyClaimApi } from '../lib/server/legacy-claim-api.ts';
import { issueHouseholdClaimToken, runLegacyCutover } from '../lib/server/legacy-cutover.ts';
import { createCutoverDatabase } from './d1-cutover-fixture.mjs';

function identity(subject, email) {
  return {
    'oai-authenticated-user-id': subject,
    'oai-authenticated-user-email': email,
  };
}

function claimRequest(token, headers = {}) {
  return new Request('https://wattwise.test/api/household-claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ token, userId: 42 }),
  });
}

test('claim API authenticates first, ignores client identity, and does not disclose invalid or reused tokens', async () => {
  const { db, sqlite } = await createCutoverDatabase();
  await runLegacyCutover(db, { now: 1_800_000_000_000 });
  const source = sqlite.prepare(`SELECT id FROM legacy_cutover_sources
    WHERE source_kind = 'saved-home' AND source_key = 'clean-home'`).get();
  const issued = await issueHouseholdClaimToken(db, source.id, {
    now: 1_800_000_000_010,
    expiresAt: 1_800_003_600_010,
    randomBytes: () => new Uint8Array(32).fill(9),
  });
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, created_at, updated_at) VALUES
      (41, 'usr_claimant', 'claimant@example.com', 1, 1),
      (42, 'usr_body', 'body@example.com', 1, 1);
    INSERT INTO user_identities (user_id, provider, subject, created_at)
      VALUES (41, 'openai-sites', 'claim-subject', 1);
  `);
  const api = createLegacyClaimApi(() => db, { now: () => 1_800_000_000_020 });

  const unauthenticated = await api.claim(claimRequest(issued.token));
  assert.equal(unauthenticated.status, 401);
  assert.equal(sqlite.prepare('SELECT consumed_at AS consumedAt FROM household_claim_tokens').get().consumedAt, null);

  const claimed = await api.claim(claimRequest(issued.token, identity('claim-subject', 'claimant@example.com')));
  assert.equal(claimed.status, 200);
  assert.deepEqual(await claimed.json(), { household: { id: issued.householdPublicId } });
  assert.deepEqual({ ...sqlite.prepare(`SELECT user_id AS userId, role FROM household_members
    WHERE household_id = (SELECT household_id FROM legacy_cutover_sources WHERE id = ?)`).get(source.id) }, {
    userId: 41,
    role: 'owner',
  });

  const reused = await api.claim(claimRequest(issued.token, identity('claim-subject', 'claimant@example.com')));
  const invalid = await api.claim(claimRequest('x'.repeat(43), identity('claim-subject', 'claimant@example.com')));
  assert.equal(reused.status, 404);
  assert.equal(invalid.status, 404);
  assert.deepEqual(await reused.json(), await invalid.json());
});

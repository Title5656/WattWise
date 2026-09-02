import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '../db/schema.ts';

test('schema exposes auditable quarantine sources, issues, and one-time claim tokens', () => {
  assert.ok(schema.legacyCutoverSources);
  assert.ok(schema.legacyCutoverIssues);
  assert.ok(schema.householdClaimTokens);

  assert.equal(schema.legacyCutoverSources.sourceKind.name, 'source_kind');
  assert.equal(schema.legacyCutoverSources.sourceKey.name, 'source_key');
  assert.equal(schema.legacyCutoverSources.verificationStatus.name, 'verification_status');
  assert.equal(schema.legacyCutoverIssues.sourceRowId.name, 'source_row_id');
  assert.equal(schema.householdClaimTokens.tokenHash.name, 'token_hash');
  assert.equal(schema.householdClaimTokens.claimedByUserId.name, 'claimed_by_user_id');
});

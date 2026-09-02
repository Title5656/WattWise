import assert from 'node:assert/strict';
import test from 'node:test';

import * as schema from '../db/schema.ts';

test('schema exposes auditable quarantine sources, issues, and one-time claim tokens', () => {
  assert.ok(schema.legacyCutoverSources);
  assert.ok(schema.legacyCutoverManifestRows);
  assert.ok(schema.legacyCutoverIssues);
  assert.ok(schema.legacyCutoverIssueEvents);
  assert.ok(schema.householdClaimTokens);

  assert.equal(schema.legacyCutoverSources.sourceKind.name, 'source_kind');
  assert.equal(schema.legacyCutoverSources.sourceKey.name, 'source_key');
  assert.equal(schema.legacyCutoverSources.verificationStatus.name, 'verification_status');
  assert.equal(schema.legacyCutoverSources.manifestChecksum.name, 'manifest_checksum');
  assert.equal(schema.legacyCutoverSources.verificationChecksum.name, 'verification_checksum');
  assert.equal(schema.legacyCutoverSources.sourceDrift.name, 'source_drift');
  assert.equal(schema.legacyCutoverSources.verificationEpoch.name, 'verification_epoch');
  assert.equal(schema.legacyCutoverManifestRows.payload.name, 'payload');
  assert.equal(schema.legacyCutoverIssues.sourceRowId.name, 'source_row_id');
  assert.equal(schema.legacyCutoverIssueEvents.observedAt.name, 'observed_at');
  assert.equal(schema.householdClaimTokens.tokenHash.name, 'token_hash');
  assert.equal(schema.householdClaimTokens.verificationEpoch.name, 'verification_epoch');
  assert.equal(schema.householdClaimTokens.targetChecksum.name, 'target_checksum');
  assert.equal(schema.householdClaimTokens.claimedByUserId.name, 'claimed_by_user_id');
});

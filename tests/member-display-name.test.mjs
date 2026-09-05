import assert from 'node:assert/strict';
import test from 'node:test';

import { listHouseholdMembers } from '../lib/server/membership-repository.ts';
import { createAuthDatabase } from './d1-auth-fixture.mjs';

test('member listings use a neutral label instead of exposing email when a name is missing', async () => {
  const { db, sqlite } = createAuthDatabase();
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, display_name, created_at, updated_at)
      VALUES (1, 'usr_unnamed', 'private@example.com', NULL, 1, 1);
    INSERT INTO households (id, public_id, name, status, created_at, updated_at)
      VALUES (1, 'hh_one', 'บ้าน', 'active', 1, 1);
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at)
      VALUES (1, 1, 'member', 1, 1);
  `);

  const [member] = await listHouseholdMembers(db, 1);
  assert.equal(member.displayName, 'ผู้ใช้');
  assert.equal(member.email, 'private@example.com');
});

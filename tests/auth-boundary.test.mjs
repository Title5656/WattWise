import assert from 'node:assert/strict';
import test from 'node:test';

import { getCurrentIdentity } from '../lib/server/sites-identity.ts';
import { createCurrentUserResolver, getCurrentUser, requireUser } from '../lib/server/current-user.ts';
import {
  AuthenticationRequiredError,
  HouseholdForbiddenError,
  HouseholdNotFoundError,
} from '../lib/server/auth-errors.ts';
import {
  canAssignRole,
  canRemoveRole,
  requireHouseholdMember,
  requireHouseholdRole,
} from '../lib/server/household-access.ts';
import { createAuthDatabase } from './d1-auth-fixture.mjs';

test('parses only complete internal Cloudflare Access identity headers', () => {
  assert.equal(getCurrentIdentity(new Request('https://wattwise.test')), null);
  assert.equal(getCurrentIdentity(new Request('https://wattwise.test', {
    headers: { 'x-wattwise-auth-subject': 'subject-1' },
  })), null);

  assert.deepEqual(getCurrentIdentity(new Request('https://wattwise.test', {
    headers: {
      'x-wattwise-auth-subject': '  subject-1  ',
      'x-wattwise-auth-email': '  ALICE@EXAMPLE.COM  ',
      'x-wattwise-auth-name': '  Alice Example  ',
    },
  })), {
    provider: 'cloudflare-access',
    subject: 'subject-1',
    email: 'alice@example.com',
    displayName: 'Alice Example',
  });
});

test('uses the verified email when the internal display name is blank', () => {
  const baseHeaders = {
    'x-wattwise-auth-subject': 'subject-1',
    'x-wattwise-auth-email': 'alice@example.com',
  };
  const named = getCurrentIdentity(new Request('https://wattwise.test', {
    headers: {
      ...baseHeaders,
      'x-wattwise-auth-name': 'Alice Example',
    },
  }));
  const blank = getCurrentIdentity(new Request('https://wattwise.test', {
    headers: {
      ...baseHeaders,
      'x-wattwise-auth-name': '   ',
    },
  }));

  assert.equal(named?.displayName, 'Alice Example');
  assert.equal(blank?.displayName, 'alice@example.com');
});

test('provisions and reuses one application user for a verified identity', async () => {
  const { db, sqlite } = createAuthDatabase();
  const request = new Request('https://wattwise.test', {
    headers: {
      'x-wattwise-auth-subject': 'provider-subject-1',
      'x-wattwise-auth-email': 'ALICE@EXAMPLE.COM',
      'x-wattwise-auth-name': 'Alice Example',
    },
  });

  const getUser = createCurrentUserResolver({
    createPublicId: () => 'usr_test_opaque',
    now: () => 123,
  });
  const first = await getUser(db, request);
  const second = await getUser(db, request);

  assert.deepEqual(second, first);
  assert.equal(first?.provider, 'cloudflare-access');
  assert.equal(first?.subject, 'provider-subject-1');
  assert.equal(first?.email, 'alice@example.com');
  assert.equal(first?.displayName, 'Alice Example');
  assert.match(first?.publicId ?? '', /^usr_test_/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM user_identities').get().count, 1);
});

test('reuses a racing identity without leaving a provisional user behind', async () => {
  const { db, sqlite } = createAuthDatabase();
  let insertCompetitor = true;
  const racingDb = {
    ...db,
    async batch(statements) {
      if (insertCompetitor) {
        insertCompetitor = false;
        sqlite.exec(`
          INSERT INTO users (public_id, email, display_name, created_at, updated_at)
            VALUES ('usr_competitor', 'alice@example.com', 'Alice Example', 1, 1);
          INSERT INTO user_identities (user_id, provider, subject, created_at)
            VALUES (1, 'cloudflare-access', 'race-subject', 1);
        `);
      }
      return db.batch(statements);
    },
  };
  const getUser = createCurrentUserResolver({
    createPublicId: () => 'usr_provisional',
    now: () => 123,
  });

  const user = await getUser(racingDb, new Request('https://wattwise.test', {
    headers: {
      'x-wattwise-auth-subject': 'race-subject',
      'x-wattwise-auth-email': 'alice@example.com',
    },
  }));

  assert.equal(user?.publicId, 'usr_competitor');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM user_identities').get().count, 1);
});

test('requires an authenticated user before provisioning', async () => {
  const { db, sqlite } = createAuthDatabase();

  await assert.rejects(
    requireUser(db, new Request('https://wattwise.test')),
    (error) => error instanceof AuthenticationRequiredError && error.status === 401,
  );
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('resolves access only for an active household membership', async () => {
  const { db, sqlite } = createAuthDatabase();
  seedHouseholds(sqlite);

  assert.deepEqual(await requireHouseholdMember(db, 1, 'hh-active'), {
    userId: 1,
    householdId: 10,
    householdPublicId: 'hh-active',
    role: 'member',
  });
  for (const householdPublicId of ['hh-private', 'hh-quarantined', 'hh-deleted', 'hh-missing']) {
    await assert.rejects(
      requireHouseholdMember(db, 1, householdPublicId),
      (error) => error instanceof HouseholdNotFoundError
        && error.status === 404
        && error.householdPublicId === householdPublicId,
    );
  }
});

test('returns forbidden only after a member fails an allowed-role check', async () => {
  const { db, sqlite } = createAuthDatabase();
  seedHouseholds(sqlite);

  await assert.rejects(
    requireHouseholdRole(db, 1, 'hh-active', ['admin']),
    (error) => error instanceof HouseholdForbiddenError
      && error.status === 403
      && error.householdPublicId === 'hh-active',
  );
  await assert.rejects(
    requireHouseholdRole(db, 1, 'hh-private', ['member']),
    (error) => error instanceof HouseholdNotFoundError && error.status === 404,
  );
  assert.equal((await requireHouseholdRole(db, 1, 'hh-active', ['member'])).role, 'member');
});

test('enforces the complete household role-management hierarchy', () => {
  const roles = ['owner', 'admin', 'member', 'viewer'];
  const assignable = new Set(['owner:admin', 'owner:member', 'owner:viewer', 'admin:member', 'admin:viewer']);
  const removable = new Set(['owner:admin', 'owner:member', 'owner:viewer', 'admin:member', 'admin:viewer']);

  for (const actor of roles) {
    for (const target of roles) {
      assert.equal(canAssignRole(actor, target), assignable.has(`${actor}:${target}`), `${actor} assign ${target}`);
      assert.equal(canRemoveRole(actor, target), removable.has(`${actor}:${target}`), `${actor} remove ${target}`);
    }
  }
});

function seedHouseholds(sqlite) {
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, created_at, updated_at) VALUES
      (1, 'usr_owner', 'owner@example.com', 1, 1),
      (2, 'usr_other', 'other@example.com', 1, 1);
    INSERT INTO households (id, public_id, name, status, created_at, updated_at) VALUES
      (10, 'hh-active', 'Active household', 'active', 1, 1),
      (11, 'hh-private', 'Private household', 'active', 1, 1),
      (12, 'hh-quarantined', 'Quarantined household', 'quarantined', 1, 1),
      (13, 'hh-deleted', 'Deleted household', 'deleted', 1, 1);
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at) VALUES
      (10, 1, 'member', 1, 1),
      (11, 2, 'member', 1, 1),
      (12, 1, 'member', 1, 1),
      (13, 1, 'member', 1, 1);
  `);
}

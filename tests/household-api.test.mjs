import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createHouseholdApi } from '../lib/server/household-api.ts';
import { createAuthDatabase } from './d1-auth-fixture.mjs';

const NOW = 2_000_000_000_000;

function identity(subject, email, displayName = email) {
  return {
    'x-wattwise-auth-subject': subject,
    'x-wattwise-auth-email': email,
    'x-wattwise-auth-name': displayName,
  };
}

function request(path, { method = 'GET', user, json } = {}) {
  return new Request(`https://wattwise.test${path}`, {
    method,
    headers: {
      ...(user ?? {}),
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

async function result(response) {
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

function setup() {
  const { db, sqlite } = createAuthDatabase();
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, display_name, avatar_url, created_at, updated_at) VALUES
      (1, 'usr_a', 'a@example.com', 'User A', 'https://example.test/a.png', 1, 1),
      (2, 'usr_b', 'b@example.com', 'User B', NULL, 1, 1),
      (3, 'usr_admin', 'admin@example.com', 'Admin', NULL, 1, 1),
      (4, 'usr_member', 'member@example.com', 'Member', NULL, 1, 1),
      (5, 'usr_viewer', 'viewer@example.com', 'Viewer', NULL, 1, 1),
      (6, 'usr_invitee', 'invitee@example.com', 'Invitee', NULL, 1, 1);
    INSERT INTO user_identities (user_id, provider, subject, created_at) VALUES
      (1, 'cloudflare-access', 'sub-a', 1), (2, 'cloudflare-access', 'sub-b', 1),
      (3, 'cloudflare-access', 'sub-admin', 1), (4, 'cloudflare-access', 'sub-member', 1),
      (5, 'cloudflare-access', 'sub-viewer', 1), (6, 'cloudflare-access', 'sub-invitee', 1);
    INSERT INTO households (id, public_id, name, province, electricity_provider, status, created_at, updated_at) VALUES
      (10, 'hh_a', 'Home A', 'Bangkok', 'MEA', 'active', 1, 1),
      (20, 'hh_b', 'Home B', 'Chiang Mai', 'PEA', 'active', 1, 1),
      (30, 'hh_quarantined', 'Hidden', NULL, NULL, 'quarantined', 1, 1);
    INSERT INTO household_members (household_id, user_id, role, created_at, updated_at) VALUES
      (10, 1, 'owner', 1, 1), (10, 3, 'admin', 1, 1), (10, 4, 'member', 1, 1),
      (10, 5, 'viewer', 1, 1), (20, 2, 'owner', 1, 1), (30, 1, 'owner', 1, 1);
  `);
  let id = 0;
  const api = createHouseholdApi(() => db, {
    now: () => NOW,
    createHouseholdPublicId: () => `hh_generated_${++id}`,
    createInvitationToken: () => `raw-secret-${++id}`,
  });
  return { api, db, sqlite };
}

function transferOwnershipBeforeMemberDelete(db, sqlite) {
  let intercepted = false;
  return {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            all: () => bound.all(),
            async run() {
              if (!intercepted && sql.includes('DELETE FROM household_members')) {
                intercepted = true;
                sqlite.exec(`
                  BEGIN;
                  UPDATE household_members SET role = 'admin' WHERE household_id = 10 AND user_id = 1;
                  UPDATE household_members SET role = 'owner' WHERE household_id = 10 AND user_id = 4;
                  COMMIT;
                `);
              }
              return bound.run();
            },
          };
        },
      };
    },
  };
}

const users = {
  a: identity('sub-a', 'a@example.com', 'User A'),
  b: identity('sub-b', 'b@example.com', 'User B'),
  admin: identity('sub-admin', 'admin@example.com', 'Admin'),
  member: identity('sub-member', 'member@example.com', 'Member'),
  viewer: identity('sub-viewer', 'viewer@example.com', 'Viewer'),
  invitee: identity('sub-invitee', 'INVITEE@EXAMPLE.COM', 'Invitee'),
};

test('GET /api/me requires verified identity and returns only the app profile', async () => {
  const { api } = setup();
  assert.deepEqual(await result(await api.me(request('/api/me'))), {
    status: 401,
    body: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' },
  });
  assert.deepEqual(await result(await api.me(request('/api/me', { user: users.a }))), {
    status: 200,
    body: { user: { id: 'usr_a', email: 'a@example.com', displayName: 'User A' } },
  });
});

test('household creation is atomic, validates fields, and list is membership-scoped to active homes', async () => {
  const { api, db, sqlite } = setup();
  assert.equal((await result(await api.createHousehold(request('/api/households', {
    method: 'POST', user: users.a, json: { name: '   ' },
  })))).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM households').get().count, 3);

  const created = await result(await api.createHousehold(request('/api/households', {
    method: 'POST', user: users.a, json: {
      name: '  New Home  ', province: '  Phuket ', electricityProvider: ' PEA ', userId: 2, role: 'viewer',
    },
  })));
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.household, {
    id: 'hh_generated_1', name: 'New Home', province: 'Phuket', electricityProvider: 'PEA', role: 'owner',
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = (SELECT id FROM households WHERE public_id = 'hh_generated_1') AND user_id = 1 AND role = 'owner'").get().count, 1);

  const listedA = await result(await api.listHouseholds(request('/api/households', { user: users.a })));
  const listedB = await result(await api.listHouseholds(request('/api/households', { user: users.b })));
  assert.equal(listedA.body.userId, 'usr_a');
  assert.equal(listedB.body.userId, 'usr_b');
  assert.deepEqual(listedA.body.households.map(({ id, role }) => [id, role]), [['hh_a', 'owner'], ['hh_generated_1', 'owner']]);
  assert.deepEqual(listedB.body.households.map(({ id, role }) => [id, role]), [['hh_b', 'owner']]);

  const membershipCount = sqlite.prepare('SELECT COUNT(*) AS count FROM household_members').get().count;
  const conflictingApi = createHouseholdApi(() => db, {
    now: () => NOW,
    createHouseholdPublicId: () => 'hh_a',
  });
  assert.equal((await result(await conflictingApi.createHousehold(request('/api/households', {
    method: 'POST', user: users.a, json: { name: 'Duplicate ID' },
  })))).status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members').get().count, membershipCount);
});

test('read hides non-member IDs, update enforces owner/admin, and owner deletion hides the household', async () => {
  const { api } = setup();
  assert.deepEqual(await result(await api.getHousehold(request('/api/households/hh_a', { user: users.b }), { householdId: 'hh_a' })), {
    status: 404, body: { code: 'HOUSEHOLD_NOT_FOUND', message: 'Household was not found.' },
  });
  assert.equal((await result(await api.updateHousehold(request('/api/households/hh_a', {
    method: 'PATCH', user: users.member, json: { name: 'Nope' },
  }), { householdId: 'hh_a' }))).status, 403);
  const updated = await result(await api.updateHousehold(request('/api/households/hh_a', {
    method: 'PATCH', user: users.admin, json: { name: ' Updated A ', province: null },
  }), { householdId: 'hh_a' }));
  assert.deepEqual(updated.body.household, {
    id: 'hh_a', name: 'Updated A', province: null, electricityProvider: 'MEA', role: 'admin',
  });
  assert.equal((await result(await api.deleteHousehold(request('/api/households/hh_a', {
    method: 'DELETE', user: users.admin,
  }), { householdId: 'hh_a' }))).status, 403);
  assert.equal((await api.deleteHousehold(request('/api/households/hh_a', {
    method: 'DELETE', user: users.a,
  }), { householdId: 'hh_a' })).status, 204);
  assert.equal((await result(await api.getHousehold(request('/api/households/hh_a', { user: users.a }), { householdId: 'hh_a' }))).status, 404);
});

test('member listing exposes public profiles and role updates enforce the complete role matrix', async () => {
  const { api } = setup();
  const listed = await result(await api.listMembers(request('/api/households/hh_a/members', { user: users.viewer }), { householdId: 'hh_a' }));
  assert.deepEqual(listed.body.members[0], {
    id: 'usr_a', email: 'a@example.com', displayName: 'User A', avatarUrl: 'https://example.test/a.png', role: 'owner',
  });
  assert.equal(Object.hasOwn(listed.body.members[0], 'userId'), false);

  assert.equal((await result(await api.updateMember(request('/api/households/hh_a/members/usr_member', {
    method: 'PATCH', user: users.admin, json: { role: 'admin' },
  }), { householdId: 'hh_a', userId: 'usr_member' }))).status, 403);
  assert.equal((await result(await api.updateMember(request('/api/households/hh_a/members/usr_member', {
    method: 'PATCH', user: users.a, json: { role: 'owner' },
  }), { householdId: 'hh_a', userId: 'usr_member' }))).status, 403);
  const changed = await result(await api.updateMember(request('/api/households/hh_a/members/usr_member', {
    method: 'PATCH', user: users.admin, json: { role: 'viewer' },
  }), { householdId: 'hh_a', userId: 'usr_member' }));
  assert.equal(changed.body.member.role, 'viewer');
});

test('generic role updates cannot target the owner or let admins manage peer admins', async () => {
  const { api, sqlite } = setup();

  for (const [actor, target, role] of [
    [users.a, 'usr_a', 'member'],
    [users.admin, 'usr_a', 'viewer'],
    [users.admin, 'usr_admin', 'member'],
  ]) {
    const response = await api.updateMember(request(`/api/households/hh_a/members/${target}`, {
      method: 'PATCH', user: actor, json: { role },
    }), { householdId: 'hh_a', userId: target });
    assert.equal(response.status, 403, `${target} targeted as ${role}`);
  }

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT role FROM household_members WHERE household_id = 10 AND user_id = 3").get().role, 'admin');
});

test('role update rejects a target whose role changed after authorization', async () => {
  const { db, sqlite } = setup();
  let intercepted = false;
  const racingDb = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            all: () => bound.all(),
            async run() {
              if (!intercepted && sql.includes('UPDATE household_members SET role = ?, updated_at')) {
                intercepted = true;
                sqlite.exec("UPDATE household_members SET role = 'admin' WHERE household_id = 10 AND user_id = 4");
              }
              return bound.run();
            },
          };
        },
      };
    },
  };
  const api = createHouseholdApi(() => racingDb, { now: () => NOW });

  const response = await api.updateMember(request('/api/households/hh_a/members/usr_member', {
    method: 'PATCH', user: users.admin, json: { role: 'viewer' },
  }), { householdId: 'hh_a', userId: 'usr_member' });

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT role FROM household_members WHERE household_id = 10 AND user_id = 4').get().role, 'admin');
});

test('member removal protects owners and self-service leave excludes owners', async () => {
  const { api, sqlite } = setup();
  assert.equal((await result(await api.removeMember(request('/api/households/hh_a/members/usr_a', {
    method: 'DELETE', user: users.a,
  }), { householdId: 'hh_a', userId: 'usr_a' }))).status, 403);
  assert.equal((await api.removeMember(request('/api/households/hh_a/members/usr_viewer', {
    method: 'DELETE', user: users.admin,
  }), { householdId: 'hh_a', userId: 'usr_viewer' })).status, 204);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 5').get().count, 0);
  assert.equal((await result(await api.leaveHousehold(request('/api/households/hh_a/leave', {
    method: 'POST', user: users.a,
  }), { householdId: 'hh_a' }))).status, 403);
  assert.equal((await api.leaveHousehold(request('/api/households/hh_a/leave', {
    method: 'POST', user: users.member,
  }), { householdId: 'hh_a' })).status, 204);
});

test('admin removal cannot delete a member promoted to owner after authorization', async () => {
  const { db, sqlite } = setup();
  const api = createHouseholdApi(() => transferOwnershipBeforeMemberDelete(db, sqlite), { now: () => NOW });

  const response = await api.removeMember(request('/api/households/hh_a/members/usr_member', {
    method: 'DELETE', user: users.admin,
  }), { householdId: 'hh_a', userId: 'usr_member' });

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT role FROM household_members WHERE household_id = 10 AND user_id = 4').get().role, 'owner');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
});

test('self leave cannot delete a member promoted to owner after authorization', async () => {
  const { db, sqlite } = setup();
  const api = createHouseholdApi(() => transferOwnershipBeforeMemberDelete(db, sqlite), { now: () => NOW });

  const response = await api.leaveHousehold(request('/api/households/hh_a/leave', {
    method: 'POST', user: users.member,
  }), { householdId: 'hh_a' });

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT role FROM household_members WHERE household_id = 10 AND user_id = 4').get().role, 'owner');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
});

test('ownership transfer atomically demotes the owner, promotes an existing member, and retains one owner', async () => {
  const { api, sqlite } = setup();
  assert.equal((await result(await api.transferOwnership(request('/api/households/hh_a/transfer-ownership', {
    method: 'POST', user: users.admin, json: { userId: 'usr_member' },
  }), { householdId: 'hh_a' }))).status, 403);
  assert.equal((await result(await api.transferOwnership(request('/api/households/hh_a/transfer-ownership', {
    method: 'POST', user: users.a, json: { userId: 'usr_b' },
  }), { householdId: 'hh_a' }))).status, 409);
  assert.equal((await api.transferOwnership(request('/api/households/hh_a/transfer-ownership', {
    method: 'POST', user: users.a, json: { userId: 'usr_member' },
  }), { householdId: 'hh_a' })).status, 200);
  assert.deepEqual(sqlite.prepare("SELECT users.public_id AS id, household_members.role FROM household_members JOIN users ON users.id = household_members.user_id WHERE household_id = 10 AND household_members.role IN ('owner', 'admin') ORDER BY users.public_id").all().map((row) => ({ ...row })), [
    { id: 'usr_a', role: 'admin' }, { id: 'usr_admin', role: 'admin' }, { id: 'usr_member', role: 'owner' },
  ]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
});

test('ownership transfer keeps the owner when the target disappears before the atomic batch', async () => {
  const { db, sqlite } = setup();
  let intercepted = false;
  const racingDb = {
    ...db,
    async batch(statements) {
      if (!intercepted) {
        intercepted = true;
        sqlite.exec('DELETE FROM household_members WHERE household_id = 10 AND user_id = 4');
      }
      return db.batch(statements);
    },
  };
  const api = createHouseholdApi(() => racingDb, { now: () => NOW });

  const response = await api.transferOwnership(request('/api/households/hh_a/transfer-ownership', {
    method: 'POST', user: users.a, json: { userId: 'usr_member' },
  }), { householdId: 'hh_a' });

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare("SELECT role FROM household_members WHERE household_id = 10 AND user_id = 1").get().role, 'owner');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
});

test('ownership transfer rolls back demotion when promotion is forced to no-op inside the batch', async () => {
  const { db, sqlite } = setup();
  const racingDb = {
    ...db,
    async batch(statements) {
      return db.batch([
        statements[0],
        db.prepare('UPDATE household_members SET role = role WHERE 0').bind(),
        ...statements.slice(2),
      ]);
    },
  };
  const api = createHouseholdApi(() => racingDb, { now: () => NOW });

  const response = await api.transferOwnership(request('/api/households/hh_a/transfer-ownership', {
    method: 'POST', user: users.a, json: { userId: 'usr_member' },
  }), { householdId: 'hh_a' });

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT role FROM household_members WHERE household_id = 10 AND user_id = 1').get().role, 'owner');
  assert.equal(sqlite.prepare('SELECT role FROM household_members WHERE household_id = 10 AND user_id = 4').get().role, 'member');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND role = 'owner'").get().count, 1);
});

test('invitation creation normalizes email, hashes the stored token, limits admin roles, and never lists secrets', async () => {
  const { api, sqlite } = setup();
  assert.equal((await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.admin, json: { email: 'new@example.com', role: 'admin' },
  }), { householdId: 'hh_a' }))).status, 403);
  assert.equal((await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'MEMBER@EXAMPLE.COM', role: 'member' },
  }), { householdId: 'hh_a' }))).status, 409);
  const created = await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: '  INVITEE@EXAMPLE.COM ', role: 'admin' },
  }), { householdId: 'hh_a' }));
  assert.equal(created.status, 201);
  assert.match(created.body.invitation.id, /^inv_[a-f0-9]{48}$/);
  assert.equal(created.body.invitation.token, 'raw-secret-1');
  assert.equal(created.body.invitation.email, 'invitee@example.com');
  const stored = sqlite.prepare('SELECT email_normalized AS email, token_hash AS tokenHash FROM household_invites').get();
  assert.equal(stored.email, 'invitee@example.com');
  assert.notEqual(stored.tokenHash, 'raw-secret-1');
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);

  const listed = await result(await api.listInvitations(request('/api/households/hh_a/invitations', { user: users.admin }), { householdId: 'hh_a' }));
  assert.equal(listed.body.invitations.length, 1);
  assert.equal(Object.hasOwn(listed.body.invitations[0], 'token'), false);
  assert.equal(Object.hasOwn(listed.body.invitations[0], 'tokenHash'), false);
});

test('invitation creation rejects an equivalent invite inserted after the pre-read', async () => {
  const { db, sqlite } = setup();
  let intercepted = false;
  const racingDb = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            all: () => bound.all(),
            async run() {
              if (!intercepted && sql.includes('INSERT INTO household_invites')) {
                intercepted = true;
                sqlite.exec(`INSERT INTO household_invites
                  (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
                  VALUES (10, 1, 'race@example.com', 'member', '${'a'.repeat(64)}', ${NOW + 10_000}, ${NOW})`);
              }
              return bound.run();
            },
          };
        },
      };
    },
  };
  const api = createHouseholdApi(() => racingDb, {
    now: () => NOW,
    createInvitationToken: () => 'raw-secret-race',
  });

  const response = await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'race@example.com', role: 'viewer' },
  }), { householdId: 'hh_a' }));

  assert.equal(response.status, 409);
  assert.equal(Object.hasOwn(response.body, 'token'), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_invites WHERE household_id = 10 AND email_normalized = 'race@example.com' AND accepted_at IS NULL AND revoked_at IS NULL").get().count, 1);
  assert.equal(sqlite.prepare("SELECT token_hash AS tokenHash FROM household_invites WHERE email_normalized = 'race@example.com'").get().tokenHash, 'a'.repeat(64));
});

test('invitation acceptance requires matching email and active unused unexpired token', async () => {
  const { api, sqlite } = setup();
  const created = await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'invitee@example.com', role: 'member' },
  }), { householdId: 'hh_a' }));
  const token = created.body.invitation.token;
  assert.equal((await result(await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.b, json: { token },
  })))).status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 2').get().count, 0);
  assert.equal((await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token },
  }))).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 6 AND role = \'member\'').get().count, 1);
  assert.equal((await result(await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token },
  })))).status, 409);

  const expiredToken = 'expired-token';
  const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
  const hiddenToken = 'hidden-token';
  const hiddenHash = createHash('sha256').update(hiddenToken).digest('hex');
  sqlite.exec(`
    INSERT INTO household_invites (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
      VALUES (20, 2, 'invitee@example.com', 'viewer', '${expiredHash}', ${NOW - 1}, 1);
    INSERT INTO household_invites (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
      VALUES (30, 1, 'invitee@example.com', 'viewer', '${hiddenHash}', ${NOW + 1000}, 1);
  `);
  assert.equal((await result(await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token: expiredToken },
  })))).status, 409);
  assert.equal((await result(await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token: hiddenToken },
  })))).status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id IN (20, 30) AND user_id = 6').get().count, 0);
});

test('invitation acceptance uses and persists the current verified email for the canonical subject', async () => {
  const { api, sqlite } = setup();
  const created = await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'new-invitee@example.com', role: 'member' },
  }), { householdId: 'hh_a' }));
  const changedIdentity = identity('sub-invitee', 'NEW-INVITEE@EXAMPLE.COM', 'Invitee');

  const accepted = await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: changedIdentity, json: { token: created.body.invitation.token },
  }));

  assert.equal(accepted.status, 200);
  assert.equal(sqlite.prepare('SELECT email FROM users WHERE id = 6').get().email, 'new-invitee@example.com');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 6').get().count, 1);
});

test('invitation acceptance does not consume or join when the household is deleted before its batch', async () => {
  const { api: baseApi, db, sqlite } = setup();
  const created = await result(await baseApi.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'invitee@example.com', role: 'viewer' },
  }), { householdId: 'hh_a' }));
  let intercepted = false;
  const racingDb = {
    ...db,
    async batch(statements) {
      if (!intercepted) {
        intercepted = true;
        sqlite.exec("UPDATE households SET status = 'deleted' WHERE id = 10");
      }
      return db.batch(statements);
    },
  };
  const api = createHouseholdApi(() => racingDb, { now: () => NOW });

  const response = await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token: created.body.invitation.token },
  }));

  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT accepted_at AS acceptedAt FROM household_invites').get().acceptedAt, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 6').get().count, 0);
});

test('revocation is household-scoped and revoked invitations cannot create memberships', async () => {
  const { api, sqlite } = setup();
  const created = await result(await api.createInvitation(request('/api/households/hh_a/invitations', {
    method: 'POST', user: users.a, json: { email: 'invitee@example.com', role: 'viewer' },
  }), { householdId: 'hh_a' }));
  const { id, token } = created.body.invitation;
  assert.equal((await result(await api.revokeInvitation(request(`/api/households/hh_b/invitations/${id}`, {
    method: 'DELETE', user: users.b,
  }), { householdId: 'hh_b', invitationId: String(id) }))).status, 409);
  assert.equal((await api.revokeInvitation(request(`/api/households/hh_a/invitations/${id}`, {
    method: 'DELETE', user: users.admin,
  }), { householdId: 'hh_a', invitationId: String(id) })).status, 204);
  assert.equal((await result(await api.acceptInvitation(request('/api/invitations/accept', {
    method: 'POST', user: users.invitee, json: { token },
  })))).status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = 10 AND user_id = 6').get().count, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHouseholdApi } from '../lib/server/household-api.ts';
import { displayUserName } from '../lib/household-ui.ts';
import { createAuthDatabase } from './d1-auth-fixture.mjs';

const NOW = 2_000_000_000_000;
const identity = {
  'x-wattwise-auth-subject': 'profile-subject',
  'x-wattwise-auth-email': 'person@example.com',
  'x-wattwise-auth-name': 'Google Person',
};

function request(method = 'GET', json) {
  return new Request('https://wattwise.test/api/me', {
    method,
    headers: { ...identity, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

async function body(response) {
  return { status: response.status, json: await response.json() };
}

function setup() {
  const { db, sqlite } = createAuthDatabase();
  sqlite.exec(`
    INSERT INTO users (id, public_id, email, display_name, created_at, updated_at)
      VALUES (1, 'usr_profile', 'person@example.com', 'Google Person', 1, 1);
    INSERT INTO user_identities (user_id, provider, subject, created_at)
      VALUES (1, 'cloudflare-access', 'profile-subject', 1);
  `);
  return { api: createHouseholdApi(() => db, { now: () => NOW }), sqlite };
}

test('current user requires one display-name confirmation and never exposes email as the display label', async () => {
  const { api } = setup();
  const current = await body(await api.me(request()));

  assert.equal(current.status, 200);
  assert.deepEqual(current.json.user, {
    id: 'usr_profile',
    email: 'person@example.com',
    displayName: 'Google Person',
    needsDisplayName: true,
  });
  assert.equal(displayUserName({ ...current.json.user, displayName: null }), 'ผู้ใช้');
});

test('updating the profile trims and persists the display name and marks onboarding complete', async () => {
  const { api, sqlite } = setup();
  const updated = await body(await api.updateMe(request('PATCH', { displayName: '  ปาริชาติ  ' })));

  assert.equal(updated.status, 200);
  assert.deepEqual(updated.json.user, {
    id: 'usr_profile',
    email: 'person@example.com',
    displayName: 'ปาริชาติ',
    needsDisplayName: false,
  });
  assert.deepEqual({ ...sqlite.prepare('SELECT display_name AS displayName, display_name_confirmed_at AS confirmedAt, updated_at AS updatedAt FROM users WHERE id = 1').get() }, {
    displayName: 'ปาริชาติ', confirmedAt: NOW, updatedAt: NOW,
  });
});

test('profile update rejects blank, email-shaped, and overlong display names', async () => {
  const { api } = setup();
  for (const displayName of ['   ', 'new@example.com', 'ก'.repeat(51)]) {
    const response = await api.updateMe(request('PATCH', { displayName }));
    assert.equal(response.status, 400, displayName);
  }
});

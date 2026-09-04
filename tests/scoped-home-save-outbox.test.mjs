import assert from 'node:assert/strict';
import test from 'node:test';

const outbox = await import('../lib/home-save-outbox.ts').catch(() => ({}));

function storage(initial = []) {
  const values = new Map(initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function item(id) {
  return {
    id,
    instanceId: `${id}-1`,
    brand: 'Brand',
    model: 'Model',
    name: 'Device',
    detail: 'Detail',
    image: '/device.png',
    usageProfileId: 'television',
    watts: 100,
    quantity: 1,
    hoursPerDay: 4,
    cyclesPerMonth: null,
    usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } },
  };
}

const userAHome1 = { userId: 'user/a', householdId: 'home:1' };
const userBHome1 = { userId: 'user/b', householdId: 'home:1' };
const userAHome2 = { userId: 'user/a', householdId: 'home:2' };
const body = (id) => JSON.stringify({ items: [item(id)] });

test('v3 outbox and lock namespaces include encoded user and household identities', () => {
  assert.equal(typeof outbox.homeSaveOutboxKey, 'function');
  assert.equal(typeof outbox.homeSaveLockName, 'function');

  assert.equal(outbox.homeSaveOutboxKey(userAHome1), 'wattwise.home-save-outbox.v3:user%2Fa:home%3A1');
  assert.equal(outbox.homeSaveLockName(userAHome1), 'wattwise.home-save-lock.v3:user%2Fa:home%3A1');
  assert.notEqual(outbox.homeSaveOutboxKey(userAHome1), outbox.homeSaveOutboxKey(userBHome1));
  assert.notEqual(outbox.homeSaveOutboxKey(userAHome1), outbox.homeSaveOutboxKey(userAHome2));
  assert.notEqual(outbox.homeSaveLockName(userAHome1), outbox.homeSaveLockName(userBHome1));
  assert.notEqual(outbox.homeSaveLockName(userAHome1), outbox.homeSaveLockName(userAHome2));
});

test('a scoped draft cannot be read or cleared from another user or household', () => {
  const localStorage = storage();
  const pending = outbox.stageScopedPendingHomeSave(localStorage, userAHome1, 7, body('private'), 100);

  assert.equal(outbox.readScopedPendingHomeSave(localStorage, userBHome1), null);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, userAHome2), null);
  outbox.clearScopedPendingHomeSave(localStorage, userBHome1, pending);
  outbox.clearScopedPendingHomeSave(localStorage, userAHome2, pending);
  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, userAHome1), pending);
});

test('v3 rejects mismatched, unsafe, malformed, and oversized envelopes only at their target key', () => {
  const validOther = {
    version: 3,
    ...userBHome1,
    expectedRevision: 2,
    body: body('other'),
    updatedAt: 20,
  };
  const cases = [
    { version: 3, ...userBHome1, expectedRevision: 0, body: body('copied'), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: -1, body: body('negative'), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0.5, body: body('fractional'), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: Number.MAX_SAFE_INTEGER + 1, body: body('unsafe'), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0, body: '{', updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0, body: JSON.stringify({ items: [{ ...item('blank'), instanceId: '   ' }] }), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0, body: JSON.stringify({ items: [{ ...item('quantity'), quantity: 100 }] }), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0, body: JSON.stringify({ items: [item('duplicate'), item('duplicate')] }), updatedAt: 1 },
    { version: 3, ...userAHome1, expectedRevision: 0, body: JSON.stringify({ items: Array.from({ length: 101 }, (_, i) => item(String(i))) }), updatedAt: 1 },
  ];

  for (const candidate of cases) {
    const localStorage = storage([
      [outbox.homeSaveOutboxKey(userAHome1), JSON.stringify(candidate)],
      [outbox.homeSaveOutboxKey(userBHome1), JSON.stringify(validOther)],
    ]);
    assert.equal(outbox.readScopedPendingHomeSave(localStorage, userAHome1), null);
    assert.equal(localStorage.getItem(outbox.homeSaveOutboxKey(userAHome1)), null);
    assert.equal(localStorage.getItem(outbox.homeSaveOutboxKey(userBHome1)), JSON.stringify(validOther));
  }
});

test('scoped reads ignore ambiguous v1 and v2 drafts', () => {
  const legacy = body('legacy');
  const localStorage = storage([
    [outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, legacy],
    [outbox.HOME_SAVE_OUTBOX_KEY, JSON.stringify({ version: 2, body: legacy })],
  ]);

  assert.equal(outbox.readScopedPendingHomeSave(localStorage, userAHome1), null);
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), legacy);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), JSON.stringify({ version: 2, body: legacy }));
});

test('compare-and-clear and revision rebase require the exact current envelope', () => {
  const localStorage = storage();
  const older = outbox.stageScopedPendingHomeSave(localStorage, userAHome1, 3, body('older'), 100);
  const newer = outbox.stageScopedPendingHomeSave(localStorage, userAHome1, 3, body('newer'), 101);

  assert.equal(outbox.clearScopedPendingHomeSave(localStorage, userAHome1, older), false);
  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, userAHome1), newer);
  assert.equal(outbox.rebaseScopedPendingHomeSave(localStorage, userAHome1, older, 4, 102), null);
  const rebased = outbox.rebaseScopedPendingHomeSave(localStorage, userAHome1, newer, 4, 102);
  assert.deepEqual(rebased, { ...newer, expectedRevision: 4, updatedAt: 102 });
  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, userAHome1), rebased);
  assert.equal(outbox.clearScopedPendingHomeSave(localStorage, userAHome1, rebased), true);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, userAHome1), null);
});

test('a scoped envelope reconstructs the Task 4 PUT body without losing revision', () => {
  const localStorage = storage();
  const pending = outbox.stageScopedPendingHomeSave(localStorage, userAHome1, 9, body('save'), 100);

  assert.deepEqual(JSON.parse(outbox.scopedPendingHomeSaveRequestBody(pending)), {
    expectedRevision: 9,
    items: [item('save')],
  });
});

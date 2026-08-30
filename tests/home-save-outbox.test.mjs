import assert from 'node:assert/strict';
import test from 'node:test';

const outbox = await import('../lib/home-save-outbox.ts').catch(() => ({}));

function storage() {
  const values = new Map();
  return {
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

function quotaFailingStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === outbox.HOME_SAVE_OUTBOX_KEY) {
        const error = new Error('Quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

function v1ReplacingStorage(initialLegacyBody, replacementLegacyBody) {
  const values = new Map([[outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, initialLegacyBody]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      if (key === outbox.HOME_SAVE_OUTBOX_KEY) values.set(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, replacementLegacyBody);
    },
    removeItem: (key) => values.delete(key),
  };
}

function envelope(body, version = 2) {
  return JSON.stringify({ version, body });
}

test('outbox keeps the latest body and only clears the matching body', () => {
  assert.equal(typeof outbox.stagePendingHomeSave, 'function');
  const localStorage = storage();
  const first = JSON.stringify({ items: [item('first')] });
  const latest = JSON.stringify({ items: [item('latest')] });

  outbox.stagePendingHomeSave(localStorage, first);
  assert.deepEqual(JSON.parse(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY)), { version: 2, body: first });
  outbox.stagePendingHomeSave(localStorage, latest);
  outbox.clearPendingHomeSave(localStorage, first);
  assert.equal(outbox.readPendingHomeSave(localStorage), latest);
  outbox.clearPendingHomeSave(localStorage, latest);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('outbox rejects malformed or oversized pending payloads', () => {
  assert.equal(typeof outbox.readPendingHomeSave, 'function');
  const localStorage = storage();
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, '');
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, '{bad-json');
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, envelope(JSON.stringify({ items: 'not-an-array' })));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, envelope(JSON.stringify({ items: [null] })));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, envelope(JSON.stringify({ items: Array.from({ length: 101 }, () => ({})) })));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
});

test('initial confirmed state preserves another tab pending body when this tab owns none', () => {
  const localStorage = storage();
  const confirmed = JSON.stringify({ items: [item('confirmed')] });
  const newer = JSON.stringify({ items: [item('newer')] });

  outbox.stagePendingHomeSave(localStorage, newer);

  assert.equal(outbox.syncPendingHomeSave(localStorage, confirmed, confirmed, null), null);
  assert.equal(outbox.readPendingHomeSave(localStorage), newer);
});

test('reverting this tab owned edit clears only its pending body', () => {
  const localStorage = storage();
  const confirmed = JSON.stringify({ items: [item('confirmed')] });
  const owned = JSON.stringify({ items: [item('owned')] });

  outbox.stagePendingHomeSave(localStorage, owned);

  assert.equal(outbox.syncPendingHomeSave(localStorage, confirmed, confirmed, owned), null);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('reverting this tab owned edit preserves a newer body from another tab', () => {
  const localStorage = storage();
  const confirmed = JSON.stringify({ items: [item('confirmed')] });
  const owned = JSON.stringify({ items: [item('owned')] });
  const newer = JSON.stringify({ items: [item('newer')] });

  outbox.stagePendingHomeSave(localStorage, owned);
  outbox.stagePendingHomeSave(localStorage, newer);

  assert.equal(outbox.syncPendingHomeSave(localStorage, confirmed, confirmed, owned), null);
  assert.equal(outbox.readPendingHomeSave(localStorage), newer);
});

test('an older save completion preserves a newer tab body', () => {
  const localStorage = storage();
  const older = JSON.stringify({ items: [item('older')] });
  const newer = JSON.stringify({ items: [item('newer')] });

  outbox.stagePendingHomeSave(localStorage, older);
  outbox.stagePendingHomeSave(localStorage, newer);
  outbox.clearPendingHomeSave(localStorage, older);

  assert.equal(outbox.readPendingHomeSave(localStorage), newer);
});

test('staging preserves a v1 value replaced while v2 is persisted', () => {
  const previous = JSON.stringify({ items: [item('previous')] });
  const newer = JSON.stringify({ items: [item('newer')] });
  const localStorage = v1ReplacingStorage(previous, newer);

  outbox.stagePendingHomeSave(localStorage, JSON.stringify({ items: [item('current')] }));

  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), newer);
});

test('migration preserves a v1 value replaced while v2 is persisted', () => {
  const previous = JSON.stringify({ items: [item('previous')] });
  const newer = JSON.stringify({ items: [item('newer')] });
  const localStorage = v1ReplacingStorage(previous, newer);

  assert.equal(outbox.readPendingHomeSave(localStorage), previous);
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), newer);
});

test('migrates a valid v1 rice-cooker body to the v2 retry envelope', () => {
  const localStorage = storage();
  const legacy = item('legacy-rice');
  legacy.usageProfileId = 'rice_cooker';
  legacy.hoursPerDay = null;
  legacy.cyclesPerMonth = 30;
  legacy.usageSchedule = { kind: 'periods', periods: ['morning'] };
  localStorage.setItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, JSON.stringify({ items: [legacy] }));

  const migratedBody = outbox.readPendingHomeSave(localStorage);
  const migrated = JSON.parse(migratedBody);

  assert.equal(migrated.items[0].usageProfileId, 'rice_cooker_hours');
  assert.equal(migrated.items[0].hoursPerDay, 1);
  assert.equal(migrated.items[0].cyclesPerMonth, null);
  assert.deepEqual(migrated.items[0].usageSchedule, {
    kind: 'hours', hoursByPeriod: { night: 0, morning: 1, daytime: 0, evening: 0 },
  });
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), null);
  assert.deepEqual(JSON.parse(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY)), {
    version: 2,
    body: migratedBody,
  });
  outbox.clearPendingHomeSave(localStorage, migratedBody);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('keeps a valid v1 retry body when writing its v2 migration exceeds quota', () => {
  const localStorage = quotaFailingStorage();
  const legacy = item('legacy-quota');
  localStorage.setItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, JSON.stringify({ items: [legacy] }));

  const retryBody = outbox.readPendingHomeSave(localStorage);

  assert.equal(retryBody, JSON.stringify({ items: [legacy] }));
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), retryBody);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
  outbox.clearPendingHomeSave(localStorage, retryBody);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('clears a retained transformed rice v1 body after its canonical save succeeds', () => {
  const localStorage = quotaFailingStorage();
  const legacy = {
    ...item('legacy-rice-quota'),
    usageProfileId: 'rice_cooker',
    hoursPerDay: null,
    cyclesPerMonth: 30,
    usageSchedule: { kind: 'periods', periods: ['morning'] },
  };
  const legacyBody = JSON.stringify({ items: [legacy] });
  localStorage.setItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, legacyBody);

  const retryBody = outbox.readPendingHomeSave(localStorage);

  assert.equal(JSON.parse(retryBody).items[0].usageProfileId, 'rice_cooker_hours');
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), legacyBody);
  outbox.clearPendingHomeSave(localStorage, retryBody);
  assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), null);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('accepts nullable watts with annual and per-cycle energy specs', () => {
  const localStorage = storage();
  const annual = { ...item('annual'), watts: null, energySpec: { calculationMethod: 'annual_energy', annualEnergyKwh: 365 } };
  const perCycle = {
    ...item('cycle'),
    watts: null,
    cyclesPerMonth: 12,
    energySpec: { calculationMethod: 'per_cycle', energyPerCycleKwh: 1.25 },
  };
  const body = JSON.stringify({ items: [annual, perCycle] });

  outbox.stagePendingHomeSave(localStorage, body);

  assert.equal(outbox.readPendingHomeSave(localStorage), body);
});

test('reads canonical integer quantities and clears their original v2 representation', () => {
  const localStorage = storage();
  const body = JSON.stringify({ items: [
    { ...item('same-model'), instanceId: 'same-model-1', quantity: 100, usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 4, daytime: 0, evening: 0 } } },
    { ...item('same-model'), instanceId: 'same-model-2', quantity: 1.5, usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } } },
  ] });

  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, envelope(body));

  const retryBody = outbox.readPendingHomeSave(localStorage);
  const retry = JSON.parse(retryBody);

  assert.deepEqual(retry.items.map((entry) => ({ instanceId: entry.instanceId, quantity: entry.quantity, usageSchedule: entry.usageSchedule })), [
    { instanceId: 'same-model-1', quantity: 99, usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 4, daytime: 0, evening: 0 } } },
    { instanceId: 'same-model-2', quantity: 2, usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } } },
  ]);

  outbox.clearPendingHomeSave(localStorage, retryBody);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
});

test('removes nonpositive durable quantities instead of retrying an invalid save', () => {
  const localStorage = storage();
  const body = JSON.stringify({ items: [{ ...item('invalid-quantity'), quantity: 0 }] });

  outbox.stagePendingHomeSave(localStorage, body);

  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
});

test('removes v2 payloads with malformed energy-spec unions', () => {
  for (const energySpec of [
    { calculationMethod: 'annual_energy' },
    { calculationMethod: 'per_cycle', energyPerCycleKwh: '1.25' },
    { calculationMethod: 'rated_power', ratedPowerW: null },
    { calculationMethod: 'unknown', ratedPowerW: 100 },
  ]) {
    const localStorage = storage();
    const body = JSON.stringify({ items: [{ ...item('bad'), energySpec }] });
    outbox.stagePendingHomeSave(localStorage, body);

    assert.equal(outbox.readPendingHomeSave(localStorage), null);
    assert.equal(localStorage.getItem(outbox.HOME_SAVE_OUTBOX_KEY), null);
  }
});

test('removes malformed and oversized legacy payloads during migration', () => {
  for (const body of [
    '',
    '{bad-json',
    JSON.stringify({ items: [null] }),
    JSON.stringify({ items: Array.from({ length: 101 }, () => item('too-many')) }),
  ]) {
    const localStorage = storage();
    localStorage.setItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY, body);

    assert.equal(outbox.readPendingHomeSave(localStorage), null);
    assert.equal(localStorage.getItem(outbox.LEGACY_HOME_SAVE_OUTBOX_KEY), null);
  }
});

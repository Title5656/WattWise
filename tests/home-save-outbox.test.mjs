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

test('keeps structurally valid server-rejected quantities durable for retry', () => {
  const localStorage = storage();
  const body = JSON.stringify({ items: [{ ...item('too-many-units'), quantity: 100 }] });

  outbox.stagePendingHomeSave(localStorage, body);

  assert.equal(outbox.readPendingHomeSave(localStorage), body);
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

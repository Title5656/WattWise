import assert from 'node:assert/strict';
import test from 'node:test';

import { createHomeDatabase, insertSaved } from './d1-home-fixture.mjs';

const homeStorage = await import('../lib/home-storage.ts').catch(() => ({}));

test('hydrates active and inactive saved models from D1 with honest energy specs', async () => {
  const { db, sqlite } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'active-annual', quantity: 2 });
  insertSaved(sqlite, {
    applianceKey: 'inactive-cycle',
    quantity: 3,
    cyclesPerMonth: 7,
    usageSchedule: JSON.stringify({ kind: 'periods', periods: ['daytime'] }),
    position: 1,
  });

  const items = await homeStorage.readSavedHomeItems(db);

  assert.deepEqual(items.map((item) => item.id), ['active-annual', 'inactive-cycle']);
  assert.deepEqual(items[0].energySpec, { calculationMethod: 'annual_energy', annualEnergyKwh: 365 });
  assert.deepEqual(items[1].energySpec, { calculationMethod: 'per_cycle', energyPerCycleKwh: 1.25 });
  assert.equal(items[0].watts, null);
  assert.equal(items[1].watts, null);
  assert.equal(items[1].cyclesPerMonth, 7);
  assert.deepEqual(items[1].source, {
    name: 'EGAT', url: 'https://example.test/cycle', verifiedAt: 102, confidence: 'medium',
  });
});

test('surfaces an unknown saved appliance key instead of dropping the row', async () => {
  const { db, sqlite } = createHomeDatabase();
  insertSaved(sqlite, { applianceKey: 'missing-model' });

  await assert.rejects(homeStorage.readSavedHomeItems(db), /Unknown saved appliance key: missing-model/);
});

test('maps incompatible legacy rice-cooker schedules to one morning hour', async () => {
  const { db, sqlite } = createHomeDatabase();
  insertSaved(sqlite, {
    applianceKey: 'legacy-rice',
    hoursPerDay: 0,
    cyclesPerMonth: 30,
    usageSchedule: JSON.stringify({ kind: 'periods', periods: ['morning'] }),
  });

  const [item] = await homeStorage.readSavedHomeItems(db);

  assert.equal(item.usageProfileId, 'rice_cooker_hours');
  assert.equal(item.hoursPerDay, 1);
  assert.equal(item.cyclesPerMonth, null);
  assert.deepEqual(item.usageSchedule, {
    kind: 'hours',
    hoursByPeriod: { night: 0, morning: 1, daytime: 0, evening: 0 },
  });
});

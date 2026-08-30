import assert from 'node:assert/strict';
import test from 'node:test';

import { applianceCatalog, createHomeItem } from '../lib/home-config.ts';
import { readHomeResponse } from '../lib/home-response.ts';

test('keeps home items and summary when monthly history storage is unavailable', async () => {
  const item = createHomeItem(applianceCatalog[0]);
  const unavailableDb = {
    prepare() {
      throw new Error('no such table: monthly_energy_records');
    },
  };

  const response = await readHomeResponse(unavailableDb, 'default-home', [item], 0, () => undefined);

  assert.deepEqual(response.items, [item]);
  assert.equal(response.summary.totalUnits, 1);
  assert.deepEqual(response.history, []);
});

test('keeps an empty home response when clearing stale monthly history fails', async () => {
  const unavailableDb = {
    prepare() {
      throw new Error('no such table: monthly_energy_records');
    },
  };

  const response = await readHomeResponse(unavailableDb, 'default-home', [], 0, () => undefined);

  assert.deepEqual(response.items, []);
  assert.equal(response.summary.totalUnits, 0);
  assert.deepEqual(response.history, []);
});

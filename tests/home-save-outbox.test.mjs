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

test('outbox keeps the latest body and only clears the matching body', () => {
  assert.equal(typeof outbox.stagePendingHomeSave, 'function');
  const localStorage = storage();
  const first = JSON.stringify({ items: [item('first')] });
  const latest = JSON.stringify({ items: [item('latest')] });

  outbox.stagePendingHomeSave(localStorage, first);
  outbox.stagePendingHomeSave(localStorage, latest);
  outbox.clearPendingHomeSave(localStorage, first);
  assert.equal(outbox.readPendingHomeSave(localStorage), latest);
  outbox.clearPendingHomeSave(localStorage, latest);
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

test('outbox rejects malformed or oversized pending payloads', () => {
  assert.equal(typeof outbox.readPendingHomeSave, 'function');
  const localStorage = storage();
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, '{bad-json');
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, JSON.stringify({ items: 'not-an-array' }));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, JSON.stringify({ items: [null] }));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
  localStorage.setItem(outbox.HOME_SAVE_OUTBOX_KEY, JSON.stringify({ items: Array.from({ length: 101 }, () => ({})) }));
  assert.equal(outbox.readPendingHomeSave(localStorage), null);
});

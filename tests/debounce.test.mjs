import assert from 'node:assert/strict';
import test from 'node:test';

test('debounce runs once with the latest arguments', async () => {
  const { debounce } = await import('../lib/debounce.ts').catch(() => ({}));
  assert.equal(typeof debounce, 'function');

  const calls = [];
  const save = debounce((value) => calls.push(value), 10);
  save('first');
  save('latest');

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(calls, ['latest']);
});

test('debounce cancellation prevents a pending call', async () => {
  const { debounce } = await import('../lib/debounce.ts').catch(() => ({}));
  assert.equal(typeof debounce, 'function');

  const calls = [];
  const save = debounce(() => calls.push('saved'), 10);
  save();
  save.cancel();

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(calls, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

const lifecycleModule = await import('../lib/dashboard-lifecycle.ts').catch(() => ({}));

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function callbacks({ closeForm = false } = {}) {
  const calls = { history: 0, form: 0, error: 0, saving: 0, refresh: 0 };
  return {
    calls,
    onSuccess: () => {
      calls.history += 1;
      if (closeForm) calls.form += 1;
    },
    onError: () => { calls.error += 1; },
    onSettled: () => { calls.saving += 1; },
    refresh: async () => { calls.refresh += 1; },
  };
}

test('pending bill PUT completion after unmount cannot update state or begin a refresh', async () => {
  assert.equal(typeof lifecycleModule.createDashboardLifecycle, 'function');
  assert.equal(typeof lifecycleModule.runDashboardMutation, 'function');
  const lifecycle = lifecycleModule.createDashboardLifecycle();
  const generation = lifecycle.mount();
  const response = deferred();
  const observers = callbacks({ closeForm: true });
  const pending = lifecycleModule.runDashboardMutation({
    lifecycle,
    generation,
    request: () => response.promise,
    failureMessage: 'บันทึกบิลจริงไม่สำเร็จ',
    ...observers,
  });

  lifecycle.unmount(generation);
  response.resolve({ ok: true, json: async () => ({ records: [{ billingMonth: '2026-08' }] }) });
  await pending;

  assert.deepEqual(observers.calls, { history: 0, form: 0, error: 0, saving: 0, refresh: 0 });
});

test('pending bill DELETE JSON completion after unmount cannot update state or begin a refresh', async () => {
  const lifecycle = lifecycleModule.createDashboardLifecycle();
  const generation = lifecycle.mount();
  const body = deferred();
  const observers = callbacks();
  const pending = lifecycleModule.runDashboardMutation({
    lifecycle,
    generation,
    request: async () => ({ ok: true, json: () => body.promise }),
    failureMessage: 'ลบบิลจริงไม่สำเร็จ',
    ...observers,
  });
  await Promise.resolve();

  lifecycle.unmount(generation);
  body.resolve({ records: [] });
  await pending;

  assert.deepEqual(observers.calls, { history: 0, form: 0, error: 0, saving: 0, refresh: 0 });
});

test('mounted bill mutation applies success state, refreshes once, and settles', async () => {
  const lifecycle = lifecycleModule.createDashboardLifecycle();
  const generation = lifecycle.mount();
  const observers = callbacks({ closeForm: true });

  await lifecycleModule.runDashboardMutation({
    lifecycle,
    generation,
    request: async () => ({ ok: true, json: async () => ({ records: [] }) }),
    failureMessage: 'บันทึกบิลจริงไม่สำเร็จ',
    ...observers,
  });

  assert.deepEqual(observers.calls, { history: 1, form: 1, error: 0, saving: 1, refresh: 1 });
});

test('StrictMode remount does not make an obsolete lifecycle generation current again', () => {
  const lifecycle = lifecycleModule.createDashboardLifecycle();
  const first = lifecycle.mount();
  lifecycle.unmount(first);
  const second = lifecycle.mount();

  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
});

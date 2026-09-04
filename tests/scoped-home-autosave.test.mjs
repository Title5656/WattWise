import assert from 'node:assert/strict';
import test from 'node:test';

const autosave = await import('../lib/scoped-home-autosave.ts').catch(() => ({}));
const outbox = await import('../lib/home-save-outbox.ts').catch(() => ({}));

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function scheduler() {
  const pending = new Set();
  return {
    set(callback) {
      const handle = { callback };
      pending.add(handle);
      return handle;
    },
    clear(handle) { pending.delete(handle); },
    flush() {
      const callbacks = [...pending];
      pending.clear();
      for (const handle of callbacks) handle.callback();
    },
    get size() { return pending.size; },
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

const scopeA1 = { userId: 'user-a', householdId: 'house-1' };
const scopeA2 = { userId: 'user-a', householdId: 'house-2' };
const scopeB1 = { userId: 'user-b', householdId: 'house-1' };
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function createController({ localStorage = storage(), timer = scheduler(), fetch, locks, now } = {}) {
  return {
    localStorage,
    timer,
    controller: autosave.createScopedHomeAutosaveController({
      storage: localStorage,
      fetch,
      locks,
      scheduler: timer,
      debounceMs: 300,
      now: now ?? (() => 100),
    }),
  };
}

test('account and household switches abort old loads and only hydrate the latest scope', async () => {
  assert.equal(typeof autosave.createScopedHomeAutosaveController, 'function');
  for (const nextScope of [scopeB1, scopeA2]) {
    const requests = [];
    const first = deferred();
    const second = deferred();
    const { controller } = createController({
      fetch: (url, init) => {
        requests.push({ url, init });
        return requests.length === 1 ? first.promise : second.promise;
      },
    });

    const firstActivation = controller.activate(scopeA1);
    const secondActivation = controller.activate(nextScope);
    assert.equal(requests[0].init.signal.aborted, true);
    assert.match(requests[1].url, new RegExp(`/api/households/${nextScope.householdId}/home$`));

    first.resolve(response(200, { householdId: scopeA1.householdId, revision: 1, items: [item('old')] }));
    second.resolve(response(200, { householdId: nextScope.householdId, revision: 4, items: [item('new')] }));
    await Promise.all([firstActivation, secondActivation]);

    assert.equal(controller.getState().scope.userId, nextScope.userId);
    assert.equal(controller.getState().scope.householdId, nextScope.householdId);
    assert.deepEqual(controller.getState().items, [item('new')]);
    assert.equal(controller.getState().revision, 4);
  }
});

test('activation revalidates an existing scoped draft against the authoritative Home revision before saving', async () => {
  const localStorage = storage();
  const timer = scheduler();
  outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    5,
    JSON.stringify({ items: [item('draft')] }),
    90,
  );
  const calls = [];
  const { controller } = createController({
    localStorage,
    timer,
    fetch: async (_url, init = {}) => {
      calls.push(init);
      return init.method === 'PUT'
        ? response(200, { revision: 6, items: [item('draft')] })
        : response(200, { revision: 5, items: [item('server')] });
    },
  });

  await controller.activate(scopeA1);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, undefined);
  assert.deepEqual(controller.getState().items, [item('draft')]);
  assert.equal(controller.getState().revision, 5);
  assert.equal(controller.getState().phase, 'ready');
  assert.equal(timer.size, 1);
  timer.flush();
  await flushPromises();
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
});

test('editing an existing draft while its authoritative GET is pending cannot PUT before revision validation', async () => {
  const localStorage = storage();
  const timer = scheduler();
  outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    5,
    JSON.stringify({ items: [item('draft')] }),
    90,
  );
  const loading = deferred();
  const puts = [];
  const { controller } = createController({
    localStorage,
    timer,
    fetch: async (_url, init = {}) => {
      if (init.method === 'PUT') {
        puts.push(JSON.parse(init.body));
        return response(200, { revision: 6, items: [item('edited')] });
      }
      return loading.promise;
    },
  });

  const activation = controller.activate(scopeA1);
  assert.equal(controller.edit([item('edited')]), true);
  timer.flush();
  await flushPromises();
  assert.equal(puts.length, 0);

  loading.resolve(response(200, { revision: 5, items: [item('server')] }));
  await activation;
  timer.flush();
  await flushPromises();

  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0], { expectedRevision: 5, items: [item('edited')] });
});

test('an existing draft with a stale revision becomes a non-retrying conflict', async () => {
  const localStorage = storage();
  const timer = scheduler();
  const draft = outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    5,
    JSON.stringify({ items: [item('draft')] }),
    90,
  );
  let puts = 0;
  const { controller } = createController({
    localStorage,
    timer,
    fetch: async (_url, init = {}) => {
      if (init.method === 'PUT') puts += 1;
      return response(200, { revision: 7, items: [item('server')] });
    },
  });

  await controller.activate(scopeA1);
  timer.flush();
  await flushPromises();

  assert.equal(controller.getState().phase, 'conflict');
  assert.equal(controller.getState().revision, 5);
  assert.equal(controller.getState().currentRevision, 7);
  assert.deepEqual(controller.getState().items, [item('draft')]);
  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), draft);
  assert.equal(puts, 0);
});

test('activation clears a stale-revision draft when the server already contains the same snapshot', async () => {
  const localStorage = storage();
  const timer = scheduler();
  outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    5,
    JSON.stringify({ items: [item('already-saved')] }),
    90,
  );
  let puts = 0;
  const { controller } = createController({
    localStorage,
    timer,
    fetch: async (_url, init = {}) => {
      if (init.method === 'PUT') puts += 1;
      return response(200, { revision: 7, items: [item('already-saved')] });
    },
  });

  await controller.activate(scopeA1);
  timer.flush();
  await flushPromises();

  assert.equal(controller.getState().phase, 'saved');
  assert.equal(controller.getState().revision, 7);
  assert.deepEqual(controller.getState().items, [item('already-saved')]);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1), null);
  assert.equal(puts, 0);
  assert.equal(controller.edit([item('next-edit')]), true);
});

test('retry after pending-draft GET failure revalidates with GET before any PUT', async () => {
  const localStorage = storage();
  const timer = scheduler();
  outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    2,
    JSON.stringify({ items: [item('draft')] }),
    90,
  );
  const calls = [];
  let gets = 0;
  const { controller } = createController({
    localStorage,
    timer,
    fetch: async (_url, init = {}) => {
      calls.push(init);
      if (init.method === 'PUT') return response(200, { revision: 3, items: [item('draft')] });
      gets += 1;
      return gets === 1
        ? response(503, { error: 'unavailable' })
        : response(200, { revision: 2, items: [item('server')] });
    },
  });

  await controller.activate(scopeA1);
  assert.equal(controller.getState().phase, 'retryable-error');
  controller.retry();
  await flushPromises();

  assert.deepEqual(calls.map((call) => call.method), [undefined, undefined]);
  assert.equal(controller.getState().phase, 'ready');
  timer.flush();
  await flushPromises();
  assert.deepEqual(calls.map((call) => call.method), [undefined, undefined, 'PUT']);
});

test('403 and 404 Home access failures preserve drafts in a terminal access-denied state', async () => {
  for (const status of [403, 404]) {
    const localStorage = storage();
    const timer = scheduler();
    const draft = outbox.stageScopedPendingHomeSave(
      localStorage,
      scopeA1,
      2,
      JSON.stringify({ items: [item(`draft-${status}`)] }),
      90,
    );
    let calls = 0;
    const { controller } = createController({
      localStorage,
      timer,
      fetch: async () => {
        calls += 1;
        return response(status, { error: 'denied' });
      },
    });

    await controller.activate(scopeA1);
    controller.retry();
    timer.flush();
    await flushPromises();

    assert.equal(controller.getState().phase, 'access-denied');
    assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), draft);
    assert.equal(calls, 1);
  }
});

test('Task 7 can observe state, unsubscribe, and discard a conflict draft before authoritative reload', async () => {
  const localStorage = storage();
  outbox.stageScopedPendingHomeSave(
    localStorage,
    scopeA1,
    1,
    JSON.stringify({ items: [item('draft')] }),
    90,
  );
  let revision = 2;
  const { controller } = createController({
    localStorage,
    fetch: async () => response(200, { revision, items: [item('server')] }),
  });
  const phases = [];
  const unsubscribe = controller.subscribe((state) => phases.push(state.phase));
  await controller.activate(scopeA1);
  assert.equal(controller.getState().phase, 'conflict');

  revision = 3;
  await controller.discardDraftAndReload();
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1), null);
  assert.equal(controller.getState().phase, 'saved');
  assert.equal(controller.getState().revision, 3);
  assert.deepEqual(controller.getState().items, [item('server')]);

  const observedCount = phases.length;
  unsubscribe();
  controller.logout();
  assert.equal(phases.length, observedCount);
});

test('switching scope cancels debounce and preserves the old scoped draft without saving it as the new scope', async () => {
  const calls = [];
  const { controller, localStorage, timer } = createController({
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return response(200, { revision: url.includes('house-2') ? 2 : 1, items: [] });
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('private-a1')]);
  const oldDraft = outbox.readScopedPendingHomeSave(localStorage, scopeA1);

  await controller.activate(scopeA2);
  timer.flush();
  await flushPromises();

  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), oldDraft);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA2), null);
  assert.equal(calls.filter((call) => call.init.method === 'PUT').length, 0);
});

test('logout and unmount abort in-flight saves and stale completions cannot clear drafts or update state', async () => {
  for (const stop of ['logout', 'dispose']) {
    const save = deferred();
    let saveSignal;
    const { controller, localStorage, timer } = createController({
      fetch: async (_url, init = {}) => {
        if (init.method === 'PUT') {
          saveSignal = init.signal;
          return save.promise;
        }
        return response(200, { revision: 0, items: [] });
      },
    });
    await controller.activate(scopeA1);
    controller.edit([item(stop)]);
    timer.flush();
    await flushPromises();
    const draft = outbox.readScopedPendingHomeSave(localStorage, scopeA1);

    if (stop === 'logout') controller.logout();
    else controller.dispose();
    assert.equal(saveSignal.aborted, true);
    save.resolve(response(200, { revision: 1, items: [item(stop)] }));
    await flushPromises();

    assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), draft);
    assert.equal(controller.getState().phase, 'idle');
    assert.equal(controller.getState().scope, null);
  }
});

test('a successful save rebases a queued edit to the returned revision', async () => {
  const firstSave = deferred();
  const secondSave = deferred();
  const puts = [];
  let timestamp = 100;
  const { controller, localStorage, timer } = createController({
    now: () => timestamp++,
    fetch: async (_url, init = {}) => {
      if (init.method !== 'PUT') return response(200, { revision: 5, items: [] });
      puts.push(JSON.parse(init.body));
      return puts.length === 1 ? firstSave.promise : secondSave.promise;
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('first')]);
  timer.flush();
  await flushPromises();
  controller.edit([item('queued')]);
  timer.flush();

  firstSave.resolve(response(200, { revision: 6, items: [item('first')] }));
  await flushPromises();

  assert.equal(puts.length, 2);
  assert.equal(puts[0].expectedRevision, 5);
  assert.equal(puts[1].expectedRevision, 6);
  assert.deepEqual(puts[1].items, [item('queued')]);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1).expectedRevision, 6);

  secondSave.resolve(response(200, { revision: 7, items: [item('queued')] }));
  await flushPromises();
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1), null);
  assert.equal(controller.getState().revision, 7);
  assert.equal(controller.getState().phase, 'saved');
});

test('reverting to the confirmed body during an in-flight PUT stages a compensating save', async () => {
  const firstSave = deferred();
  const secondSave = deferred();
  const puts = [];
  let timestamp = 100;
  const { controller, localStorage, timer } = createController({
    now: () => timestamp++,
    fetch: async (_url, init = {}) => {
      if (init.method !== 'PUT') return response(200, { revision: 4, items: [] });
      puts.push(JSON.parse(init.body));
      return puts.length === 1 ? firstSave.promise : secondSave.promise;
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('temporary')]);
  timer.flush();
  await flushPromises();

  controller.edit([]);
  assert.ok(outbox.readScopedPendingHomeSave(localStorage, scopeA1));
  firstSave.resolve(response(200, { revision: 5, items: [item('temporary')] }));
  await flushPromises();

  assert.equal(puts.length, 2);
  assert.deepEqual(puts[1], { expectedRevision: 5, items: [] });
  secondSave.resolve(response(200, { revision: 6, items: [] }));
  await flushPromises();

  assert.equal(controller.getState().phase, 'saved');
  assert.equal(controller.getState().revision, 6);
  assert.deepEqual(controller.getState().items, []);
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1), null);
});

test('409 preserves the draft, records current revision, and never retries automatically', async () => {
  let puts = 0;
  const { controller, localStorage, timer } = createController({
    fetch: async (_url, init = {}) => {
      if (init.method !== 'PUT') return response(200, { revision: 3, items: [] });
      puts += 1;
      return response(409, { code: 'HOME_REVISION_CONFLICT', currentRevision: 8 });
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('conflict')]);
  timer.flush();
  await flushPromises();
  timer.flush();
  await flushPromises();

  assert.equal(puts, 1);
  assert.equal(controller.getState().phase, 'conflict');
  assert.equal(controller.getState().currentRevision, 8);
  assert.ok(outbox.readScopedPendingHomeSave(localStorage, scopeA1));
});

test('401 preserves the draft, invalidates queued work, and cannot replay under the next identity', async () => {
  const calls = [];
  const expired = deferred();
  const { controller, localStorage, timer } = createController({
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'PUT') return expired.promise;
      return response(200, { revision: 0, items: [] });
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('first-private')]);
  timer.flush();
  await flushPromises();
  controller.edit([item('queued-private')]);
  timer.flush();
  expired.resolve(response(401, { error: 'expired' }));
  await flushPromises();

  assert.equal(controller.getState().phase, 'session-expired');
  const draft = outbox.readScopedPendingHomeSave(localStorage, scopeA1);
  assert.deepEqual(JSON.parse(draft.body).items, [item('queued-private')]);
  await controller.activate(scopeB1);
  timer.flush();
  await flushPromises();

  assert.ok(draft);
  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), draft);
  assert.equal(calls.filter((call) => call.init.method === 'PUT').length, 1);
  assert.equal(controller.getState().scope.userId, 'user-b');
});

test('network failure is retryable within the same scope and preserves its draft', async () => {
  let puts = 0;
  const { controller, localStorage, timer } = createController({
    fetch: async (_url, init = {}) => {
      if (init.method !== 'PUT') return response(200, { revision: 2, items: [] });
      puts += 1;
      return puts === 1
        ? response(503, { error: 'unavailable' })
        : response(200, { revision: 3, items: [item('retry')] });
    },
  });
  await controller.activate(scopeA1);
  controller.edit([item('retry')]);
  timer.flush();
  await flushPromises();

  assert.equal(controller.getState().phase, 'retryable-error');
  assert.ok(outbox.readScopedPendingHomeSave(localStorage, scopeA1));
  controller.retry();
  await flushPromises();

  assert.equal(puts, 2);
  assert.equal(controller.getState().phase, 'saved');
  assert.equal(outbox.readScopedPendingHomeSave(localStorage, scopeA1), null);
});

test('403 and 404 save failures stop autosave and cannot be manually retried', async () => {
  for (const status of [403, 404]) {
    let puts = 0;
    const { controller, localStorage, timer } = createController({
      fetch: async (_url, init = {}) => {
        if (init.method !== 'PUT') return response(200, { revision: 2, items: [] });
        puts += 1;
        return response(status, { error: 'denied' });
      },
    });
    await controller.activate(scopeA1);
    controller.edit([item(`denied-${status}`)]);
    timer.flush();
    await flushPromises();
    controller.retry();
    timer.flush();
    await flushPromises();

    assert.equal(controller.getState().phase, 'access-denied');
    assert.ok(outbox.readScopedPendingHomeSave(localStorage, scopeA1));
    assert.equal(puts, 1);
  }
});

test('an older same-scope completion preserves a newer tab draft', async () => {
  const localStorage = storage();
  const timer1 = scheduler();
  const timer2 = scheduler();
  const oldSave = deferred();
  const first = createController({
    localStorage,
    timer: timer1,
    fetch: async (_url, init = {}) => init.method === 'PUT'
      ? oldSave.promise
      : response(200, { revision: 0, items: [] }),
  }).controller;
  const second = createController({
    localStorage,
    timer: timer2,
    fetch: async () => response(200, { revision: 0, items: [] }),
    now: () => 101,
  }).controller;
  await Promise.all([first.activate(scopeA1), second.activate(scopeA1)]);
  first.edit([item('older')]);
  timer1.flush();
  await flushPromises();
  second.edit([item('newer')]);
  const newer = outbox.readScopedPendingHomeSave(localStorage, scopeA1);

  oldSave.resolve(response(200, { revision: 1, items: [item('older')] }));
  await flushPromises();

  assert.deepEqual(outbox.readScopedPendingHomeSave(localStorage, scopeA1), newer);
});

test('unrelated scopes use distinct Web Locks and independent save queues', async () => {
  const lockCalls = [];
  const locks = {
    request(name, callback) {
      lockCalls.push(name);
      return callback();
    },
  };
  const pendingA = deferred();
  const pendingB = deferred();
  let activePuts = 0;
  const make = (scope, pending) => {
    const timer = scheduler();
    const setup = createController({
      localStorage: storage(),
      timer,
      locks,
      fetch: async (_url, init = {}) => {
        if (init.method !== 'PUT') return response(200, { revision: 0, items: [] });
        activePuts += 1;
        return pending.promise;
      },
    });
    return { ...setup, scope };
  };
  const a = make(scopeA1, pendingA);
  const b = make(scopeB1, pendingB);
  await Promise.all([a.controller.activate(a.scope), b.controller.activate(b.scope)]);
  a.controller.edit([item('a')]);
  b.controller.edit([item('b')]);
  a.timer.flush();
  b.timer.flush();
  await flushPromises();

  assert.equal(activePuts, 2);
  assert.deepEqual(new Set(lockCalls), new Set([
    outbox.homeSaveLockName(scopeA1),
    outbox.homeSaveLockName(scopeB1),
  ]));
  pendingA.resolve(response(200, { revision: 1, items: [item('a')] }));
  pendingB.resolve(response(200, { revision: 1, items: [item('b')] }));
  await flushPromises();
});

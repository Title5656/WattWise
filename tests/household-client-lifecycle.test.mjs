import assert from 'node:assert/strict';
import test from 'node:test';

const clientLifecycle = await import('../lib/household-client-lifecycle.ts').catch(() => null);

function lifecycle() {
  assert.ok(clientLifecycle, 'household client lifecycle helpers must exist');
  return clientLifecycle;
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const user = { id: 'user-1', email: 'member@example.com', displayName: 'สมาชิก' };
const memberHousehold = {
  id: 'house-1',
  name: 'บ้านสวน',
  province: null,
  electricityProvider: null,
  role: 'member',
};

test('membership verification requests identity before memberships', async () => {
  const me = deferred();
  const households = deferred();
  const calls = [];
  const controller = lifecycle().createHouseholdMembershipsLifecycle(async (url, init) => {
    calls.push({ url, signal: init.signal });
    return url === '/api/me' ? me.promise : households.promise;
  });

  const mounted = controller.mount();
  assert.deepEqual(calls.map(({ url }) => url), ['/api/me']);

  me.resolve(response(200, { user }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map(({ url }) => url), ['/api/me', '/api/households']);

  households.resolve(response(200, { userId: user.id, households: [memberHousehold] }));
  await mounted;
  assert.equal(controller.getState().phase, 'ready');
  assert.equal(controller.getState().households[0].role, 'member');
});

test('membership loading stops before household data when display-name onboarding is required', async () => {
  const calls = [];
  const controller = lifecycle().createHouseholdMembershipsLifecycle(async (url) => {
    calls.push(url);
    return response(200, { user: { ...user, needsDisplayName: true } });
  });

  await controller.mount();

  assert.equal(controller.getState().phase, 'profile-required');
  assert.equal(controller.getState().user.id, user.id);
  assert.deepEqual(calls, ['/api/me']);
});

test('focus and visible restoration revalidate without refreshing while hidden', async () => {
  const calls = [];
  const controller = lifecycle().createHouseholdMembershipsLifecycle(async (url) => {
    calls.push(url);
    return url === '/api/me'
      ? response(200, { user })
      : response(200, { userId: user.id, households: [memberHousehold] });
  });

  await controller.mount();
  assert.equal(calls.length, 2);
  await controller.visibilityChanged('hidden');
  assert.equal(calls.length, 2);
  await controller.focus();
  assert.equal(calls.length, 4);
  await controller.visibilityChanged('visible');
  assert.equal(calls.length, 6);
});

test('membership refresh removes verified content before publishing a viewer demotion', async () => {
  let role = 'member';
  const states = [];
  const controller = lifecycle().createHouseholdMembershipsLifecycle(async (url) => url === '/api/me'
    ? response(200, { user })
    : response(200, { userId: user.id, households: [{ ...memberHousehold, role }] }));
  controller.subscribe((state) => states.push(state));

  await controller.mount();
  const oldKey = lifecycle().householdContentScopeKey(user, controller.getState().households[0]);
  role = 'viewer';
  const refreshing = controller.refresh();
  assert.equal(controller.getState().phase, 'loading');
  await refreshing;

  const refreshed = controller.getState();
  assert.equal(refreshed.phase, 'ready');
  assert.equal(refreshed.households[0].role, 'viewer');
  assert.notEqual(lifecycle().householdContentScopeKey(user, refreshed.households[0]), oldKey);
  assert.ok(states.some((state) => state.phase === 'loading' && state.user === null));
});

test('membership refresh retries when account identity changes between sequential responses', async () => {
  const userB = { id: 'user-2', email: 'other@example.com', displayName: 'อีกบัญชี' };
  const householdB = { ...memberHousehold, id: 'house-2', name: 'บ้านอีกบัญชี' };
  let meCalls = 0;
  const readyStates = [];
  const controller = lifecycle().createHouseholdMembershipsLifecycle(async (url) => {
    if (url === '/api/me') {
      meCalls += 1;
      return response(200, { user: meCalls === 1 ? user : userB });
    }
    return response(200, { userId: userB.id, households: [householdB] });
  });
  controller.subscribe((state) => {
    if (state.phase === 'ready') readyStates.push(state);
  });

  await controller.mount();

  assert.equal(meCalls, 2);
  assert.equal(readyStates.length, 1);
  assert.equal(readyStates[0].user.id, userB.id);
  assert.equal(readyStates[0].households[0].id, householdB.id);
});

test('scope replacement disposes the old resource before creating the new one', () => {
  const events = [];
  const slot = lifecycle().createScopedResourceSlot();
  const first = slot.replace('member-scope', () => ({
    id: 'member-resource',
    dispose: () => events.push('dispose member'),
  }));
  const same = slot.replace('member-scope', () => {
    throw new Error('same scope must reuse its resource');
  });
  assert.equal(same, first);

  const second = slot.replace('viewer-scope', () => {
    events.push('create viewer');
    return { id: 'viewer-resource', dispose: () => events.push('dispose viewer') };
  });
  assert.equal(second.id, 'viewer-resource');
  assert.deepEqual(events, ['dispose member', 'create viewer']);
  slot.clear();
  assert.deepEqual(events, ['dispose member', 'create viewer', 'dispose viewer']);
});

test('create 401 becomes terminal and cannot retry household creation', async () => {
  let requests = 0;
  const controller = lifecycle().createHouseholdCreationLifecycle(async () => {
    requests += 1;
    return response(401, { error: 'expired' });
  });
  controller.mount();

  const first = await controller.submit({ name: 'บ้านใหม่' }, () => {
    assert.fail('401 must not navigate');
  });
  const second = await controller.submit({ name: 'ลองอีกครั้ง' }, () => {
    assert.fail('terminal creation must not navigate');
  });

  assert.equal(first, false);
  assert.equal(second, false);
  assert.equal(requests, 1);
  assert.equal(controller.getState().phase, 'session-expired');
});

test('unmount aborts pending creation and stale completion cannot navigate or publish', async () => {
  const pending = deferred();
  let signal;
  let navigated = false;
  const states = [];
  const controller = lifecycle().createHouseholdCreationLifecycle(async (_url, init) => {
    signal = init.signal;
    return pending.promise;
  });
  controller.subscribe((state) => states.push(state.phase));
  controller.mount();

  const submission = controller.submit({ name: 'บ้านใหม่' }, () => { navigated = true; });
  assert.equal(controller.getState().phase, 'submitting');
  const publishedBeforeUnmount = states.length;
  controller.dispose();
  assert.equal(signal.aborted, true);

  pending.resolve(response(201, { household: memberHousehold }));
  await submission;
  assert.equal(navigated, false);
  assert.equal(states.length, publishedBeforeUnmount);
});

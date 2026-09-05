import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouseholdCreationLifecycle, createHouseholdEditLifecycle } from '../lib/household-client-lifecycle.ts';
import { canManageHousehold, canEditHousehold } from '../lib/household-ui.ts';
import { hasUnsavedForms, registerUnsavedForm } from '../lib/unsaved-forms.ts';
import { ACCESS_LOGOUT_PATH, LOGOUT_STORAGE_KEY, LOGOUT_EVENT, logoutFromAccess, watchSessionLogout } from '../lib/session-logout.ts';

const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const house = { id: 'hh_a', name: 'บ้านสวน', province: 'เชียงใหม่', electricityProvider: 'PEA', role: 'owner' };

test('household metadata permissions differ from appliance permissions', () => {
  for (const role of ['owner', 'admin']) assert.equal(canManageHousehold(role), true);
  for (const role of ['member', 'viewer']) assert.equal(canManageHousehold(role), false);
  assert.equal(canEditHousehold('member'), true);
});

test('edit sends the exact household path and preserves a legacy provider; blank fields can be cleared', async () => {
  const calls = [];
  const edit = createHouseholdEditLifecycle(async (url, init) => { calls.push({ url, ...init }); return response(200, { household: house }); }, 'hh a/b');
  edit.mount();
  let saved;
  assert.equal(await edit.submit({ name: house.name, province: null, electricityProvider: 'Legacy provider' }, (value) => { saved = value; }), true);
  assert.equal(calls[0].url, '/api/households/hh%20a%2Fb');
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].body), { name: house.name, province: null, electricityProvider: 'Legacy provider' });
  assert.deepEqual(saved, house);
  edit.dispose();
});

for (const status of [401, 403, 404]) test(`edit ${status} is terminal and cannot retry a mutation`, async () => {
  let calls = 0;
  const edit = createHouseholdEditLifecycle(async () => { calls++; return response(status); }, house.id);
  edit.mount();
  const onSaved = () => assert.fail('must not publish a rejected mutation');
  assert.equal(await edit.submit({ name: house.name }, onSaved), false);
  assert.equal(await edit.submit({ name: house.name }, onSaved), false);
  assert.equal(calls, 1);
  assert.equal(edit.getState().phase, status === 401 ? 'session-expired' : 'access-denied');
  edit.dispose();
});

test('network and server errors keep the form retryable with a safe Thai error', async () => {
  let calls = 0;
  const create = createHouseholdCreationLifecycle(async () => {
    calls++;
    if (calls === 1) throw new Error('private internal URL');
    if (calls === 2) return response(500, { error: 'private database error' });
    return response(201, { household: house });
  });
  create.mount();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await create.submit({ name: house.name }, () => assert.fail()), false);
    assert.equal(create.getState().phase, 'error');
    assert.doesNotMatch(create.getState().error, /private/);
  }
  assert.equal(await create.submit({ name: house.name }, () => {}), true);
  create.dispose();
});

test('double submit and a late edit response after unmount cannot navigate', async () => {
  let resolve;
  let signal;
  let calls = 0;
  const edit = createHouseholdEditLifecycle(async (_url, init) => {
    calls++; signal = init.signal;
    return new Promise((done) => { resolve = done; });
  }, house.id);
  edit.mount();
  const first = edit.submit({ name: 'แก้ไข' }, () => assert.fail('stale completion'));
  assert.equal(await edit.submit({ name: 'ซ้ำ' }, () => assert.fail()), false);
  assert.equal(calls, 1);
  edit.dispose();
  assert.equal(signal.aborted, true);
  resolve(response(200, { household: house }));
  assert.equal(await first, false);
});

test('dirty registration is released independently and is safe to release twice', () => {
  const first = registerUnsavedForm(); const second = registerUnsavedForm();
  first(); first(); assert.equal(hasUnsavedForms(), true);
  second(); assert.equal(hasUnsavedForms(), false);
});

function browserFixture(t, { storageBlocked = false } = {}) {
  const win = new EventTarget();
  const values = new Map([['scoped-draft', 'keep me']]);
  const order = [];
  Object.assign(win, {
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error(); return values.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error(); values.set(key, value); },
    },
    location: { assign(path) { order.push(path); } },
  });
  const channels = [];
  class Channel {
    constructor() { channels.push(this); }
    postMessage(data) { for (const channel of channels) if (channel !== this) channel.onmessage?.({ data }); }
    close() { this.onmessage = null; }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: Channel });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
    Object.defineProperty(globalThis, 'BroadcastChannel', oldChannel);
  });
  return { win, values, order };
}

for (const storageBlocked of [false, true]) test(`logout stops observers before navigating and preserves drafts (storage blocked: ${storageBlocked})`, (t) => {
  const { values, order } = browserFixture(t, { storageBlocked });
  const dispose = watchSessionLogout(() => order.push('stopped'));
  logoutFromAccess();
  assert.deepEqual(order, ['stopped', ACCESS_LOGOUT_PATH]);
  assert.equal(values.get('scoped-draft'), 'keep me');
  dispose();
});

test('restoring an old page after another tab logs out stops its session; a fresh page can authenticate again', (t) => {
  const { win, values } = browserFixture(t);
  let stopped = 0;
  const dispose = watchSessionLogout(() => stopped++);
  values.set(LOGOUT_STORAGE_KEY, 'other-tab');
  win.dispatchEvent(new Event('pageshow'));
  win.dispatchEvent(new Event('focus'));
  assert.equal(stopped, 1);
  dispose();
  const fresh = watchSessionLogout(() => assert.fail('new login must not inherit old logout'));
  win.dispatchEvent(new Event('pageshow'));
  fresh();
  win.dispatchEvent(new Event(LOGOUT_EVENT));
});

test('storage notification from another tab terminates the listener', (t) => {
  const { win } = browserFixture(t);
  let stopped = 0;
  const dispose = watchSessionLogout(() => stopped++);
  const event = new Event('storage');
  Object.assign(event, { key: LOGOUT_STORAGE_KEY, newValue: 'other-tab' });
  win.dispatchEvent(event);
  assert.equal(stopped, 1);
  dispose();
});

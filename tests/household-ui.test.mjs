import assert from 'node:assert/strict';
import test from 'node:test';

const householdUi = await import('../lib/household-ui.ts').catch(() => null);

function ui() {
  assert.ok(householdUi, 'household UI behavior helpers must exist');
  return householdUi;
}

const ownerHome = {
  id: 'hh owner/one',
  name: 'บ้านสวน',
  province: 'เชียงใหม่',
  electricityProvider: 'PEA',
  role: 'owner',
};

test('dynamic identity prefers displayName and falls back to verified email', () => {
  assert.equal(ui().displayUserName({ id: 'u1', email: 'owner@example.com', displayName: 'อรุณ' }), 'อรุณ');
  assert.equal(ui().displayUserName({ id: 'u2', email: 'member@example.com', displayName: null }), 'member@example.com');
  assert.equal(ui().displayUserName({ id: 'u3', email: 'blank@example.com', displayName: '   ' }), 'blank@example.com');
});

test('compatibility entry creates for zero, redirects one, and never chooses among many', () => {
  assert.deepEqual(ui().decideHouseholdEntry([], 'dashboard'), { kind: 'create' });
  assert.deepEqual(ui().decideHouseholdEntry([ownerHome], 'dashboard'), {
    kind: 'redirect',
    href: '/households/hh%20owner%2Fone',
  });
  assert.deepEqual(ui().decideHouseholdEntry([
    ownerHome,
    { ...ownerHome, id: 'hh-two', name: 'บ้านเมือง', role: 'viewer' },
  ], 'dashboard'), { kind: 'choose' });
});

test('explicit household page and API URLs encode and retain the household ID', () => {
  assert.equal(ui().householdDashboardPath('hh owner/one'), '/households/hh%20owner%2Fone');
  assert.equal(ui().householdMyHomePath('hh owner/one'), '/households/hh%20owner%2Fone/my-home');
  assert.equal(ui().householdDashboardApiPath('hh owner/one'), '/api/households/hh%20owner%2Fone/dashboard');
  assert.equal(ui().householdHomeApiPath('hh owner/one'), '/api/households/hh%20owner%2Fone/home');
  assert.equal(ui().householdBillApiPath('hh owner/one', '2026-08'), '/api/households/hh%20owner%2Fone/bills/2026-08');
});

test('Thai role labels and mutation permissions keep viewers read-only', () => {
  assert.equal(ui().householdRoleLabel('owner'), 'เจ้าของบ้าน');
  assert.equal(ui().householdRoleLabel('admin'), 'ผู้ดูแลบ้าน');
  assert.equal(ui().householdRoleLabel('member'), 'สมาชิกบ้าน');
  assert.equal(ui().householdRoleLabel('viewer'), 'ผู้ชม · อ่านอย่างเดียว');
  assert.equal(ui().canEditHousehold('owner'), true);
  assert.equal(ui().canEditHousehold('admin'), true);
  assert.equal(ui().canEditHousehold('member'), true);
  assert.equal(ui().canEditHousehold('viewer'), false);
});

test('viewer hydration preserves an old draft without exposing it to autosave replay', () => {
  const values = new Map([['draft', 'private changes']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  const viewerStorage = ui().homeAutosaveStorageForRole(storage, 'viewer');
  assert.equal(viewerStorage.getItem('draft'), null);
  viewerStorage.setItem('draft', 'replacement');
  viewerStorage.removeItem('draft');
  assert.equal(storage.getItem('draft'), 'private changes');
  assert.equal(ui().homeAutosaveStorageForRole(storage, 'member'), storage);
});

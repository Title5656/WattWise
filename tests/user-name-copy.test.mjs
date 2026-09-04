import assert from 'node:assert/strict';
import test from 'node:test';

const householdUi = await import('../lib/household-ui.ts').catch(() => null);

test('status and account copy derives from the current identity and membership', () => {
  assert.ok(householdUi, 'household UI behavior helpers must exist');

  assert.equal(householdUi.displayUserName({ id: 'u1', email: 'person@example.com', displayName: 'ปาริชาติ' }), 'ปาริชาติ');
  assert.equal(householdUi.householdRoleLabel('member'), 'สมาชิกบ้าน');
});

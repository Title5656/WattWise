import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDisplayName, safeReturnTo } from '../lib/auth-navigation.ts';

test('safe return destinations accept only same-site relative paths', () => {
  assert.equal(safeReturnTo('/households/hh_1?tab=bills'), '/households/hh_1?tab=bills');
  assert.equal(safeReturnTo('https://evil.example/steal'), '/');
  assert.equal(safeReturnTo('//evil.example/steal'), '/');
  assert.equal(safeReturnTo('/login'), '/');
  assert.equal(safeReturnTo(null), '/');
});

test('display names are trimmed and validated for both profile forms and the API', () => {
  assert.deepEqual(normalizeDisplayName('  ปาริชาติ  '), { value: 'ปาริชาติ', error: '' });
  assert.equal(normalizeDisplayName('   ').error, 'กรุณากรอกชื่อที่ต้องการให้แสดง');
  assert.equal(normalizeDisplayName('person@example.com').error, 'ชื่อนี้ดูเหมือนอีเมล กรุณาใช้ชื่อที่ต้องการให้ผู้อื่นเห็น');
  assert.equal(normalizeDisplayName('ก'.repeat(51)).error, 'ชื่อต้องยาวไม่เกิน 50 ตัวอักษร');
});

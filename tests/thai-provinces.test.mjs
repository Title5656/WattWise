import assert from 'node:assert/strict';
import test from 'node:test';

const provinces = await import('../lib/thai-provinces.ts').catch(() => null);

test('province choices cover Thailand and reject arbitrary input', () => {
  assert.ok(provinces, 'province list is available');
  assert.equal(provinces.THAI_PROVINCES.length, 77);
  assert.equal(new Set(provinces.THAI_PROVINCES.map(([name]) => name)).size, 77);
  for (const name of ['กรุงเทพมหานคร', 'เชียงใหม่', 'บึงกาฬ', 'ภูเก็ต', 'Bangkok', 'Chiang Mai']) {
    assert.equal(provinces.isThaiProvince(name), true, name);
  }
  for (const name of ['made up', 'เชียงใหม', '<script>', '']) {
    assert.equal(provinces.isThaiProvince(name), false, name);
  }
});

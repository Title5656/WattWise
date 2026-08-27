import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateMonthlyEnergy, calculateTieredEnergyCharge } from '../lib/energy.ts';
import { addOrIncrementHomeItem, mergeHomeItems } from '../lib/home-config.ts';

const fan = {
  id: 'fan-hatari-s16m7',
  category: 'พัดลม',
  brand: 'Hatari',
  model: 'HT-S16M7',
  name: 'พัดลมสไลด์ปรับระดับ',
  detail: '16 นิ้ว',
  watts: 43,
  image: '/products/hatari-ht-s16m7.jpg',
};

function homeItem(overrides = {}) {
  return { ...fan, instanceId: 'fan-1', quantity: 1, hoursPerDay: 4, ...overrides };
}

test('adds a duplicate appliance to the existing item quantity', () => {
  const result = addOrIncrementHomeItem([homeItem()], homeItem({ instanceId: 'fan-2' }));

  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 2);
  assert.equal(result[0].instanceId, 'fan-1');
});

test('keeps different appliance models as separate items', () => {
  const other = homeItem({ id: 'fan-xiaomi-smart2', instanceId: 'xiaomi-1' });
  const result = addOrIncrementHomeItem([homeItem()], other);

  assert.equal(result.length, 2);
  assert.equal(result[1].id, 'fan-xiaomi-smart2');
});

test('merges persisted duplicate items while keeping the first item settings', () => {
  const result = mergeHomeItems([
    homeItem({ quantity: 3, hoursPerDay: 5 }),
    homeItem({ instanceId: 'fan-2', quantity: 4, hoursPerDay: 8 }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 7);
  assert.equal(result[0].hoursPerDay, 5);
  assert.equal(result[0].instanceId, 'fan-1');
});

test('caps merged quantity at the existing maximum of 20', () => {
  const result = addOrIncrementHomeItem([homeItem({ quantity: 20 })], homeItem({ instanceId: 'fan-2' }));

  assert.equal(result[0].quantity, 20);
});

test('calculates monthly energy for supported appliance methods', () => {
  assert.equal(calculateMonthlyEnergy({
    method: 'watt_hours',
    ratedPowerW: 1_000,
    hoursPerDay: 2,
    daysPerMonth: 30,
    quantity: 2,
  }), 120);

  assert.equal(calculateMonthlyEnergy({
    method: 'per_cycle',
    energyPerCycleKwh: 1.25,
    cyclesPerMonth: 8,
    quantity: 2,
  }), 20);

  assert.equal(calculateMonthlyEnergy({
    method: 'annual_energy',
    annualEnergyKwh: 360,
  }), 30);

  assert.equal(calculateMonthlyEnergy({
    method: 'variable_load',
    ratedPowerW: 1_000,
    hoursPerDay: 10,
    daysPerMonth: 30,
    loadFactor: 0.5,
  }), 150);
});

test('clamps unsafe energy inputs', () => {
  assert.equal(calculateMonthlyEnergy({
    method: 'watt_hours',
    ratedPowerW: -500,
    hoursPerDay: 40,
    daysPerMonth: 50,
  }), 0);

  assert.equal(calculateMonthlyEnergy({
    method: 'variable_load',
    ratedPowerW: 1_000,
    hoursPerDay: 24,
    daysPerMonth: 31,
    loadFactor: 2,
  }), 744);
});

test('calculates a tiered energy charge independent of tier order', () => {
  const tiers = [
    { fromKwh: 100, toKwh: null, ratePerKwh: 5 },
    { fromKwh: 0, toKwh: 100, ratePerKwh: 3 },
  ];

  assert.equal(calculateTieredEnergyCharge(150, tiers), 550);
  assert.equal(calculateTieredEnergyCharge(-10, tiers), 0);
});

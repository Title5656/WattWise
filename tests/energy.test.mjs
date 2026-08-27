import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateElectricityBill,
  calculateEnergy,
  calculateHouseholdEstimate,
  calculateMonthlyEnergy,
  calculateTieredEnergyCharge,
} from '../lib/energy.ts';
import {
  addOrIncrementHomeItem,
  applianceCatalog,
  calculateHomeSummary,
  mergeHomeItems,
} from '../lib/home-config.ts';

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

test('returns transparent assumptions and warnings with structured energy results', () => {
  const estimated = calculateEnergy({
    method: 'variable_load',
    ratedPowerW: 1_000,
    hoursPerDay: 10,
  });

  assert.equal(estimated.status, 'estimated');
  assert.equal(estimated.monthlyEnergyKwh, 210);
  assert.deepEqual(estimated.assumptions.map((item) => item.code), [
    'default_days_per_month',
    'default_load_factor',
  ]);

  const incomplete = calculateEnergy({ method: 'per_cycle' });
  assert.equal(incomplete.status, 'insufficient_data');
  assert.equal(incomplete.monthlyEnergyKwh, 0);
  assert.deepEqual(incomplete.warnings.map((item) => item.code), [
    'missing_energy_per_cycle',
    'missing_cycles_per_month',
  ]);
});

test('calculates average and full tiered electricity bill breakdowns', () => {
  assert.deepEqual(calculateElectricityBill(150, {
    mode: 'average_rate',
    ratePerKwh: 4.18,
    label: 'prototype',
  }), {
    mode: 'average_rate',
    tariffLabel: 'prototype',
    totalEnergyKwh: 150,
    energyCharge: 627,
    serviceCharge: 0,
    ftCharge: 0,
    subtotal: 627,
    vat: 0,
    total: 627,
  });

  assert.deepEqual(calculateElectricityBill(150, {
    mode: 'tiered_tariff',
    tiers: [
      { fromKwh: 100, toKwh: null, ratePerKwh: 5 },
      { fromKwh: 0, toKwh: 100, ratePerKwh: 3 },
    ],
    serviceCharge: 10,
    ftRatePerKwh: 0.2,
    vatRate: 0.07,
  }), {
    mode: 'tiered_tariff',
    tariffLabel: null,
    totalEnergyKwh: 150,
    energyCharge: 550,
    serviceCharge: 10,
    ftCharge: 30,
    subtotal: 590,
    vat: 41.3,
    total: 631.3,
  });
});

test('aggregates mixed calculation methods through one household engine', () => {
  const estimate = calculateHouseholdEstimate([
    {
      key: 'fan',
      method: 'watt_hours',
      ratedPowerW: 1_000,
      hoursPerDay: 2,
      daysPerMonth: 30,
      quantity: 2,
    },
    {
      key: 'washer',
      method: 'per_cycle',
      energyPerCycleKwh: 1,
      cyclesPerMonth: 5,
    },
  ], { mode: 'average_rate', ratePerKwh: 4.18 });

  assert.equal(estimate.totalUnits, 3);
  assert.equal(estimate.monthlyEnergyKwh, 125);
  assert.equal(estimate.itemCalculations.reduce(
    (sum, item) => sum + item.calculation.monthlyEnergyKwh,
    0,
  ), estimate.monthlyEnergyKwh);
  assert.equal(estimate.bill.total, 522.5);
});

test('keeps prototype item totals, home total, and bill in sync', () => {
  const items = applianceCatalog.slice(0, 2).map((appliance, index) => ({
    ...appliance,
    instanceId: `test-${index}`,
    quantity: index + 1,
    hoursPerDay: 4,
  }));
  const summary = calculateHomeSummary(items);
  const itemTotal = summary.itemCalculations.reduce(
    (sum, item) => sum + item.calculation.monthlyEnergyKwh,
    0,
  );

  assert.equal(itemTotal, summary.monthlyKwh);
  assert.equal(summary.bill.total, summary.monthlyBill);
  assert.equal(summary.bill.totalEnergyKwh, summary.monthlyKwh);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateMonthlyEnergy, calculateTieredEnergyCharge } from '../lib/energy.ts';

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

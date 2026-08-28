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
  calculateDailyLoadProfile,
  createHomeItem,
  mergeHomeItems,
  resolveEnergyInput,
} from '../lib/home-config.ts';
import { getResidentialTariff } from '../lib/tariffs.ts';
import { adjustStepperValue, parseStepperInput } from '../lib/stepper.ts';
import {
  createDefaultUsageSchedule,
  parseUsageSchedule,
  setAllDayUsageSchedule,
  scheduleHours,
  toggleUsagePeriod,
  usageScheduleFromLegacyHours,
  updateUsagePeriodHours,
} from '../lib/usage-schedule.ts';

const fan = {
  id: 'fan-hatari-s16m7',
  category: 'พัดลม',
  brand: 'Hatari',
  model: 'HT-S16M7',
  name: 'พัดลมสไลด์ปรับระดับ',
  detail: '16 นิ้ว',
  watts: 43,
  usageProfileId: 'fan',
  image: '/products/hatari-ht-s16m7.jpg',
};

function homeItem(overrides = {}) {
  return { ...fan, instanceId: 'fan-1', quantity: 1, hoursPerDay: 4, cyclesPerMonth: null, ...overrides };
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

test('allows duplicate appliance quantities above 20', () => {
  const result = addOrIncrementHomeItem([homeItem({ quantity: 20 })], homeItem({ instanceId: 'fan-2' }));

  assert.equal(result[0].quantity, 21);
});

test('allows merged appliance quantities above 20', () => {
  const result = mergeHomeItems([
    homeItem({ quantity: 20 }),
    homeItem({ instanceId: 'fan-2', quantity: 7 }),
  ]);

  assert.equal(result[0].quantity, 27);
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
    tariffStatus: 'current',
    tariffEffectiveFrom: null,
    tariffEffectiveTo: null,
    tariffSourceUrl: null,
    warnings: [],
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
    tariffStatus: 'current',
    tariffEffectiveFrom: null,
    tariffEffectiveTo: null,
    tariffSourceUrl: null,
    warnings: [],
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

test('resolves realistic usage profiles for the catalog', () => {
  const ac = createHomeItem(applianceCatalog.find((item) => item.id === 'ac-daikin-ftkd18'));
  const fridge = createHomeItem(applianceCatalog.find((item) => item.id === 'fridge-samsung-rt35'));
  const washer = createHomeItem(applianceCatalog.find((item) => item.id === 'washer-samsung-9'));
  const heater = createHomeItem(applianceCatalog.find((item) => item.id === 'heater-stiebel-xg45'));

  assert.equal(ac.hoursPerDay, 8);
  assert.equal(resolveEnergyInput(ac).method, 'variable_load');
  assert.equal(resolveEnergyInput(ac).loadFactor, 0.6);
  assert.equal(fridge.hoursPerDay, null);
  assert.equal(resolveEnergyInput(fridge).hoursPerDay, 24);
  assert.equal(resolveEnergyInput(fridge).loadFactor, 0.35);
  assert.equal(washer.cyclesPerMonth, 12);
  assert.equal(resolveEnergyInput(washer).method, 'per_cycle');
  assert.equal(resolveEnergyInput(washer).energyPerCycleKwh, 0.8);
  assert.equal(heater.hoursPerDay, 0.25);
});

test('creates the approved default schedules for appliance profiles', () => {
  assert.deepEqual(createDefaultUsageSchedule('inverter_ac'), {
    kind: 'hours',
    hoursByPeriod: { night: 6, morning: 0, daytime: 0, evening: 2 },
  });
  assert.deepEqual(createDefaultUsageSchedule('refrigerator'), { kind: 'all_day' });
  assert.deepEqual(createDefaultUsageSchedule('washing_machine'), {
    kind: 'periods',
    periods: ['daytime'],
  });
  assert.deepEqual(createDefaultUsageSchedule('water_heater'), {
    kind: 'hours',
    hoursByPeriod: { night: 0, morning: 0.25, daytime: 0, evening: 0 },
  });
  assert.deepEqual(createDefaultUsageSchedule('microwave'), {
    kind: 'hours',
    hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 0.25 },
  });
});

test('toggles usage periods without mutating the original schedule', () => {
  const original = {
    kind: 'hours',
    hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 2 },
  };
  const selected = toggleUsagePeriod(original, 'morning', 0.5);
  const removed = toggleUsagePeriod(selected, 'evening', 0.5);

  assert.deepEqual(selected.hoursByPeriod, { night: 0, morning: 0.5, daytime: 0, evening: 2 });
  assert.deepEqual(removed.hoursByPeriod, { night: 0, morning: 0.5, daytime: 0, evening: 0 });
  assert.deepEqual(original.hoursByPeriod, { night: 0, morning: 0, daytime: 0, evening: 2 });
});

test('clamps period hours to six hours and sets all-day schedules', () => {
  const schedule = {
    kind: 'hours',
    hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 0 },
  };

  assert.equal(updateUsagePeriodHours(schedule, 'morning', 8, 0.5).hoursByPeriod.morning, 6);
  assert.equal(updateUsagePeriodHours(schedule, 'morning', -1, 0.5).hoursByPeriod.morning, 0);
  assert.deepEqual(setAllDayUsageSchedule(), { kind: 'hours', hoursByPeriod: { night: 6, morning: 6, daytime: 6, evening: 6 } });
});

test('preserves quarter-hour schedule steps', () => {
  const empty = { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 0 } };

  assert.equal(updateUsagePeriodHours(empty, 'morning', 0.25, 0.25).hoursByPeriod.morning, 0.25);
  assert.equal(toggleUsagePeriod(empty, 'evening', 0.25).hoursByPeriod.evening, 0.25);
  assert.equal(scheduleHours(usageScheduleFromLegacyHours('water_heater', 0.25)), 0.25);
});

test('keeps at least one period for cycle-based schedules', () => {
  const schedule = { kind: 'periods', periods: ['daytime'] };

  assert.deepEqual(toggleUsagePeriod(schedule, 'daytime', 1), schedule);
  assert.deepEqual(toggleUsagePeriod(schedule, 'evening', 1), { kind: 'periods', periods: ['daytime', 'evening'] });
});

test('normalizes malformed schedules and preserves legacy hours within six-hour periods', () => {
  assert.deepEqual(parseUsageSchedule('{"kind":"periods","periods":["daytime","daytime","unknown"]}', 'washing_machine'), {
    kind: 'periods',
    periods: ['daytime'],
  });
  assert.deepEqual(parseUsageSchedule('{not-json', 'television', 8), {
    kind: 'hours',
    hoursByPeriod: { night: 2, morning: 0, daytime: 0, evening: 6 },
  });
  assert.deepEqual(parseUsageSchedule('{"kind":"hours","hoursByPeriod":{}}', 'television', 8), {
    kind: 'hours',
    hoursByPeriod: { night: 2, morning: 0, daytime: 0, evening: 6 },
  });
  const legacy = usageScheduleFromLegacyHours('inverter_ac', 24);
  assert.equal(scheduleHours(legacy), 24);
  assert.ok(Object.values(legacy.hoursByPeriod).every((hours) => hours <= 6));
});

test('keeps an all-day appliance in every graph period', () => {
  const fridge = createHomeItem(applianceCatalog.find((item) => item.id === 'fridge-samsung-rt35'));
  const profile = calculateDailyLoadProfile([fridge]);
  assert.equal(new Set(profile).size, 1);
  assert.ok(profile.every((value) => value > 0));
  assert.ok(Math.abs(profile.reduce((sum, value) => sum + value * 2, 0) - calculateHomeSummary([fridge]).dailyKwh) < 1e-9);
});

test('daily load profile conserves the household daily energy estimate', () => {
  const items = [
    { ...homeItem({ hoursPerDay: 4 }), usageSchedule: { kind: 'hours', hoursByPeriod: { night: 0, morning: 0, daytime: 0, evening: 4 } } },
    { ...createHomeItem(applianceCatalog.find((item) => item.id === 'washer-samsung-9')), usageSchedule: { kind: 'periods', periods: ['daytime'] } },
  ];
  const profile = calculateDailyLoadProfile(items);
  const summary = calculateHomeSummary(items);

  assert.equal(profile.length, 12);
  assert.ok(Math.abs(profile.reduce((sum, value) => sum + value * 2, 0) - summary.dailyKwh) < 1e-9);
  assert.equal(profile[0], 0);
  assert.ok(profile[6] > 0);
  assert.ok(profile[9] > 0);
});

test('selects residential tariffs by billing month and flags future fallback', () => {
  const april = getResidentialTariff(new Date('2026-04-15T00:00:00Z'));
  const september = getResidentialTariff(new Date('2026-09-15T00:00:00Z'));
  const future = getResidentialTariff(new Date('2027-01-15T00:00:00Z'));

  assert.equal(april.status, 'current');
  assert.equal(april.ftRatePerKwh, 0.0972);
  assert.deepEqual(april.tiers, [
    { fromKwh: 0, toKwh: 150, ratePerKwh: 3.2484 },
    { fromKwh: 150, toKwh: 400, ratePerKwh: 4.2218 },
    { fromKwh: 400, toKwh: null, ratePerKwh: 4.4217 },
  ]);
  assert.equal(september.status, 'current');
  assert.equal(september.tiers[0].toKwh, 200);
  assert.equal(september.tiers[0].ratePerKwh, 3);
  assert.equal(september.tiers[2].ratePerKwh, 4.3583);
  assert.equal(future.status, 'latest_known');
  assert.equal(future.warnings[0].code, 'tariff_ft_outdated');
});

test('calculates the official progressive bill boundaries with Ft and VAT', () => {
  const tariff = getResidentialTariff(new Date('2026-09-15T00:00:00Z'));
  assert.equal(calculateElectricityBill(200, tariff).total, 703.08);
  assert.equal(calculateElectricityBill(400, tariff).total, 1627.71);
  assert.equal(calculateElectricityBill(500, tariff).total, 2111.41);
});

test('steps values with bounds and decimal precision', () => {
  assert.equal(adjustStepperValue(0, -0.25, { min: 0, max: 24, step: 0.25 }), 0);
  assert.equal(adjustStepperValue(23.75, 0.25, { min: 0, max: 24, step: 0.25 }), 24);
  assert.equal(adjustStepperValue(1.1, -0.25, { min: 0, max: 24, step: 0.25 }), 0.75);
  assert.equal(adjustStepperValue(309, 1, { min: 0, max: 310, step: 1 }), 310);
  assert.equal(adjustStepperValue(20, 1, { min: 1, step: 1 }), 21);
});

test('keeps an empty stepper draft empty instead of coercing it to zero', () => {
  assert.equal(parseStepperInput('', { min: 1, step: 1 }), null);
  assert.equal(parseStepperInput('  ', { min: 0, step: 0.5 }), null);
  assert.equal(parseStepperInput('12', { min: 1, step: 1 }), 12);
});

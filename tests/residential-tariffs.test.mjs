import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateElectricityBill } from '../lib/energy.ts';
import { getResidentialTariff } from '../lib/tariffs.ts';
import { calculateHomeSummary } from '../lib/home-config.ts';

const september = new Date('2026-09-08T00:00:00+07:00');

for (const electricityProvider of ['PEA', 'MEA']) {
  test(`${electricityProvider}: low-use account retains its registered rate across usage boundaries`, () => {
    const tariff = getResidentialTariff(september, { electricityProvider, residentialTariffClass: 'low_usage' });
    // Published energy tiers; totals before any means-tested/free-electricity assistance.
    for (const [units, energy, total] of [
      [0, 0, 8.76], [15, 35.23, 49.06], [25, 65.11, 82.78],
      [26, 68.11, 86.16], [150, 440.11, 505.74], [200, 590.11, 674.91],
      [201, 594.27, 679.54], [400, 1421.79, 1599.54], [401, 1426.15, 1604.38],
    ]) {
      const bill = calculateElectricityBill(units, tariff);
      assert.equal(bill.energyCharge, energy, `${units} kWh energy`);
      assert.equal(bill.serviceCharge, 8.19);
      assert.equal(bill.total, total, `${units} kWh total`);
    }
    assert.match(tariff.label, new RegExp(electricityProvider));
  });

  test(`${electricityProvider}: standard account is not changed to low-use when usage falls`, () => {
    const tariff = getResidentialTariff(september, { electricityProvider, residentialTariffClass: 'standard' });
    assert.equal(calculateElectricityBill(100, tariff).total, 364.71);
    assert.equal(calculateElectricityBill(200, tariff).total, 703.08);
    assert.equal(calculateElectricityBill(500, tariff).total, 2111.41);
    assert.match(tariff.label, new RegExp(electricityProvider));
  });
}

test('low-use tariff uses the previous seven tiers before September', () => {
  const tariff = getResidentialTariff(new Date('2026-08-31T16:59:59Z'), { residentialTariffClass: 'low_usage' });
  assert.equal(calculateElectricityBill(150, tariff).energyCharge, 518.91);
});

test('negative Ft reduces both the subtotal and VAT', () => {
  const bill = calculateElectricityBill(100, {
    mode: 'tiered_tariff', tiers: [{ fromKwh: 0, toKwh: null, ratePerKwh: 3 }],
    serviceCharge: 24.62, ftRatePerKwh: -0.1532, vatRate: 0.07,
  });
  assert.equal(bill.ftCharge, -15.32);
  assert.equal(bill.subtotal, 309.3);
  assert.equal(bill.vat, 21.65);
  assert.equal(bill.total, 330.95);
});

test('unknown account class exposes the standard-rate assumption', () => {
  assert.ok(getResidentialTariff(september).warnings.some((notice) => notice.code === 'tariff_class_assumed'));
});

test('household summary and its range use the selected account class', () => {
  const item = {
    id: 'fixture', instanceId: 'fixture', category: 'test', brand: 'test', model: 'test', name: 'test',
    detail: '', image: '', watts: 1000, usageProfileId: 'television', quantity: 1,
    hoursPerDay: 5, cyclesPerMonth: null,
  };
  const summary = calculateHomeSummary([item], september, { electricityProvider: 'MEA', residentialTariffClass: 'low_usage' });
  assert.equal(summary.monthlyKwh, 150);
  assert.equal(summary.monthlyBill, 505.74);
  assert.equal(summary.monthlyBillRange.low, 454.97);
  assert.equal(summary.monthlyBillRange.high, 556.49);
});

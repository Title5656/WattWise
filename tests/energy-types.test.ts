import type { AverageRateTariff, TariffInput } from '../lib/energy.ts';

const averageRateTariffWithMetadata: AverageRateTariff = {
  mode: 'average_rate',
  ratePerKwh: 4.18,
  label: 'prototype with metadata',
  status: 'latest_known',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  sourceUrl: 'https://example.com/tariff',
  warnings: [{ code: 'tariff_sample', message: 'Sample tariff metadata' }],
};

const tariffInput: TariffInput = averageRateTariffWithMetadata;

void tariffInput;

export type CalculationMethod = 'watt_hours' | 'per_cycle' | 'annual_energy' | 'variable_load';

export type EnergyInput = {
  method: CalculationMethod;
  quantity?: number;
  ratedPowerW?: number | null;
  hoursPerDay?: number | null;
  daysPerMonth?: number | null;
  energyPerCycleKwh?: number | null;
  cyclesPerMonth?: number | null;
  annualEnergyKwh?: number | null;
  loadFactor?: number | null;
};

export function calculateMonthlyEnergy(input: EnergyInput): number {
  const quantity = Math.max(1, input.quantity ?? 1);
  if (input.method === 'annual_energy') return Math.max(0, input.annualEnergyKwh ?? 0) / 12 * quantity;
  if (input.method === 'per_cycle') {
    return Math.max(0, input.energyPerCycleKwh ?? 0) * Math.max(0, input.cyclesPerMonth ?? 0) * quantity;
  }
  const powerKw = Math.max(0, input.ratedPowerW ?? 0) / 1000;
  const hours = Math.min(24, Math.max(0, input.hoursPerDay ?? 0));
  const days = Math.min(31, Math.max(0, input.daysPerMonth ?? 30));
  const loadFactor = input.method === 'variable_load' ? Math.min(1, Math.max(0, input.loadFactor ?? 0.7)) : 1;
  return powerKw * hours * days * quantity * loadFactor;
}

export type TariffTier = { fromKwh: number; toKwh: number | null; ratePerKwh: number };

export function calculateTieredEnergyCharge(totalKwh: number, tiers: TariffTier[]): number {
  const usage = Math.max(0, totalKwh);
  return [...tiers].sort((a, b) => a.fromKwh - b.fromKwh).reduce((total, tier) => {
    const upper = tier.toKwh ?? usage;
    const units = Math.max(0, Math.min(usage, upper) - tier.fromKwh);
    return total + units * tier.ratePerKwh;
  }, 0);
}

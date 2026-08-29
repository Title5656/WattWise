export type CalculationMethod = 'watt_hours' | 'per_cycle' | 'annual_energy' | 'variable_load';
export type CalculationConfidence = 'high' | 'medium' | 'low' | 'sample';
export type CalculationStatus = 'calculated' | 'estimated' | 'insufficient_data';

export const DEFAULT_DAYS_PER_MONTH = 30;
export const DEFAULT_VARIABLE_LOAD_FACTOR = 0.7;

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
  confidence?: CalculationConfidence;
};

export type CalculationNotice = {
  code: string;
  message: string;
};

export type EnergyCalculationResult = {
  method: CalculationMethod;
  status: CalculationStatus;
  confidence: CalculationConfidence;
  quantity: number;
  ratedLoadKw: number;
  dailyEnergyKwh: number;
  monthlyEnergyKwh: number;
  assumptions: CalculationNotice[];
  warnings: CalculationNotice[];
};

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum = Number.POSITIVE_INFINITY) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeQuantity(value: number | null | undefined) {
  return Math.max(1, Math.round(finiteNumber(value) ?? 1));
}

function missing(code: string, message: string): CalculationNotice {
  return { code, message };
}

export function calculateEnergy(input: EnergyInput): EnergyCalculationResult {
  const assumptions: CalculationNotice[] = [];
  const warnings: CalculationNotice[] = [];
  const quantity = normalizeQuantity(input.quantity);
  const rawPowerW = finiteNumber(input.ratedPowerW);
  const ratedPowerW = clamp(rawPowerW ?? 0, 0);
  const ratedLoadKw = ratedPowerW * quantity / 1000;

  const rawDays = finiteNumber(input.daysPerMonth);
  const daysPerMonth = clamp(rawDays ?? DEFAULT_DAYS_PER_MONTH, 0, 31);
  if (rawDays === null && input.method !== 'annual_energy') {
    assumptions.push({
      code: 'default_days_per_month',
      message: `ไม่ได้ระบุจำนวนวัน ระบบใช้ ${DEFAULT_DAYS_PER_MONTH} วันต่อเดือน`,
    });
  }

  let dailyEnergyKwh = 0;
  let monthlyEnergyKwh = 0;

  if (input.method === 'annual_energy') {
    const annualEnergyKwh = finiteNumber(input.annualEnergyKwh);
    if (annualEnergyKwh === null) {
      warnings.push(missing('missing_annual_energy', 'ไม่มีข้อมูลพลังงานต่อปี จึงยังคำนวณไม่ได้'));
    } else {
      const normalizedAnnualEnergy = clamp(annualEnergyKwh, 0);
      monthlyEnergyKwh = normalizedAnnualEnergy / 12 * quantity;
      dailyEnergyKwh = normalizedAnnualEnergy / 365 * quantity;
    }
  } else if (input.method === 'per_cycle') {
    const energyPerCycleKwh = finiteNumber(input.energyPerCycleKwh);
    const cyclesPerMonth = finiteNumber(input.cyclesPerMonth);
    if (energyPerCycleKwh === null) {
      warnings.push(missing('missing_energy_per_cycle', 'ไม่มีข้อมูลพลังงานต่อรอบ จึงยังคำนวณไม่ได้'));
    }
    if (cyclesPerMonth === null) {
      warnings.push(missing('missing_cycles_per_month', 'ไม่ได้ระบุจำนวนรอบต่อเดือน จึงยังคำนวณไม่ได้'));
    }
    if (energyPerCycleKwh !== null && cyclesPerMonth !== null) {
      monthlyEnergyKwh = clamp(energyPerCycleKwh, 0) * clamp(cyclesPerMonth, 0) * quantity;
      dailyEnergyKwh = daysPerMonth > 0 ? monthlyEnergyKwh / daysPerMonth : 0;
    }
  } else {
    const hoursPerDay = finiteNumber(input.hoursPerDay);
    if (rawPowerW === null) {
      warnings.push(missing('missing_rated_power', 'ไม่มีข้อมูลกำลังไฟ จึงยังคำนวณไม่ได้'));
    }
    if (hoursPerDay === null) {
      warnings.push(missing('missing_hours_per_day', 'ไม่ได้ระบุชั่วโมงใช้งานต่อวัน จึงยังคำนวณไม่ได้'));
    }

    let loadFactor = 1;
    if (input.method === 'variable_load') {
      const suppliedLoadFactor = finiteNumber(input.loadFactor);
      loadFactor = clamp(suppliedLoadFactor ?? DEFAULT_VARIABLE_LOAD_FACTOR, 0, 1);
      if (suppliedLoadFactor === null) {
        assumptions.push({
          code: 'default_load_factor',
          message: `ไม่มี load factor ระบบใช้ค่าประมาณ ${DEFAULT_VARIABLE_LOAD_FACTOR}`,
        });
      }
    }

    if (rawPowerW !== null && hoursPerDay !== null) {
      dailyEnergyKwh = ratedPowerW * clamp(hoursPerDay, 0, 24) * quantity * loadFactor / 1000;
      monthlyEnergyKwh = dailyEnergyKwh * daysPerMonth;
    }
  }

  const status: CalculationStatus = warnings.length > 0
    ? 'insufficient_data'
    : assumptions.length > 0
      ? 'estimated'
      : 'calculated';

  return {
    method: input.method,
    status,
    confidence: input.confidence ?? 'sample',
    quantity,
    ratedLoadKw,
    dailyEnergyKwh,
    monthlyEnergyKwh,
    assumptions,
    warnings,
  };
}

/** Compatibility helper for callers that only need the monthly kWh value. */
export function calculateMonthlyEnergy(input: EnergyInput): number {
  return calculateEnergy(input).monthlyEnergyKwh;
}

export type TariffTier = { fromKwh: number; toKwh: number | null; ratePerKwh: number };

export type TariffMetadata = {
  label?: string;
  status?: 'current' | 'latest_known';
  effectiveFrom?: string;
  effectiveTo?: string | null;
  sourceUrl?: string;
  warnings?: CalculationNotice[];
};

export type AverageRateTariff = TariffMetadata & {
  mode: 'average_rate';
  ratePerKwh: number;
};

export type TieredTariff = TariffMetadata & {
  mode: 'tiered_tariff';
  tiers: TariffTier[];
  serviceCharge: number;
  ftRatePerKwh: number;
  vatRate: number;
};

export type TariffInput = AverageRateTariff | TieredTariff;

export type ElectricityBillResult = {
  mode: TariffInput['mode'];
  tariffLabel: string | null;
  totalEnergyKwh: number;
  energyCharge: number;
  serviceCharge: number;
  ftCharge: number;
  subtotal: number;
  vat: number;
  total: number;
  tariffStatus: 'current' | 'latest_known';
  tariffEffectiveFrom: string | null;
  tariffEffectiveTo: string | null;
  tariffSourceUrl: string | null;
  warnings: CalculationNotice[];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTieredEnergyCharge(totalKwh: number, tiers: TariffTier[]): number {
  const usage = clamp(finiteNumber(totalKwh) ?? 0, 0);
  let coveredUntil = 0;

  return [...tiers].sort((a, b) => a.fromKwh - b.fromKwh).reduce((total, tier) => {
    const from = Math.max(clamp(finiteNumber(tier.fromKwh) ?? 0, 0), coveredUntil);
    const declaredUpper = finiteNumber(tier.toKwh);
    const upper = declaredUpper === null ? usage : clamp(declaredUpper, from);
    const units = Math.max(0, Math.min(usage, upper) - from);
    coveredUntil = Math.max(coveredUntil, upper);
    return total + units * clamp(finiteNumber(tier.ratePerKwh) ?? 0, 0);
  }, 0);
}

export function calculateElectricityBill(totalKwh: number, tariff: TariffInput): ElectricityBillResult {
  const usage = clamp(finiteNumber(totalKwh) ?? 0, 0);
  const energyCharge = roundMoney(tariff.mode === 'average_rate'
    ? usage * clamp(finiteNumber(tariff.ratePerKwh) ?? 0, 0)
    : calculateTieredEnergyCharge(usage, tariff.tiers));
  const serviceCharge = tariff.mode === 'tiered_tariff'
    ? roundMoney(clamp(finiteNumber(tariff.serviceCharge) ?? 0, 0))
    : 0;
  const ftCharge = tariff.mode === 'tiered_tariff'
    ? roundMoney(usage * clamp(finiteNumber(tariff.ftRatePerKwh) ?? 0, 0))
    : 0;
  const subtotal = roundMoney(energyCharge + serviceCharge + ftCharge);
  const vat = tariff.mode === 'tiered_tariff'
    ? roundMoney(subtotal * clamp(finiteNumber(tariff.vatRate) ?? 0, 0, 1))
    : 0;
  const tariffMetadata = tariff.mode === 'tiered_tariff' ? tariff : undefined;

  return {
    mode: tariff.mode,
    tariffLabel: tariff.label ?? null,
    totalEnergyKwh: usage,
    energyCharge,
    serviceCharge,
    ftCharge,
    subtotal,
    vat,
    total: roundMoney(subtotal + vat),
    tariffStatus: tariffMetadata?.status ?? 'current',
    tariffEffectiveFrom: tariffMetadata?.effectiveFrom ?? null,
    tariffEffectiveTo: tariffMetadata?.effectiveTo ?? null,
    tariffSourceUrl: tariffMetadata?.sourceUrl ?? null,
    warnings: tariffMetadata?.warnings ?? [],
  };
}

export type HouseholdEnergyItemInput = EnergyInput & { key: string };

export type HouseholdItemCalculation = {
  key: string;
  calculation: EnergyCalculationResult;
};

export type HouseholdEstimateResult = {
  totalUnits: number;
  ratedLoadKw: number;
  dailyEnergyKwh: number;
  monthlyEnergyKwh: number;
  itemCalculations: HouseholdItemCalculation[];
  bill: ElectricityBillResult;
};

export function calculateHouseholdEstimate(
  items: HouseholdEnergyItemInput[],
  tariff: TariffInput,
): HouseholdEstimateResult {
  const itemCalculations = items.map(({ key, ...input }) => ({
    key,
    calculation: calculateEnergy(input),
  }));
  const totalUnits = itemCalculations.reduce((sum, item) => sum + item.calculation.quantity, 0);
  const ratedLoadKw = itemCalculations.reduce((sum, item) => sum + item.calculation.ratedLoadKw, 0);
  const dailyEnergyKwh = itemCalculations.reduce((sum, item) => sum + item.calculation.dailyEnergyKwh, 0);
  const monthlyEnergyKwh = itemCalculations.reduce((sum, item) => sum + item.calculation.monthlyEnergyKwh, 0);

  return {
    totalUnits,
    ratedLoadKw,
    dailyEnergyKwh,
    monthlyEnergyKwh,
    itemCalculations,
    bill: calculateElectricityBill(monthlyEnergyKwh, tariff),
  };
}

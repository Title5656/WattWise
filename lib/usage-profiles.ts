import type { CalculationMethod, EnergyInput } from './energy.ts';

export type UsageProfileId =
  | 'inverter_ac'
  | 'refrigerator'
  | 'television'
  | 'washing_machine'
  | 'fan'
  | 'water_heater'
  | 'microwave'
  | 'rice_cooker';

export type UsageInputKind = 'hours' | 'cycles' | 'fixed';

export type ApplianceUsageProfile = {
  id: UsageProfileId;
  method: CalculationMethod;
  inputKind: UsageInputKind;
  defaultHoursPerDay?: number;
  defaultCyclesPerMonth?: number;
  energyPerCycleKwh?: number;
  loadFactor?: number;
  step: number;
  min: number;
  max: number;
  description: string;
};

export const usageProfiles: Record<UsageProfileId, ApplianceUsageProfile> = {
  inverter_ac: { id: 'inverter_ac', method: 'variable_load', inputKind: 'hours', defaultHoursPerDay: 8, loadFactor: 0.6, step: 0.5, min: 0, max: 24, description: 'โหลดแปรผันสำหรับแอร์อินเวอร์เตอร์' },
  refrigerator: { id: 'refrigerator', method: 'variable_load', inputKind: 'fixed', defaultHoursPerDay: 24, loadFactor: 0.35, step: 1, min: 24, max: 24, description: 'เปิดตลอดวันและคิดตาม duty cycle' },
  television: { id: 'television', method: 'watt_hours', inputKind: 'hours', defaultHoursPerDay: 4, step: 0.5, min: 0, max: 24, description: 'กำลังไฟตามชั่วโมงที่เปิด' },
  washing_machine: { id: 'washing_machine', method: 'per_cycle', inputKind: 'cycles', defaultCyclesPerMonth: 12, energyPerCycleKwh: 0.8, step: 1, min: 0, max: 310, description: 'พลังงานต่อรอบซัก' },
  fan: { id: 'fan', method: 'watt_hours', inputKind: 'hours', defaultHoursPerDay: 8, step: 0.5, min: 0, max: 24, description: 'กำลังไฟตามชั่วโมงที่เปิด' },
  water_heater: { id: 'water_heater', method: 'watt_hours', inputKind: 'hours', defaultHoursPerDay: 0.25, step: 0.25, min: 0, max: 24, description: 'เวลาเปิดน้ำอุ่นจริงต่อวัน' },
  microwave: { id: 'microwave', method: 'watt_hours', inputKind: 'hours', defaultHoursPerDay: 0.25, step: 0.25, min: 0, max: 24, description: 'เวลาอุ่นอาหารจริงต่อวัน' },
  rice_cooker: { id: 'rice_cooker', method: 'per_cycle', inputKind: 'cycles', defaultCyclesPerMonth: 30, energyPerCycleKwh: 0.6, step: 1, min: 0, max: 310, description: 'พลังงานต่อรอบหุง' },
};

export function getUsageProfile(id: UsageProfileId) {
  return usageProfiles[id];
}

export function resolveProfileEnergyInput(
  profile: ApplianceUsageProfile,
  input: { ratedPowerW: number; quantity: number; hoursPerDay: number | null; cyclesPerMonth: number | null },
): EnergyInput {
  return {
    method: profile.method,
    ratedPowerW: input.ratedPowerW,
    quantity: input.quantity,
    hoursPerDay: profile.inputKind === 'fixed' ? profile.defaultHoursPerDay : input.hoursPerDay,
    cyclesPerMonth: profile.inputKind === 'cycles' ? input.cyclesPerMonth : null,
    energyPerCycleKwh: profile.energyPerCycleKwh,
    loadFactor: profile.loadFactor,
    daysPerMonth: 30,
  };
}

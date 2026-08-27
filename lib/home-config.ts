import {
  calculateHouseholdEstimate,
  type EnergyCalculationResult,
  type ElectricityBillResult,
} from './energy.ts';
import { getResidentialTariff } from './tariffs.ts';
import { getUsageProfile, resolveProfileEnergyInput, type UsageProfileId } from './usage-profiles.ts';

export type Appliance = {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string;
  detail: string;
  watts: number;
  usageProfileId: UsageProfileId;
  image: string;
};

export type HomeAppliance = Appliance & {
  instanceId: string;
  quantity: number;
  hoursPerDay: number | null;
  cyclesPerMonth: number | null;
};

export const applianceCatalog: Appliance[] = [
  { id: 'ac-daikin-ftkd18', category: 'เครื่องปรับอากาศ', brand: 'Daikin', model: 'FTKD18ZV2S', name: 'แอร์ผนัง Inverter', detail: '18,100 BTU · Streamer ฟอกอากาศ', watts: 1540, usageProfileId: 'inverter_ac', image: '/products/daikin-ftkd18zv2s.jpg' },
  { id: 'ac-mitsubishi-ky13', category: 'เครื่องปรับอากาศ', brand: 'Mitsubishi Electric', model: 'MSY-KY13VF', name: 'Mr. Slim Happy Inverter', detail: '12,283 BTU · V-Air Filter', watts: 1020, usageProfileId: 'inverter_ac', image: '/products/mitsubishi-msy-ky13vf.jpg' },
  { id: 'fridge-samsung-rt35', category: 'ตู้เย็น', brand: 'Samsung', model: 'RT35CG5544B1SV', name: 'ตู้เย็น 2 ประตู Inverter', detail: '345 ลิตร · Optimal Fresh+', watts: 110, usageProfileId: 'refrigerator', image: '/products/samsung-rt35cg5544b1sv.png' },
  { id: 'fridge-lg-gnb392', category: 'ตู้เย็น', brand: 'LG', model: 'GN-B392PLBK', name: 'ตู้เย็น 2 ประตู Smart Inverter', detail: '395 ลิตร · ThinQ Wi-Fi', watts: 110, usageProfileId: 'refrigerator', image: '/products/lg-gn-b392plbk.jpg' },
  { id: 'tv-lg-ut80-55', category: 'โทรทัศน์', brand: 'LG', model: '55UT8050PSB', name: 'UHD AI Smart TV UT80', detail: '55 นิ้ว · 4K · webOS 24', watts: 125, usageProfileId: 'television', image: '/products/lg-55ut8050psb.jpg' },
  { id: 'tv-sony-bravia3-55', category: 'โทรทัศน์', brand: 'Sony', model: 'K-55S30', name: 'BRAVIA 3 Google TV', detail: '55 นิ้ว · 4K HDR · Dolby Vision', watts: 130, usageProfileId: 'television', image: '/products/sony-k-55s30.jpg' },
  { id: 'washer-electrolux-9', category: 'เครื่องซักผ้า', brand: 'Electrolux', model: 'EWF9024D3WB', name: 'UltimateCare 300 ฝาหน้า', detail: '9 กก. · 1,200 rpm · EcoInverter', watts: 350, usageProfileId: 'washing_machine', image: '/products/electrolux-ewf9024d3wb.png' },
  { id: 'washer-samsung-9', category: 'เครื่องซักผ้า', brand: 'Samsung', model: 'WW90T504DAW/ST', name: 'AI Control EcoBubble', detail: '9 กก. · 1,400 rpm · SmartThings', watts: 500, usageProfileId: 'washing_machine', image: '/products/samsung-ww90t504daw.png' },
  { id: 'fan-hatari-s16m7', category: 'พัดลม', brand: 'Hatari', model: 'HT-S16M7', name: 'พัดลมสไลด์ปรับระดับ', detail: '16 นิ้ว · 3 ระดับแรงลม', watts: 43, usageProfileId: 'fan', image: '/products/hatari-ht-s16m7.jpg' },
  { id: 'fan-xiaomi-smart2', category: 'พัดลม', brand: 'Xiaomi', model: 'BPLDS02DM', name: 'Mi Smart Standing Fan 2', detail: 'มอเตอร์ DC · Wi-Fi · เสียงเบา', watts: 15, usageProfileId: 'fan', image: '/products/xiaomi-smart-fan-2.png' },
  { id: 'heater-stiebel-xg45', category: 'เครื่องทำน้ำอุ่น', brand: 'Stiebel Eltron', model: 'XG 45 EC', name: 'เครื่องทำน้ำอุ่น X-TRA', detail: '4.5 kW · ELCB · IP25', watts: 4500, usageProfileId: 'water_heater', image: '/products/stiebel-xg45ec.jpg' },
  { id: 'microwave-toshiba-sm20', category: 'เครื่องใช้ในครัว', brand: 'Toshiba', model: 'ER-SM20(W)TH', name: 'ไมโครเวฟระบบธรรมดา', detail: '20 ลิตร · 5 ระดับความร้อน', watts: 800, usageProfileId: 'microwave', image: '/products/toshiba-er-sm20.webp' },
  { id: 'rice-sharp-com18', category: 'เครื่องใช้ในครัว', brand: 'Sharp', model: 'KS-COM18', name: 'หม้อหุงข้าวดิจิทัล', detail: '1.8 ลิตร · Fuzzy Control · ตั้งเวลาได้', watts: 830, usageProfileId: 'rice_cooker', image: '/products/sharp-ks-com18.png' },
];

export function createHomeItem(appliance: Appliance): HomeAppliance {
  const profile = getUsageProfile(appliance.usageProfileId);
  return {
    ...appliance,
    instanceId: `${appliance.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    quantity: 1,
    hoursPerDay: profile.inputKind === 'hours' ? profile.defaultHoursPerDay ?? 0 : null,
    cyclesPerMonth: profile.inputKind === 'cycles' ? profile.defaultCyclesPerMonth ?? 0 : null,
  };
}

export function resolveEnergyInput(item: HomeAppliance) {
  const profile = getUsageProfile(item.usageProfileId);
  return resolveProfileEnergyInput(profile, {
    ratedPowerW: item.watts,
    quantity: item.quantity,
    hoursPerDay: item.hoursPerDay,
    cyclesPerMonth: item.cyclesPerMonth,
  });
}

export function addOrIncrementHomeItem(items: HomeAppliance[], item: HomeAppliance): HomeAppliance[] {
  const existingIndex = items.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) return [...items, item];

  return items.map((entry, index) => index === existingIndex
    ? { ...entry, quantity: entry.quantity + 1 }
    : entry);
}

export function mergeHomeItems(items: HomeAppliance[]): HomeAppliance[] {
  const merged: HomeAppliance[] = [];
  const indexByApplianceId = new Map<string, number>();

  for (const item of items) {
    const existingIndex = indexByApplianceId.get(item.id);
    if (existingIndex === undefined) {
      indexByApplianceId.set(item.id, merged.length);
      merged.push(item);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      quantity: existing.quantity + item.quantity,
    };
  }

  return merged;
}

export type HomeItemCalculation = {
  instanceId: string;
  calculation: EnergyCalculationResult;
};

export type HomeSummary = {
  totalUnits: number;
  ratedLoadKw: number;
  dailyKwh: number;
  monthlyKwh: number;
  monthlyBill: number;
  bill: ElectricityBillResult;
  itemCalculations: HomeItemCalculation[];
};

export function calculateHomeSummary(items: HomeAppliance[], billingDate = new Date()): HomeSummary {
  const estimate = calculateHouseholdEstimate(items.map((item) => ({
    key: item.instanceId,
    ...resolveEnergyInput(item),
    confidence: 'sample',
  })), getResidentialTariff(billingDate));

  return {
    totalUnits: estimate.totalUnits,
    ratedLoadKw: estimate.ratedLoadKw,
    dailyKwh: estimate.dailyEnergyKwh,
    monthlyKwh: estimate.monthlyEnergyKwh,
    monthlyBill: estimate.bill.total,
    bill: estimate.bill,
    itemCalculations: estimate.itemCalculations.map((item) => ({
      instanceId: item.key,
      calculation: item.calculation,
    })),
  };
}

export function hydrateHomeItem(row: {
  id: number;
  applianceKey: string;
  quantity: number;
  hoursPerDay: number;
  cyclesPerMonth?: number | null;
}): HomeAppliance | null {
  const appliance = applianceCatalog.find((item) => item.id === row.applianceKey);
  if (!appliance) return null;
  const profile = getUsageProfile(appliance.usageProfileId);
  return {
    ...appliance,
    instanceId: `saved-${row.id}`,
    quantity: row.quantity,
    hoursPerDay: profile.inputKind === 'hours' ? row.hoursPerDay : null,
    cyclesPerMonth: profile.inputKind === 'cycles'
      ? row.cyclesPerMonth ?? profile.defaultCyclesPerMonth ?? 0
      : null,
  };
}

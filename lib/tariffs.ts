import type { CalculationNotice, TariffTier, TieredTariff } from './energy.ts';

export type ResidentialTariff = TieredTariff & {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'current' | 'latest_known';
  sourceUrl: string;
  warnings: CalculationNotice[];
};

const PEA_TARIFF_SOURCE = 'https://www.pea.co.th/our-services/tariff';
const ERC_TARIFF_SOURCE = 'https://www.erc.or.th/th/news-release/3472';

const legacyTiers: TariffTier[] = [
  { fromKwh: 0, toKwh: 150, ratePerKwh: 3.2484 },
  { fromKwh: 150, toKwh: 400, ratePerKwh: 4.2218 },
  { fromKwh: 400, toKwh: null, ratePerKwh: 4.4217 },
];

const progressiveTiers: TariffTier[] = [
  { fromKwh: 0, toKwh: 200, ratePerKwh: 3 },
  { fromKwh: 200, toKwh: 400, ratePerKwh: 4.1584 },
  { fromKwh: 400, toKwh: null, ratePerKwh: 4.3583 },
];

type TariffRecord = Omit<ResidentialTariff, 'status' | 'warnings'> & {
  effectiveTo: string | null;
};

const tariffRecords: TariffRecord[] = [
  {
    id: 'residential-2026-jan-apr',
    mode: 'tiered_tariff',
    tiers: legacyTiers,
    serviceCharge: 24.62,
    ftRatePerKwh: 0.0972,
    vatRate: 0.07,
    label: 'บ้านอยู่อาศัยทั่วไป · ม.ค.–เม.ย. 2569',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-04-30',
    sourceUrl: PEA_TARIFF_SOURCE,
  },
  {
    id: 'residential-2026-may-aug',
    mode: 'tiered_tariff',
    tiers: legacyTiers,
    serviceCharge: 24.62,
    ftRatePerKwh: 0.1623,
    vatRate: 0.07,
    label: 'บ้านอยู่อาศัยทั่วไป · พ.ค.–ส.ค. 2569',
    effectiveFrom: '2026-05-01',
    effectiveTo: '2026-08-31',
    sourceUrl: PEA_TARIFF_SOURCE,
  },
  {
    id: 'residential-2026-sep-dec',
    mode: 'tiered_tariff',
    tiers: progressiveTiers,
    serviceCharge: 24.62,
    ftRatePerKwh: 0.1623,
    vatRate: 0.07,
    label: 'บ้านอยู่อาศัยทั่วไป · ก.ย.–ธ.ค. 2569',
    effectiveFrom: '2026-09-01',
    effectiveTo: '2026-12-31',
    sourceUrl: ERC_TARIFF_SOURCE,
  },
];

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getResidentialTariff(billingDate = new Date()): ResidentialTariff {
  const requestedDate = dateKey(billingDate);
  const current = tariffRecords.find((record) => requestedDate >= record.effectiveFrom
    && (record.effectiveTo === null || requestedDate <= record.effectiveTo));

  if (current) return { ...current, status: 'current', warnings: [] };

  const latest = tariffRecords[tariffRecords.length - 1];
  const earliest = tariffRecords[0];
  const warningCode = requestedDate > (latest.effectiveTo ?? latest.effectiveFrom)
    ? 'tariff_ft_outdated'
    : 'tariff_before_known_period';
  const warningMessage = warningCode === 'tariff_ft_outdated'
    ? 'ยังไม่มีค่า Ft ของเดือนนี้ใน registry จึงใช้ค่า Ft ล่าสุดที่ทราบ'
    : 'ยังไม่มี tariff ของเดือนนี้ใน registry จึงใช้ชุดข้อมูลแรกที่ทราบ';
  const fallback = requestedDate > (latest.effectiveTo ?? latest.effectiveFrom) ? latest : earliest;

  return {
    ...fallback,
    status: 'latest_known',
    warnings: [{ code: warningCode, message: warningMessage }],
  };
}

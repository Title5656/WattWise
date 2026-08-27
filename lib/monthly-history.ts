export type MonthlyEnergyRecord = {
  billingMonth: string;
  estimatedKwh: number | null;
  estimatedBill: number | null;
  actualKwh: number | null;
  actualBill: number | null;
  estimatedAt: number | null;
  actualAt: number | null;
};

export type ActualBillInput = {
  month?: unknown;
  actualBill?: unknown;
  actualKwh?: unknown;
};

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

export function getBillingMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Unable to resolve billing month');
  return `${year}-${month}`;
}

export function formatBillingMonthLabel(billingMonth: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK_TIME_ZONE,
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${billingMonth}-01T12:00:00+07:00`));
}

function parseNumber(value: unknown, optional = false): number | null {
  if (optional && (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function validateActualBillInput(input: ActualBillInput, now = new Date()):
  | { month: string; actualBill: number; actualKwh: number | null }
  | { error: string } {
  const month = typeof input.month === 'string' ? input.month.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'กรุณาระบุเดือนในรูปแบบที่ถูกต้อง' };
  if (month > getBillingMonth(now)) return { error: 'ไม่สามารถบันทึกบิลของเดือนอนาคตได้' };

  const actualBill = parseNumber(input.actualBill);
  if (actualBill === null) return { error: 'กรุณาระบุยอดเงินที่เป็นเลขไม่ติดลบ' };
  const actualKwh = parseNumber(input.actualKwh, true);
  if (input.actualKwh !== undefined && input.actualKwh !== null && actualKwh === null) return { error: 'kWh ต้องเป็นเลขไม่ติดลบหรือเว้นว่าง' };
  return { month, actualBill, actualKwh };
}

export function selectRecentRecords(records: MonthlyEnergyRecord[], limit = 6): MonthlyEnergyRecord[] {
  return [...records]
    .sort((left, right) => right.billingMonth.localeCompare(left.billingMonth))
    .slice(0, Math.max(0, limit))
    .reverse();
}

export function upsertEstimate(
  records: MonthlyEnergyRecord[],
  billingMonth: string,
  estimate: { estimatedKwh: number; estimatedBill: number },
  updatedAt: number,
  hasHomeItems: boolean,
): MonthlyEnergyRecord[] {
  const index = records.findIndex((record) => record.billingMonth === billingMonth);
  if (!hasHomeItems && index === -1) return [...records];
  if (!hasHomeItems) return [...records];

  const next: MonthlyEnergyRecord = index === -1
    ? {
      billingMonth,
      estimatedKwh: estimate.estimatedKwh,
      estimatedBill: estimate.estimatedBill,
      actualKwh: null,
      actualBill: null,
      estimatedAt: updatedAt,
      actualAt: null,
    }
    : {
      ...records[index],
      estimatedKwh: estimate.estimatedKwh,
      estimatedBill: estimate.estimatedBill,
      estimatedAt: updatedAt,
    };
  return index === -1
    ? [...records, next].sort((left, right) => left.billingMonth.localeCompare(right.billingMonth))
    : records.map((record, recordIndex) => recordIndex === index ? next : record);
}

export function mergeActualBill(
  record: MonthlyEnergyRecord,
  input: { month: string; actualBill: number; actualKwh: number | null },
  updatedAt: number,
): MonthlyEnergyRecord {
  return {
    ...record,
    billingMonth: input.month,
    actualBill: input.actualBill,
    actualKwh: input.actualKwh,
    actualAt: updatedAt,
  };
}

export function removeActualBill(record: MonthlyEnergyRecord): MonthlyEnergyRecord | null {
  if (record.estimatedKwh === null && record.estimatedBill === null) return null;
  return { ...record, actualKwh: null, actualBill: null, actualAt: null };
}

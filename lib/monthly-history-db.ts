import type { HomeSummary } from './home-config.ts';
import type { MonthlyEnergyRecord } from './monthly-history.ts';

type HistoryRow = {
  billing_month: string;
  estimated_kwh: number | null;
  estimated_bill: number | null;
  actual_kwh: number | null;
  actual_bill: number | null;
  estimated_at: number | null;
  actual_at: number | null;
};

export async function readMonthlyEnergyRecords(db: D1Database, householdKey: string): Promise<MonthlyEnergyRecord[]> {
  const result = await db.prepare(
    'SELECT billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill, estimated_at, actual_at FROM monthly_energy_records WHERE household_key = ? ORDER BY billing_month',
  ).bind(householdKey).all<HistoryRow>();
  return result.results.map((row) => ({
    billingMonth: row.billing_month,
    estimatedKwh: row.estimated_kwh,
    estimatedBill: row.estimated_bill,
    actualKwh: row.actual_kwh,
    actualBill: row.actual_bill,
    estimatedAt: row.estimated_at,
    actualAt: row.actual_at,
  }));
}

export async function upsertMonthlyEstimate(
  db: D1Database,
  householdKey: string,
  billingMonth: string,
  summary: Pick<HomeSummary, 'monthlyKwh' | 'monthlyBill'>,
  updatedAt: number,
) {
  await db.prepare(
    `INSERT INTO monthly_energy_records (household_key, billing_month, estimated_kwh, estimated_bill, estimated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(household_key, billing_month) DO UPDATE SET estimated_kwh = excluded.estimated_kwh, estimated_bill = excluded.estimated_bill, estimated_at = excluded.estimated_at`,
  ).bind(householdKey, billingMonth, summary.monthlyKwh, summary.monthlyBill, updatedAt).run();
}

export async function clearMonthlyEstimate(db: D1Database, householdKey: string, billingMonth: string) {
  await db.batch([
    db.prepare(
      `DELETE FROM monthly_energy_records
       WHERE household_key = ? AND billing_month = ? AND actual_bill IS NULL`,
    ).bind(householdKey, billingMonth),
    db.prepare(
      `UPDATE monthly_energy_records
       SET estimated_kwh = NULL, estimated_bill = NULL, estimated_at = NULL
       WHERE household_key = ? AND billing_month = ?`,
    ).bind(householdKey, billingMonth),
  ]);
}

export async function upsertMonthlyActual(
  db: D1Database,
  householdKey: string,
  billingMonth: string,
  actualBill: number,
  actualKwh: number | null,
  updatedAt: number,
) {
  await db.prepare(
    `INSERT INTO monthly_energy_records (household_key, billing_month, actual_kwh, actual_bill, actual_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(household_key, billing_month) DO UPDATE SET actual_kwh = excluded.actual_kwh, actual_bill = excluded.actual_bill, actual_at = excluded.actual_at`,
  ).bind(householdKey, billingMonth, actualKwh, actualBill, updatedAt).run();
}

export async function deleteMonthlyActual(db: D1Database, householdKey: string, billingMonth: string) {
  await db.prepare(
    `DELETE FROM monthly_energy_records
     WHERE household_key = ? AND billing_month = ? AND estimated_kwh IS NULL AND estimated_bill IS NULL`,
  ).bind(householdKey, billingMonth).run();
  await db.prepare(
    `UPDATE monthly_energy_records SET actual_kwh = NULL, actual_bill = NULL, actual_at = NULL
     WHERE household_key = ? AND billing_month = ?`,
  ).bind(householdKey, billingMonth).run();
}


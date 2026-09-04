import type { MonthlyEnergyRecord } from '../monthly-history.ts';
import { HouseholdForbiddenError, HouseholdNotFoundError } from './auth-errors.ts';
import type { HouseholdRole } from './household-access.ts';

const EDIT_ROLES = ['owner', 'admin', 'member'] as const;

type MonthlyAccessRow = {
  role: HouseholdRole;
  billingMonth: string | null;
  estimatedKwh: number | null;
  estimatedBill: number | null;
  actualKwh: number | null;
  actualBill: number | null;
  estimatedAt: number | null;
  actualAt: number | null;
};

function readStatement(db: D1Database, householdId: number, userId: number) {
  return db.prepare(`SELECT household_members.role AS role,
      records.billing_month AS billingMonth,
      records.estimated_kwh AS estimatedKwh, records.estimated_bill AS estimatedBill,
      records.actual_kwh AS actualKwh, records.actual_bill AS actualBill,
      records.estimated_at AS estimatedAt, records.actual_at AS actualAt
    FROM households
    INNER JOIN household_members
      ON household_members.household_id = households.id AND household_members.user_id = ?
    LEFT JOIN household_monthly_energy_records records ON records.household_id = households.id
    WHERE households.id = ? AND households.status = 'active'
    ORDER BY records.billing_month`)
    .bind(userId, householdId);
}

function mapRecords(rows: MonthlyAccessRow[]): MonthlyEnergyRecord[] {
  return rows.filter((row) => row.billingMonth !== null).map((row) => ({
    billingMonth: row.billingMonth as string,
    estimatedKwh: row.estimatedKwh,
    estimatedBill: row.estimatedBill,
    actualKwh: row.actualKwh,
    actualBill: row.actualBill,
    estimatedAt: row.estimatedAt,
    actualAt: row.actualAt,
  }));
}

function requireMutationAccess(rows: MonthlyAccessRow[], householdPublicId: string): MonthlyEnergyRecord[] {
  const role = rows[0]?.role;
  if (!role) throw new HouseholdNotFoundError(householdPublicId);
  if (!EDIT_ROLES.includes(role as (typeof EDIT_ROLES)[number])) {
    throw new HouseholdForbiddenError(householdPublicId);
  }
  return mapRecords(rows);
}

function editGuard() {
  return `EXISTS (SELECT 1 FROM households
    INNER JOIN household_members ON household_members.household_id = households.id
    WHERE households.id = ? AND households.status = 'active'
      AND household_members.user_id = ?
      AND household_members.role IN ('owner', 'admin', 'member'))`;
}

export async function readHouseholdMonthlyRecords(
  db: D1Database,
  householdId: number,
  userId: number,
  householdPublicId: string,
): Promise<MonthlyEnergyRecord[]> {
  const result = await readStatement(db, householdId, userId).all<MonthlyAccessRow>();
  if (!result.results[0]) throw new HouseholdNotFoundError(householdPublicId);
  return mapRecords(result.results);
}

export async function upsertHouseholdMonthlyActual(
  db: D1Database,
  input: {
    householdId: number;
    householdPublicId: string;
    userId: number;
    billingMonth: string;
    actualBill: number;
    actualKwh: number | null;
    now: number;
  },
): Promise<MonthlyEnergyRecord[]> {
  const results = await db.batch([
    db.prepare(`INSERT INTO household_monthly_energy_records
      (household_id, billing_month, actual_kwh, actual_bill, actual_at)
      SELECT ?, ?, ?, ?, ? WHERE ${editGuard()}
      ON CONFLICT(household_id, billing_month) DO UPDATE SET
        actual_kwh = excluded.actual_kwh,
        actual_bill = excluded.actual_bill,
        actual_at = excluded.actual_at`)
      .bind(
        input.householdId,
        input.billingMonth,
        input.actualKwh,
        input.actualBill,
        input.now,
        input.householdId,
        input.userId,
      ),
    readStatement(db, input.householdId, input.userId),
  ]);
  return requireMutationAccess((results[1].results ?? []) as MonthlyAccessRow[], input.householdPublicId);
}

export async function deleteHouseholdMonthlyActual(
  db: D1Database,
  input: {
    householdId: number;
    householdPublicId: string;
    userId: number;
    billingMonth: string;
  },
): Promise<MonthlyEnergyRecord[]> {
  const results = await db.batch([
    db.prepare(`DELETE FROM household_monthly_energy_records
      WHERE household_id = ? AND billing_month = ?
        AND estimated_kwh IS NULL AND estimated_bill IS NULL
        AND ${editGuard()}`)
      .bind(input.householdId, input.billingMonth, input.householdId, input.userId),
    db.prepare(`UPDATE household_monthly_energy_records
      SET actual_kwh = NULL, actual_bill = NULL, actual_at = NULL
      WHERE household_id = ? AND billing_month = ? AND ${editGuard()}`)
      .bind(input.householdId, input.billingMonth, input.householdId, input.userId),
    readStatement(db, input.householdId, input.userId),
  ]);
  return requireMutationAccess((results[2].results ?? []) as MonthlyAccessRow[], input.householdPublicId);
}

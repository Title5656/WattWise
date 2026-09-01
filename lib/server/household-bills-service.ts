import { selectRecentRecords, validateActualBillInput } from '../monthly-history.ts';
import { ValidationError } from './auth-errors.ts';
import { requireHouseholdMember, requireHouseholdRole } from './household-access.ts';
import {
  deleteHouseholdMonthlyActual,
  readHouseholdMonthlyRecords,
  upsertHouseholdMonthlyActual,
} from './household-monthly-repository.ts';
import type { AuthenticatedUser } from './current-user.ts';

const EDIT_ROLES = ['owner', 'admin', 'member'] as const;

export type HouseholdBillsServiceOptions = {
  now?: () => number;
};

function invalid(message: string): never {
  throw new ValidationError(message);
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    invalid('Request body must be valid JSON.');
  }
}

function validateMonth(month: string, now: number): string {
  const validated = validateActualBillInput({ month, actualBill: 0 }, new Date(now));
  if ('error' in validated) invalid(validated.error);
  return validated.month;
}

export function createHouseholdBillsService(options: HouseholdBillsServiceOptions = {}) {
  const now = options.now ?? Date.now;
  return {
    async get(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdMember(db, user.userId, householdPublicId);
      const records = await readHouseholdMonthlyRecords(db, access.householdId, user.userId, householdPublicId);
      return { householdId: householdPublicId, records: selectRecentRecords(records) };
    },

    async put(db: D1Database, user: AuthenticatedUser, householdPublicId: string, month: string, request: Request) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, EDIT_ROLES);
      const body = await jsonBody(request);
      const timestamp = now();
      const input = validateActualBillInput({
        month,
        actualBill: (body as { actualBill?: unknown } | null)?.actualBill,
        actualKwh: (body as { actualKwh?: unknown } | null)?.actualKwh,
      }, new Date(timestamp));
      if ('error' in input) invalid(input.error);
      const records = await upsertHouseholdMonthlyActual(db, {
        householdId: access.householdId,
        householdPublicId,
        userId: user.userId,
        billingMonth: input.month,
        actualBill: input.actualBill,
        actualKwh: input.actualKwh,
        now: timestamp,
      });
      return { householdId: householdPublicId, records: selectRecentRecords(records) };
    },

    async delete(db: D1Database, user: AuthenticatedUser, householdPublicId: string, month: string) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, EDIT_ROLES);
      const billingMonth = validateMonth(month, now());
      const records = await deleteHouseholdMonthlyActual(db, {
        householdId: access.householdId,
        householdPublicId,
        userId: user.userId,
        billingMonth,
      });
      return { householdId: householdPublicId, records: selectRecentRecords(records) };
    },
  };
}

import { createHouseholdBillsApi } from './household-bills-api.ts';
import { getD1Database } from './db.ts';

export const householdBillsApi = createHouseholdBillsApi(getD1Database);

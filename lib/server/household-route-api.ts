import { getD1Database } from './db.ts';
import { createHouseholdApi } from './household-api.ts';

export const householdApi = createHouseholdApi(getD1Database);

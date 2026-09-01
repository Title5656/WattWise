import { getD1Database } from './db.ts';
import { createHouseholdHomeApi } from './household-home-api.ts';

export const householdHomeApi = createHouseholdHomeApi(getD1Database);

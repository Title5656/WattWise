import { createHouseholdDashboardApi } from './household-dashboard-api.ts';
import { getD1Database } from './db.ts';

export const householdDashboardApi = createHouseholdDashboardApi(getD1Database);

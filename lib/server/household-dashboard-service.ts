import { calculateHomeSummary } from '../home-config.ts';
import { selectRecentRecords } from '../monthly-history.ts';
import { readHouseholdHomeSnapshot } from './household-home-repository.ts';
import type { AuthenticatedUser } from './current-user.ts';

export type HouseholdDashboardServiceOptions = {
  now?: () => number;
};

export function createHouseholdDashboardService(options: HouseholdDashboardServiceOptions = {}) {
  const now = options.now ?? Date.now;
  return {
    async get(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const snapshot = await readHouseholdHomeSnapshot(db, user.userId, householdPublicId);
      return {
        household: snapshot.household,
        revision: snapshot.revision,
        items: snapshot.items,
        summary: calculateHomeSummary(snapshot.items, new Date(now())),
        history: selectRecentRecords(snapshot.history),
      };
    },
  };
}

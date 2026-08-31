import { calculateHomeSummary, type HomeAppliance, type HomeSummary } from './home-config.ts';
import { selectRecentRecords, type MonthlyEnergyRecord } from './monthly-history.ts';
import { readMonthlyEnergyRecords } from './monthly-history-db.ts';

export type HomeResponse = {
  items: HomeAppliance[];
  summary: HomeSummary;
  history: MonthlyEnergyRecord[];
};

export async function readHomeResponse(
  db: D1Database,
  householdKey: string,
  items: HomeAppliance[],
  now = Date.now(),
  onHistoryError: (error: unknown) => void = () => undefined,
): Promise<HomeResponse> {
  const summary = calculateHomeSummary(items, new Date(now));
  try {
    return { items, summary, history: selectRecentRecords(await readMonthlyEnergyRecords(db, householdKey)) };
  } catch (error) {
    onHistoryError(error);
    return { items, summary, history: [] };
  }
}

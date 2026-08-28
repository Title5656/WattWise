import { hydrateHomeItem, type HomeAppliance } from './home-config.ts';

export const householdKey = 'default-home';

type SavedRow = { id: number; appliance_key: string; quantity: number; hours_per_day: number; cycles_per_month: number | null; usage_schedule: string | null };

export async function readSavedHomeItems(db: D1Database): Promise<HomeAppliance[]> {
  const result = await db.prepare(
    'SELECT id, appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule FROM saved_home_appliances WHERE household_key = ? ORDER BY position, id',
  ).bind(householdKey).all<SavedRow>();
  return result.results.map((row) => hydrateHomeItem({
    id: row.id,
    applianceKey: row.appliance_key,
    quantity: row.quantity,
    hoursPerDay: row.hours_per_day,
    cyclesPerMonth: row.cycles_per_month,
    usageSchedule: row.usage_schedule,
  })).filter((item): item is HomeAppliance => item !== null);
}

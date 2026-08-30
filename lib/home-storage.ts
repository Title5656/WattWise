import { mapCatalogRow, type CatalogRow } from './catalog-repository.ts';
import { hydrateHomeItem, type HomeAppliance } from './home-config.ts';

export const householdKey = 'default-home';

type SavedRow = {
  id: number;
  appliance_key: string;
  quantity: number;
  hours_per_day: number;
  cycles_per_month: number | null;
  usage_schedule: string | null;
};

type SavedCatalogRow = SavedRow & Omit<CatalogRow, 'catalogKey'> & { catalogKey: string | null };

export async function readSavedHomeItems(db: D1Database): Promise<HomeAppliance[]> {
  const result = await db.prepare(
    `SELECT s.id, s.appliance_key, s.quantity, s.hours_per_day, s.cycles_per_month, s.usage_schedule,
      m.catalog_key AS catalogKey, c.slug AS categorySlug, c.name_th AS categoryName,
      b.name AS brand, m.model_code AS model, m.display_name AS displayName,
      m.calculation_method AS calculationMethod, m.rated_power_w AS ratedPowerW,
      m.annual_energy_kwh AS annualEnergyKwh, m.energy_per_cycle_kwh AS energyPerCycleKwh,
      m.load_factor AS loadFactor, m.usage_profile AS usageProfile,
      m.capacity_value AS capacityValue, m.capacity_unit AS capacityUnit,
      m.efficiency_label AS efficiencyLabel, m.source_url AS sourceUrl,
      m.source_name AS sourceName, m.verified_at AS verifiedAt, m.confidence AS confidence
     FROM saved_home_appliances s
     LEFT JOIN appliance_models m ON m.catalog_key = s.appliance_key
     LEFT JOIN categories c ON c.id = m.category_id
     LEFT JOIN brands b ON b.id = m.brand_id
     WHERE s.household_key = ?
     ORDER BY s.position, s.id`,
  ).bind(householdKey).all<SavedCatalogRow>();
  return result.results.map((row) => {
    if (row.catalogKey === null) throw new Error(`Unknown saved appliance key: ${row.appliance_key}`);
    const appliance = mapCatalogRow(row as CatalogRow);
    return hydrateHomeItem({
      id: row.id,
      applianceKey: row.appliance_key,
      quantity: row.quantity,
      hoursPerDay: row.hours_per_day,
      cyclesPerMonth: row.cycles_per_month,
      usageSchedule: row.usage_schedule,
    }, appliance);
  });
}

import { mapCatalogRow, type CatalogRow } from '../catalog-repository.ts';
import { hydrateHomeItem, type HomeAppliance, type HomeSummary } from '../home-config.ts';
import type { MonthlyEnergyRecord } from '../monthly-history.ts';

export type HouseholdHomeSnapshot = {
  revision: number;
  items: HomeAppliance[];
};

export type PersistedHouseholdHomeItem = {
  modelId: number;
  instanceKey: string;
  quantity: number;
  hoursPerDay: number;
  cyclesPerMonth: number | null;
  usageSchedule: string;
  position: number;
};

type HouseholdHomeRow = Omit<CatalogRow, 'catalogKey'> & {
  revision: number;
  id: number | null;
  catalogKey: string | null;
  instanceKey: string | null;
  quantity: number;
  hoursPerDay: number;
  cyclesPerMonth: number | null;
  usageSchedule: string | null;
};

type HistoryRow = {
  billingMonth: string;
  estimatedKwh: number | null;
  estimatedBill: number | null;
  actualKwh: number | null;
  actualBill: number | null;
  estimatedAt: number | null;
  actualAt: number | null;
};

const INSERT_CHUNK_SIZE = 8;

export async function readHouseholdHomeSnapshot(
  db: D1Database,
  householdId: number,
): Promise<HouseholdHomeSnapshot> {
  const result = await db.prepare(`SELECT households.home_revision AS revision,
        h.id, h.instance_key AS instanceKey, h.quantity,
        h.hours_per_day AS hoursPerDay, h.cycles_per_month AS cyclesPerMonth,
        h.usage_schedule AS usageSchedule, m.catalog_key AS catalogKey,
        c.slug AS categorySlug, c.name_th AS categoryName,
        b.name AS brand, m.model_code AS model, m.display_name AS displayName,
        m.calculation_method AS calculationMethod, m.rated_power_w AS ratedPowerW,
        m.annual_energy_kwh AS annualEnergyKwh, m.energy_per_cycle_kwh AS energyPerCycleKwh,
        m.load_factor AS loadFactor, m.usage_profile AS usageProfile,
        m.capacity_value AS capacityValue, m.capacity_unit AS capacityUnit,
        m.efficiency_label AS efficiencyLabel, m.source_url AS sourceUrl,
        m.source_name AS sourceName, m.verified_at AS verifiedAt, m.confidence AS confidence
      FROM households
      LEFT JOIN household_appliances h ON h.household_id = households.id
      LEFT JOIN appliance_models m ON m.id = h.appliance_model_id
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN brands b ON b.id = m.brand_id
      WHERE households.id = ?
      ORDER BY h.position, h.id`)
      .bind(householdId)
      .all<HouseholdHomeRow>();
  const revision = result.results[0]?.revision;
  if (!Number.isInteger(revision)) throw new Error('Authorized household disappeared while reading Home.');
  const items = result.results.filter((row) => row.id !== null).map((row) => {
    if (row.id === null) throw new Error('Unexpected empty household appliance row.');
    if (row.catalogKey === null || row.instanceKey === null) {
      throw new Error(`Household appliance ${row.id} has no canonical catalog or instance key.`);
    }
    return hydrateHomeItem({
      id: row.id,
      instanceKey: row.instanceKey,
      applianceKey: row.catalogKey,
      quantity: row.quantity,
      hoursPerDay: row.hoursPerDay,
      cyclesPerMonth: row.cyclesPerMonth,
      usageSchedule: row.usageSchedule,
    }, mapCatalogRow(row as CatalogRow));
  });
  return { revision, items };
}

export async function readHouseholdMonthlyEnergyRecords(
  db: D1Database,
  householdId: number,
): Promise<MonthlyEnergyRecord[]> {
  const result = await db.prepare(`SELECT billing_month AS billingMonth,
      estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill,
      actual_kwh AS actualKwh, actual_bill AS actualBill,
      estimated_at AS estimatedAt, actual_at AS actualAt
    FROM household_monthly_energy_records
    WHERE household_id = ? ORDER BY billing_month`)
    .bind(householdId)
    .all<HistoryRow>();
  return result.results;
}

export async function readHouseholdHomeRevision(db: D1Database, householdId: number): Promise<number> {
  const result = await db.prepare('SELECT home_revision AS revision FROM households WHERE id = ?')
    .bind(householdId)
    .all<{ revision: number }>();
  return Number(result.results[0]?.revision ?? 0);
}

function revisionGuard(householdId: number, expectedRevision: number, userId: number) {
  return {
    sql: `households.id = ? AND households.status = 'active' AND households.home_revision = ?
      AND EXISTS (SELECT 1 FROM household_members
        WHERE household_members.household_id = households.id
          AND household_members.user_id = ?
          AND household_members.role IN ('owner', 'admin', 'member'))`,
    values: [householdId, expectedRevision, userId],
  };
}

function prepareItemInserts(
  db: D1Database,
  householdId: number,
  expectedRevision: number,
  userId: number,
  items: PersistedHouseholdHomeItem[],
  now: number,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const guard = revisionGuard(householdId, expectedRevision, userId);
  for (let offset = 0; offset < items.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = items.slice(offset, offset + INSERT_CHUNK_SIZE);
    const selects = chunk.map(() => 'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?').join(' UNION ALL ');
    const bindings = chunk.flatMap((item) => [
      householdId,
      item.modelId,
      item.quantity,
      item.hoursPerDay,
      item.cyclesPerMonth,
      item.usageSchedule,
      item.instanceKey,
      item.position,
      now,
      now,
    ]);
    statements.push(db.prepare(`INSERT INTO household_appliances
      (household_id, appliance_model_id, quantity, hours_per_day, cycles_per_month,
       usage_schedule, instance_key, position, created_at, updated_at)
      SELECT * FROM (${selects})
      WHERE EXISTS (SELECT 1 FROM households WHERE ${guard.sql})`)
      .bind(...bindings, ...guard.values));
  }
  return statements;
}

function prepareEstimateMutations(
  db: D1Database,
  householdId: number,
  expectedRevision: number,
  userId: number,
  billingMonth: string,
  summary: Pick<HomeSummary, 'monthlyKwh' | 'monthlyBill'>,
  now: number,
  hasItems: boolean,
): D1PreparedStatement[] {
  const guard = revisionGuard(householdId, expectedRevision, userId);
  if (hasItems) {
    return [db.prepare(`INSERT INTO household_monthly_energy_records
      (household_id, billing_month, estimated_kwh, estimated_bill, estimated_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM households WHERE ${guard.sql})
      ON CONFLICT(household_id, billing_month) DO UPDATE SET
        estimated_kwh = excluded.estimated_kwh,
        estimated_bill = excluded.estimated_bill,
        estimated_at = excluded.estimated_at`)
      .bind(householdId, billingMonth, summary.monthlyKwh, summary.monthlyBill, now, ...guard.values)];
  }
  return [
    db.prepare(`DELETE FROM household_monthly_energy_records
      WHERE household_id = ? AND billing_month = ?
        AND actual_kwh IS NULL AND actual_bill IS NULL
        AND EXISTS (SELECT 1 FROM households WHERE ${guard.sql})`)
      .bind(householdId, billingMonth, ...guard.values),
    db.prepare(`UPDATE household_monthly_energy_records
      SET estimated_kwh = NULL, estimated_bill = NULL, estimated_at = NULL
      WHERE household_id = ? AND billing_month = ?
        AND EXISTS (SELECT 1 FROM households WHERE ${guard.sql})`)
      .bind(householdId, billingMonth, ...guard.values),
  ];
}

export async function replaceHouseholdHome(
  db: D1Database,
  input: {
    householdId: number;
    expectedRevision: number;
    userId: number;
    items: PersistedHouseholdHomeItem[];
    billingMonth: string;
    summary: Pick<HomeSummary, 'monthlyKwh' | 'monthlyBill'>;
    now: number;
  },
): Promise<boolean> {
  const guard = revisionGuard(input.householdId, input.expectedRevision, input.userId);
  const results = await db.batch([
    db.prepare(`DELETE FROM household_appliances
      WHERE household_id = ? AND EXISTS (SELECT 1 FROM households WHERE ${guard.sql})`)
      .bind(input.householdId, ...guard.values),
    ...prepareItemInserts(db, input.householdId, input.expectedRevision, input.userId, input.items, input.now),
    ...prepareEstimateMutations(
      db,
      input.householdId,
      input.expectedRevision,
      input.userId,
      input.billingMonth,
      input.summary,
      input.now,
      input.items.length > 0,
    ),
    db.prepare(`UPDATE households SET home_revision = home_revision + 1, updated_at = ?
      WHERE ${guard.sql}`)
      .bind(input.now, ...guard.values),
  ]);
  return Number(results.at(-1)?.meta?.changes ?? 0) === 1;
}

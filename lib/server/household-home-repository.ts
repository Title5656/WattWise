import { mapCatalogRow, type CatalogRow } from '../catalog-repository.ts';
import { hydrateHomeItem, type HomeAppliance, type HomeSummary } from '../home-config.ts';
import type { MonthlyEnergyRecord } from '../monthly-history.ts';
import { HouseholdForbiddenError, HouseholdNotFoundError } from './auth-errors.ts';
import type { HouseholdRole } from './household-access.ts';
import type { HouseholdSummary } from './household-repository.ts';

export type HouseholdHomeSnapshot = {
  household: HouseholdSummary;
  revision: number;
  items: HomeAppliance[];
  history: MonthlyEnergyRecord[];
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

type HouseholdApplianceIdentity = {
  modelId: number;
  instanceKey: string;
};

export type HouseholdHomeValidationState = {
  currentRevision: number;
  existingItems: HouseholdApplianceIdentity[];
};

type HouseholdHomeRow = Omit<CatalogRow, 'catalogKey'> & {
  householdPublicId: string;
  householdName: string;
  householdProvince: string | null;
  householdElectricityProvider: string | null;
  householdRole: HouseholdRole;
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

export async function readHouseholdHomeValidationState(
  db: D1Database,
  householdId: number,
  userId: number,
): Promise<HouseholdHomeValidationState | null> {
  const rows = await db.prepare(`SELECT households.home_revision AS currentRevision,
      household_appliances.appliance_model_id AS modelId,
      household_appliances.instance_key AS instanceKey
    FROM households
    INNER JOIN household_members
      ON household_members.household_id = households.id
      AND household_members.user_id = ?
      AND household_members.role IN ('owner', 'admin', 'member')
    LEFT JOIN household_appliances ON household_appliances.household_id = households.id
    WHERE households.id = ? AND households.status = 'active'
    ORDER BY household_appliances.id`)
    .bind(userId, householdId)
    .all<{ currentRevision: number; modelId: number | null; instanceKey: string | null }>();
  const first = rows.results[0];
  if (!first) return null;
  return {
    currentRevision: first.currentRevision,
    existingItems: rows.results.flatMap((row) => row.modelId === null || row.instanceKey === null
      ? []
      : [{ modelId: row.modelId, instanceKey: row.instanceKey }]),
  };
}

export async function readHouseholdHomeSnapshot(
  db: D1Database,
  userId: number,
  householdPublicId: string,
): Promise<HouseholdHomeSnapshot> {
  const results = await db.batch([
    db.prepare(`SELECT households.public_id AS householdPublicId,
        households.name AS householdName, households.province AS householdProvince,
        households.electricity_provider AS householdElectricityProvider,
        household_members.role AS householdRole, households.home_revision AS revision,
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
      INNER JOIN household_members
        ON household_members.household_id = households.id AND household_members.user_id = ?
      LEFT JOIN household_appliances h ON h.household_id = households.id
      LEFT JOIN appliance_models m ON m.id = h.appliance_model_id
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN brands b ON b.id = m.brand_id
      WHERE households.public_id = ? AND households.status = 'active'
      ORDER BY h.position, h.id`)
      .bind(userId, householdPublicId),
    db.prepare(`SELECT records.billing_month AS billingMonth,
        records.estimated_kwh AS estimatedKwh, records.estimated_bill AS estimatedBill,
        records.actual_kwh AS actualKwh, records.actual_bill AS actualBill,
        records.estimated_at AS estimatedAt, records.actual_at AS actualAt
      FROM households
      INNER JOIN household_members
        ON household_members.household_id = households.id AND household_members.user_id = ?
      INNER JOIN household_monthly_energy_records records ON records.household_id = households.id
      WHERE households.public_id = ? AND households.status = 'active'
      ORDER BY records.billing_month`)
      .bind(userId, householdPublicId),
  ]);
  const snapshotRows = (results[0].results ?? []) as HouseholdHomeRow[];
  const historyRows = (results[1].results ?? []) as HistoryRow[];
  const revision = snapshotRows[0]?.revision;
  if (!Number.isInteger(revision)) throw new HouseholdNotFoundError(householdPublicId);
  const householdRow = snapshotRows[0];
  if (!householdRow) throw new HouseholdNotFoundError(householdPublicId);
  const household: HouseholdSummary = {
    id: householdRow.householdPublicId,
    name: householdRow.householdName,
    province: householdRow.householdProvince,
    electricityProvider: householdRow.householdElectricityProvider,
    role: householdRow.householdRole,
  };
  const items = snapshotRows.filter((row) => row.id !== null).map((row) => {
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
  return { household, revision, items, history: historyRows };
}

export async function resolveHouseholdHomeConflict(
  db: D1Database,
  userId: number,
  householdPublicId: string,
): Promise<number> {
  const result = await db.prepare(`SELECT households.home_revision AS currentRevision,
      household_members.role AS role
    FROM households
    INNER JOIN household_members
      ON household_members.household_id = households.id AND household_members.user_id = ?
    WHERE households.public_id = ? AND households.status = 'active'`)
    .bind(userId, householdPublicId)
    .all<{ currentRevision: number; role: HouseholdRole }>();
  const row = result.results[0];
  if (!row) throw new HouseholdNotFoundError(householdPublicId);
  if (!['owner', 'admin', 'member'].includes(row.role)) throw new HouseholdForbiddenError(householdPublicId);
  return row.currentRevision;
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
  if (items.length === 0) return [];
  const guard = revisionGuard(householdId, expectedRevision, userId);
  const payload = JSON.stringify(items);
  return [db.prepare(`INSERT INTO household_appliances
      (household_id, appliance_model_id, quantity, hours_per_day, cycles_per_month,
       usage_schedule, instance_key, position, created_at, updated_at)
      SELECT ?,
        CAST(json_extract(item.value, '$.modelId') AS INTEGER),
        CAST(json_extract(item.value, '$.quantity') AS INTEGER),
        CAST(json_extract(item.value, '$.hoursPerDay') AS REAL),
        CASE WHEN json_type(item.value, '$.cyclesPerMonth') = 'null' THEN NULL
          ELSE CAST(json_extract(item.value, '$.cyclesPerMonth') AS REAL) END,
        json_extract(item.value, '$.usageSchedule'),
        json_extract(item.value, '$.instanceKey'),
        CAST(json_extract(item.value, '$.position') AS INTEGER),
        ?, ?
      FROM json_each(?) AS item
      WHERE EXISTS (SELECT 1 FROM households WHERE ${guard.sql})`)
    .bind(householdId, now, now, payload, ...guard.values)];
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
): Promise<{ saved: boolean; history: MonthlyEnergyRecord[] }> {
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
    db.prepare(`SELECT records.billing_month AS billingMonth,
        records.estimated_kwh AS estimatedKwh, records.estimated_bill AS estimatedBill,
        records.actual_kwh AS actualKwh, records.actual_bill AS actualBill,
        records.estimated_at AS estimatedAt, records.actual_at AS actualAt
      FROM household_monthly_energy_records records
      WHERE records.household_id = ?
        AND EXISTS (SELECT 1 FROM households WHERE ${guard.sql})
      ORDER BY records.billing_month`)
      .bind(input.householdId, ...guard.values),
    db.prepare(`UPDATE households SET home_revision = home_revision + 1, updated_at = ?
      WHERE ${guard.sql}`)
      .bind(input.now, ...guard.values),
  ]);
  const saved = Number(results.at(-1)?.meta?.changes ?? 0) === 1;
  const historyResult = results.at(-2);
  return {
    saved,
    history: saved ? ((historyResult?.results ?? []) as HistoryRow[]) : [],
  };
}

import type { HouseholdRole } from './household-access.ts';

export type HouseholdSummary = {
  id: string;
  name: string;
  province: string | null;
  electricityProvider: string | null;
  role: HouseholdRole;
};

type HouseholdRow = {
  id: string;
  name: string;
  province: string | null;
  electricityProvider: string | null;
  role: HouseholdRole;
};

export async function listActiveHouseholds(db: D1Database, userId: number): Promise<HouseholdSummary[]> {
  const rows = await db.prepare(`SELECT households.public_id AS id, households.name AS name,
      households.province AS province, households.electricity_provider AS electricityProvider,
      household_members.role AS role
    FROM household_members
    INNER JOIN households ON households.id = household_members.household_id
    WHERE household_members.user_id = ? AND households.status = 'active'
    ORDER BY household_members.created_at, households.id`)
    .bind(userId)
    .all<HouseholdRow>();
  return rows.results.map(toHousehold);
}

export async function readActiveHousehold(
  db: D1Database,
  householdId: number,
  userId: number,
): Promise<HouseholdSummary | null> {
  const rows = await db.prepare(`SELECT households.public_id AS id, households.name AS name,
      households.province AS province, households.electricity_provider AS electricityProvider,
      household_members.role AS role
    FROM households
    INNER JOIN household_members ON household_members.household_id = households.id
    WHERE households.id = ? AND households.status = 'active' AND household_members.user_id = ?`)
    .bind(householdId, userId)
    .all<HouseholdRow>();
  const row = rows.results[0];
  return row ? toHousehold(row) : null;
}

export async function createHouseholdWithOwner(
  db: D1Database,
  input: {
    publicId: string;
    userId: number;
    name: string;
    province: string | null;
    electricityProvider: string | null;
    now: number;
  },
): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO households
      (public_id, name, province, electricity_provider, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .bind(input.publicId, input.name, input.province, input.electricityProvider, input.now, input.now),
    db.prepare(`INSERT INTO household_members
      (household_id, user_id, role, created_at, updated_at)
      VALUES (last_insert_rowid(), ?, 'owner', ?, ?)`)
      .bind(input.userId, input.now, input.now),
  ]);
}

export async function updateActiveHousehold(
  db: D1Database,
  householdId: number,
  patch: {
    name?: string;
    province?: string | null;
    electricityProvider?: string | null;
    now: number;
  },
): Promise<void> {
  await db.prepare(`UPDATE households SET
      name = CASE WHEN ? = 1 THEN ? ELSE name END,
      province = CASE WHEN ? = 1 THEN ? ELSE province END,
      electricity_provider = CASE WHEN ? = 1 THEN ? ELSE electricity_provider END,
      updated_at = ?
    WHERE id = ? AND status = 'active'`)
    .bind(
      patch.name === undefined ? 0 : 1,
      patch.name ?? null,
      patch.province === undefined ? 0 : 1,
      patch.province ?? null,
      patch.electricityProvider === undefined ? 0 : 1,
      patch.electricityProvider ?? null,
      patch.now,
      householdId,
    )
    .run();
}

export async function softDeleteHousehold(db: D1Database, householdId: number, now: number): Promise<void> {
  await db.prepare("UPDATE households SET status = 'deleted', updated_at = ? WHERE id = ? AND status = 'active'")
    .bind(now, householdId)
    .run();
}

function toHousehold(row: HouseholdRow): HouseholdSummary {
  return {
    id: row.id,
    name: row.name,
    province: row.province,
    electricityProvider: row.electricityProvider,
    role: row.role,
  };
}

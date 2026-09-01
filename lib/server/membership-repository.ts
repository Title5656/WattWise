import type { HouseholdRole } from './household-access.ts';

export type HouseholdMember = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: HouseholdRole;
};

type MemberRow = HouseholdMember & { internalUserId: number };

export async function listHouseholdMembers(db: D1Database, householdId: number): Promise<HouseholdMember[]> {
  const rows = await db.prepare(`SELECT users.public_id AS id, users.email AS email,
      COALESCE(users.display_name, users.email) AS displayName, users.avatar_url AS avatarUrl,
      household_members.role AS role
    FROM household_members
    INNER JOIN users ON users.id = household_members.user_id
    WHERE household_members.household_id = ?
    ORDER BY CASE household_members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
      household_members.created_at, users.id`)
    .bind(householdId)
    .all<HouseholdMember>();
  return rows.results.map((row) => ({ ...row }));
}

export async function findHouseholdMember(
  db: D1Database,
  householdId: number,
  userPublicId: string,
): Promise<MemberRow | null> {
  const rows = await db.prepare(`SELECT users.id AS internalUserId, users.public_id AS id, users.email AS email,
      COALESCE(users.display_name, users.email) AS displayName, users.avatar_url AS avatarUrl,
      household_members.role AS role
    FROM household_members
    INNER JOIN users ON users.id = household_members.user_id
    WHERE household_members.household_id = ? AND users.public_id = ?`)
    .bind(householdId, userPublicId)
    .all<MemberRow>();
  const row = rows.results[0];
  return row ? { ...row } : null;
}

export async function updateMemberRole(
  db: D1Database,
  householdId: number,
  userId: number,
  role: HouseholdRole,
  now: number,
): Promise<void> {
  await db.prepare('UPDATE household_members SET role = ?, updated_at = ? WHERE household_id = ? AND user_id = ?')
    .bind(role, now, householdId, userId)
    .run();
}

export async function removeMember(db: D1Database, householdId: number, userId: number): Promise<void> {
  await db.prepare('DELETE FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId)
    .run();
}

export async function transferHouseholdOwnership(
  db: D1Database,
  householdId: number,
  currentOwnerId: number,
  nextOwnerId: number,
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE household_members SET role = 'admin', updated_at = ? WHERE household_id = ? AND user_id = ? AND role = 'owner'")
      .bind(now, householdId, currentOwnerId),
    db.prepare("UPDATE household_members SET role = 'owner', updated_at = ? WHERE household_id = ? AND user_id = ? AND role <> 'owner'")
      .bind(now, householdId, nextOwnerId),
  ]);
}

export async function hasActiveMemberWithEmail(
  db: D1Database,
  householdId: number,
  email: string,
): Promise<boolean> {
  const rows = await db.prepare(`SELECT 1 AS found
    FROM household_members
    INNER JOIN users ON users.id = household_members.user_id
    WHERE household_members.household_id = ? AND lower(trim(users.email)) = ?
    LIMIT 1`)
    .bind(householdId, email)
    .all<{ found: number }>();
  return rows.results.length > 0;
}

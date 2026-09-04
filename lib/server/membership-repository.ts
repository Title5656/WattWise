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
  expectedRole: HouseholdRole,
  role: HouseholdRole,
  now: number,
): Promise<boolean> {
  const result = await db.prepare(`UPDATE household_members SET role = ?, updated_at = ?
    WHERE household_id = ? AND user_id = ? AND role = ?`)
    .bind(role, now, householdId, userId, expectedRole)
    .run();
  return Number(result.meta.changes) === 1;
}

export async function removeMember(
  db: D1Database,
  householdId: number,
  userId: number,
  expectedRole: HouseholdRole,
): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM household_members
    WHERE household_id = ? AND user_id = ? AND role = ? AND role <> 'owner'`)
    .bind(householdId, userId, expectedRole)
    .run();
  return Number(result.meta.changes) === 1;
}

export async function transferHouseholdOwnership(
  db: D1Database,
  householdId: number,
  currentOwnerId: number,
  nextOwnerId: number,
  now: number,
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`UPDATE household_members SET role = 'admin', updated_at = ?
      WHERE household_id = ? AND user_id = ? AND role = 'owner'
        AND EXISTS (SELECT 1 FROM household_members AS target
          WHERE target.household_id = ? AND target.user_id = ? AND target.role <> 'owner')`)
      .bind(now, householdId, currentOwnerId, householdId, nextOwnerId),
    db.prepare(`UPDATE household_members SET role = 'owner', updated_at = ?
      WHERE household_id = ? AND user_id = ? AND role <> 'owner' AND changes() = 1
        AND NOT EXISTS (SELECT 1 FROM household_members AS owner
          WHERE owner.household_id = ? AND owner.role = 'owner')
        AND EXISTS (SELECT 1 FROM household_members AS previous_owner
          WHERE previous_owner.household_id = ? AND previous_owner.user_id = ? AND previous_owner.role = 'admin')`)
      .bind(now, householdId, nextOwnerId, householdId, householdId, currentOwnerId),
    db.prepare(`UPDATE household_members
      SET role = CASE
        WHEN (SELECT COUNT(*) FROM household_members AS owner
          WHERE owner.household_id = ? AND owner.role = 'owner') = 1
        THEN role ELSE '__owner_invariant_failed__' END
      WHERE household_id = ? AND user_id = ?`)
      .bind(householdId, householdId, currentOwnerId),
  ]);
  return Number(results[0].meta.changes) === 1 && Number(results[1].meta.changes) === 1;
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

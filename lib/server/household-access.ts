import { HouseholdForbiddenError, HouseholdNotFoundError } from './auth-errors.ts';

export type HouseholdRole = 'owner' | 'admin' | 'member' | 'viewer';

export type HouseholdAccess = {
  userId: number;
  householdId: number;
  householdPublicId: string;
  role: HouseholdRole;
};

export async function requireHouseholdMember(
  db: D1Database,
  userId: number,
  householdPublicId: string,
): Promise<HouseholdAccess> {
  const result = await db.prepare(`SELECT household_members.user_id AS userId,
      households.id AS householdId, households.public_id AS householdPublicId,
      household_members.role AS role
    FROM households
    INNER JOIN household_members ON household_members.household_id = households.id
    WHERE households.public_id = ? AND households.status = 'active' AND household_members.user_id = ?`)
    .bind(householdPublicId, userId)
    .all<HouseholdAccess>();
  const row = result.results[0];
  if (!row) throw new HouseholdNotFoundError(householdPublicId);
  return {
    userId: row.userId,
    householdId: row.householdId,
    householdPublicId: row.householdPublicId,
    role: row.role,
  };
}

export async function requireHouseholdRole(
  db: D1Database,
  userId: number,
  householdPublicId: string,
  allowedRoles: readonly HouseholdRole[],
): Promise<HouseholdAccess> {
  const access = await requireHouseholdMember(db, userId, householdPublicId);
  if (!allowedRoles.includes(access.role)) throw new HouseholdForbiddenError(householdPublicId);
  return access;
}

export function canAssignRole(actor: HouseholdRole, nextRole: HouseholdRole): boolean {
  if (nextRole === 'owner') return false;
  return actor === 'owner' || (actor === 'admin' && (nextRole === 'member' || nextRole === 'viewer'));
}

export function canRemoveRole(actor: HouseholdRole, targetRole: HouseholdRole): boolean {
  if (targetRole === 'owner') return false;
  return actor === 'owner' || (actor === 'admin' && (targetRole === 'member' || targetRole === 'viewer'));
}

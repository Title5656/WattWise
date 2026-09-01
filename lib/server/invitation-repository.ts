import type { HouseholdRole } from './household-access.ts';

export type InvitationRole = Exclude<HouseholdRole, 'owner'>;

export type StoredHouseholdInvitation = {
  internalId: number;
  email: string;
  role: InvitationRole;
  expiresAt: number;
  createdAt: number;
  tokenHash: string;
};

type InvitationRow = {
  id: number;
  email: string;
  role: InvitationRole;
  expiresAt: number;
  createdAt: number;
  householdId: number;
  householdPublicId: string;
  householdName: string;
  tokenHash: string;
  acceptedAt: number | null;
  revokedAt: number | null;
  householdStatus: string;
};

export async function listActiveInvitations(
  db: D1Database,
  householdId: number,
  now: number,
): Promise<StoredHouseholdInvitation[]> {
  const rows = await db.prepare(`SELECT id AS internalId, email_normalized AS email, role AS role,
      expires_at AS expiresAt, created_at AS createdAt, token_hash AS tokenHash
    FROM household_invites
    WHERE household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    ORDER BY created_at, id`)
    .bind(householdId, now)
    .all<StoredHouseholdInvitation>();
  return rows.results.map((row) => ({ ...row }));
}

export async function hasEquivalentActiveInvitation(
  db: D1Database,
  householdId: number,
  email: string,
  now: number,
): Promise<boolean> {
  const rows = await db.prepare(`SELECT 1 AS found FROM household_invites
    WHERE household_id = ? AND email_normalized = ?
      AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    LIMIT 1`)
    .bind(householdId, email, now)
    .all<{ found: number }>();
  return rows.results.length > 0;
}

export async function createInvitation(
  db: D1Database,
  input: {
    householdId: number;
    invitedByUserId: number;
    email: string;
    role: InvitationRole;
    tokenHash: string;
    expiresAt: number;
    now: number;
  },
): Promise<void> {
  await db.prepare(`INSERT INTO household_invites
      (household_id, invited_by_user_id, email_normalized, role, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.householdId,
      input.invitedByUserId,
      input.email,
      input.role,
      input.tokenHash,
      input.expiresAt,
      input.now,
    )
    .run();
}

export async function findInvitationByHash(db: D1Database, tokenHash: string): Promise<InvitationRow | null> {
  const rows = await db.prepare(`SELECT household_invites.id AS id,
      household_invites.household_id AS householdId, households.public_id AS householdPublicId,
      households.name AS householdName, household_invites.email_normalized AS email,
      household_invites.role AS role, household_invites.token_hash AS tokenHash,
      household_invites.expires_at AS expiresAt, household_invites.created_at AS createdAt,
      household_invites.accepted_at AS acceptedAt, household_invites.revoked_at AS revokedAt,
      households.status AS householdStatus
    FROM household_invites
    INNER JOIN households ON households.id = household_invites.household_id
    WHERE household_invites.token_hash = ?`)
    .bind(tokenHash)
    .all<InvitationRow>();
  const row = rows.results[0];
  return row ? { ...row } : null;
}

export async function revokeInvitation(
  db: D1Database,
  householdId: number,
  invitationId: number,
  now: number,
): Promise<boolean> {
  const result = await db.prepare(`UPDATE household_invites SET revoked_at = ?
    WHERE id = ? AND household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
    .bind(now, invitationId, householdId, now)
    .run();
  return Number(result.meta.changes) === 1;
}

export async function acceptInvitationAtomically(
  db: D1Database,
  invitation: InvitationRow,
  userId: number,
  now: number,
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`UPDATE household_invites SET accepted_at = ?
      WHERE id = ? AND token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
      .bind(now, invitation.id, invitation.tokenHash, now),
    db.prepare(`INSERT INTO household_members (household_id, user_id, role, created_at, updated_at)
      SELECT household_id, ?, role, ?, ? FROM household_invites
      WHERE id = ? AND accepted_at = ? AND changes() = 1`)
      .bind(userId, now, now, invitation.id, now),
  ]);
  return Number(results[0].meta.changes) === 1 && Number(results[1].meta.changes) === 1;
}

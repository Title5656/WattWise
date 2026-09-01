import {
  HouseholdForbiddenError,
  HouseholdNotFoundError,
  MemberNotFoundError,
  StateConflictError,
  ValidationError,
} from './auth-errors.ts';
import {
  canAssignRole,
  canRemoveRole,
  requireHouseholdMember,
  requireHouseholdRole,
  type HouseholdRole,
} from './household-access.ts';
import {
  createHouseholdWithOwner,
  listActiveHouseholds,
  readActiveHousehold,
  softDeleteHousehold,
  updateActiveHousehold,
} from './household-repository.ts';
import {
  acceptInvitationAtomically,
  createInvitation,
  findInvitationByHash,
  listActiveInvitations,
  revokeInvitation,
  type InvitationRole,
} from './invitation-repository.ts';
import {
  findHouseholdMember,
  hasActiveMemberWithEmail,
  listHouseholdMembers,
  removeMember,
  transferHouseholdOwnership,
  updateMemberRole,
} from './membership-repository.ts';
import type { AuthenticatedUser } from './current-user.ts';

const NAME_MAX = 100;
const PROVINCE_MAX = 100;
const PROVIDER_MAX = 50;
const EMAIL_MAX = 254;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_ROLES = new Set<HouseholdRole>(['admin', 'member', 'viewer']);

export type HouseholdServiceOptions = {
  now?: () => number;
  createHouseholdPublicId?: () => string;
  createInvitationToken?: () => string;
};

export function createHouseholdService(options: HouseholdServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const createHouseholdPublicId = options.createHouseholdPublicId ?? defaultHouseholdPublicId;
  const createInvitationToken = options.createInvitationToken ?? defaultInvitationToken;

  return {
    async listHouseholds(db: D1Database, user: AuthenticatedUser) {
      return listActiveHouseholds(db, user.userId);
    },

    async createHousehold(db: D1Database, user: AuthenticatedUser, body: unknown) {
      const input = householdCreateInput(body);
      const publicId = createHouseholdPublicId();
      const timestamp = now();
      try {
        await createHouseholdWithOwner(db, {
          publicId,
          userId: user.userId,
          name: input.name,
          province: input.province,
          electricityProvider: input.electricityProvider,
          now: timestamp,
        });
      } catch (error) {
        throw conflictFromDatabase(error, 'HOUSEHOLD_CONFLICT', 'Household could not be created.');
      }
      return { id: publicId, ...input, role: 'owner' as const };
    },

    async getHousehold(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdMember(db, user.userId, householdPublicId);
      const household = await readActiveHousehold(db, access.householdId, user.userId);
      if (!household) throw new HouseholdNotFoundError(householdPublicId);
      return household;
    },

    async updateHousehold(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      body: unknown,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      const patch = householdPatchInput(body);
      await updateActiveHousehold(db, access.householdId, { ...patch, now: now() });
      const household = await readActiveHousehold(db, access.householdId, user.userId);
      if (!household) throw new HouseholdNotFoundError(householdPublicId);
      return household;
    },

    async deleteHousehold(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner']);
      await softDeleteHousehold(db, access.householdId, now());
    },

    async listMembers(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdMember(db, user.userId, householdPublicId);
      return listHouseholdMembers(db, access.householdId);
    },

    async updateMember(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      targetPublicId: string,
      body: unknown,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      const role = memberRoleInput(body);
      const target = await findHouseholdMember(db, access.householdId, targetPublicId);
      if (!target) throw new MemberNotFoundError();
      if (target.role === 'owner'
        || (access.role === 'admin' && target.role === 'admin')
        || !canAssignRole(access.role, role)) {
        throw new HouseholdForbiddenError(householdPublicId);
      }
      const updated = await updateMemberRole(
        db,
        access.householdId,
        target.internalUserId,
        target.role,
        role,
        now(),
      );
      if (!updated) throw new StateConflictError('MEMBER_ROLE_CONFLICT', 'Member role changed before the update.');
      return { id: target.id, email: target.email, displayName: target.displayName, avatarUrl: target.avatarUrl, role };
    },

    async removeMember(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      targetPublicId: string,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      const target = await findHouseholdMember(db, access.householdId, targetPublicId);
      if (!target) throw new MemberNotFoundError();
      if (!canRemoveRole(access.role, target.role)) throw new HouseholdForbiddenError(householdPublicId);
      await removeMember(db, access.householdId, target.internalUserId);
    },

    async leaveHousehold(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdMember(db, user.userId, householdPublicId);
      if (access.role === 'owner') throw new HouseholdForbiddenError(householdPublicId);
      await removeMember(db, access.householdId, user.userId);
    },

    async transferOwnership(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      body: unknown,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner']);
      const targetPublicId = publicUserIdInput(body);
      const target = await findHouseholdMember(db, access.householdId, targetPublicId);
      if (!target || target.role === 'owner') {
        throw new StateConflictError('OWNERSHIP_TRANSFER_CONFLICT', 'Target must be an existing non-owner member.');
      }
      try {
        const transferred = await transferHouseholdOwnership(
          db,
          access.householdId,
          user.userId,
          target.internalUserId,
          now(),
        );
        if (!transferred) {
          throw new StateConflictError('OWNERSHIP_TRANSFER_CONFLICT', 'Ownership could not be transferred.');
        }
      } catch (error) {
        if (error instanceof StateConflictError) throw error;
        throw conflictFromDatabase(error, 'OWNERSHIP_TRANSFER_CONFLICT', 'Ownership could not be transferred.');
      }
      return { previousOwnerId: user.publicId, ownerId: target.id };
    },

    async listInvitations(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      const invitations = await listActiveInvitations(db, access.householdId, now());
      return Promise.all(invitations.map(async (invitation) => ({
        id: await invitationPublicId(invitation.tokenHash),
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      })));
    },

    async createInvitation(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      body: unknown,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      const input = invitationInput(body);
      if (!canAssignRole(access.role, input.role)) throw new HouseholdForbiddenError(householdPublicId);
      const timestamp = now();
      if (await hasActiveMemberWithEmail(db, access.householdId, input.email)) {
        throw new StateConflictError('INVITATION_CONFLICT', 'An active member or invitation already uses this email.');
      }
      const token = createInvitationToken();
      if (token.length < 10) throw new Error('Invitation token generator returned an unsafe token.');
      const tokenHash = await sha256(token);
      const expiresAt = timestamp + INVITATION_LIFETIME_MS;
      try {
        const created = await createInvitation(db, {
          householdId: access.householdId,
          invitedByUserId: user.userId,
          email: input.email,
          role: input.role,
          tokenHash,
          expiresAt,
          now: timestamp,
        });
        if (!created) {
          throw new StateConflictError(
            'INVITATION_CONFLICT',
            'An active member or invitation already uses this email.',
          );
        }
      } catch (error) {
        if (error instanceof StateConflictError) throw error;
        throw conflictFromDatabase(error, 'INVITATION_CONFLICT', 'Invitation could not be created.');
      }
      return {
        id: await invitationPublicId(tokenHash),
        email: input.email,
        role: input.role,
        expiresAt,
        createdAt: timestamp,
        token,
      };
    },

    async revokeInvitation(
      db: D1Database,
      user: AuthenticatedUser,
      householdPublicId: string,
      invitationId: string,
    ) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, ['owner', 'admin']);
      if (!/^inv_[a-f0-9]{48}$/.test(invitationId)) throw new ValidationError('invitationId is invalid.');
      const activeInvitations = await listActiveInvitations(db, access.householdId, now());
      let internalId: number | null = null;
      for (const invitation of activeInvitations) {
        if (await invitationPublicId(invitation.tokenHash) === invitationId) {
          internalId = invitation.internalId;
          break;
        }
      }
      if (internalId === null || !await revokeInvitation(db, access.householdId, internalId, now())) {
        throw new StateConflictError('INVITATION_CONFLICT', 'Invitation is not active in this household.');
      }
    },

    async acceptInvitation(db: D1Database, user: AuthenticatedUser, body: unknown) {
      const token = tokenInput(body);
      const invitation = await findInvitationByHash(db, await sha256(token));
      const timestamp = now();
      if (!invitation
        || invitation.email !== normalizeEmail(user.email)
        || invitation.householdStatus !== 'active'
        || invitation.acceptedAt !== null
        || invitation.revokedAt !== null
        || invitation.expiresAt <= timestamp) {
        throw new StateConflictError('INVITATION_INVALID', 'Invitation is invalid or no longer active.');
      }
      if (await hasActiveMemberWithEmail(db, invitation.householdId, invitation.email)) {
        throw new StateConflictError('INVITATION_CONFLICT', 'User is already a household member.');
      }
      try {
        const accepted = await acceptInvitationAtomically(db, invitation, user.userId, timestamp);
        if (!accepted) throw new StateConflictError('INVITATION_INVALID', 'Invitation is invalid or no longer active.');
      } catch (error) {
        if (error instanceof StateConflictError) throw error;
        throw conflictFromDatabase(error, 'INVITATION_CONFLICT', 'Invitation could not be accepted.');
      }
      return { id: invitation.householdPublicId, name: invitation.householdName, role: invitation.role };
    },
  };
}

function householdCreateInput(body: unknown) {
  const record = objectBody(body);
  return {
    name: requiredText(record.name, 'name', NAME_MAX),
    province: optionalText(record.province, 'province', PROVINCE_MAX),
    electricityProvider: optionalText(record.electricityProvider, 'electricityProvider', PROVIDER_MAX),
  };
}

function householdPatchInput(body: unknown) {
  const record = objectBody(body);
  const patch: { name?: string; province?: string | null; electricityProvider?: string | null } = {};
  if (Object.hasOwn(record, 'name')) patch.name = requiredText(record.name, 'name', NAME_MAX);
  if (Object.hasOwn(record, 'province')) patch.province = optionalText(record.province, 'province', PROVINCE_MAX);
  if (Object.hasOwn(record, 'electricityProvider')) {
    patch.electricityProvider = optionalText(record.electricityProvider, 'electricityProvider', PROVIDER_MAX);
  }
  if (Object.keys(patch).length === 0) throw new ValidationError('At least one household field is required.');
  return patch;
}

function invitationInput(body: unknown): { email: string; role: InvitationRole } {
  const record = objectBody(body);
  const email = normalizeEmail(requiredText(record.email, 'email', EMAIL_MAX));
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError('email must be a valid email address.');
  const role = record.role;
  if (typeof role !== 'string' || !INVITATION_ROLES.has(role as HouseholdRole)) {
    throw new ValidationError('role must be admin, member, or viewer.');
  }
  return { email, role: role as InvitationRole };
}

function memberRoleInput(body: unknown): HouseholdRole {
  const role = objectBody(body).role;
  if (typeof role !== 'string' || !['owner', 'admin', 'member', 'viewer'].includes(role)) {
    throw new ValidationError('role is invalid.');
  }
  return role as HouseholdRole;
}

function publicUserIdInput(body: unknown): string {
  return requiredText(objectBody(body).userId, 'userId', 100);
}

function tokenInput(body: unknown): string {
  return requiredText(objectBody(body).token, 'token', 500);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError();
  return body as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new ValidationError(`${field} is invalid.`);
  return trimmed;
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text or null.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new ValidationError(`${field} is too long.`);
  return trimmed || null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function invitationPublicId(tokenHash: string): Promise<string> {
  return `inv_${(await sha256(`invitation-public:${tokenHash}`)).slice(0, 48)}`;
}

function defaultHouseholdPublicId(): string {
  return `hh_${crypto.randomUUID().replaceAll('-', '')}`;
}

function defaultInvitationToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

function conflictFromDatabase(error: unknown, code: string, message: string): StateConflictError {
  if (error instanceof Error && /unique|constraint/i.test(error.message)) return new StateConflictError(code, message);
  throw error;
}

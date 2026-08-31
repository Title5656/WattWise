import type { AuthenticatedUser } from './current-user.ts';
import type { SitesIdentity } from './sites-identity.ts';

type UserRow = {
  userId: number;
  publicId: string;
  email: string;
  displayName: string | null;
};

export type UserProvisionerOptions = {
  createPublicId?: () => string;
  now?: () => number;
};

export function createUserProvisioner(options: UserProvisionerOptions = {}) {
  const createPublicId = options.createPublicId ?? defaultPublicId;
  const now = options.now ?? Date.now;

  return async function findOrCreateUser(db: D1Database, identity: SitesIdentity): Promise<AuthenticatedUser> {
    let user = await findUserByIdentity(db, identity);
    if (!user) {
      const timestamp = now();
      try {
        await db.batch([
          db.prepare(`INSERT INTO users (public_id, email, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`)
            .bind(createPublicId(), identity.email, identity.displayName, timestamp, timestamp),
          db.prepare(`INSERT INTO user_identities (user_id, provider, subject, created_at)
            VALUES (last_insert_rowid(), ?, ?, ?)`)
            .bind(identity.provider, identity.subject, timestamp),
        ]);
      } catch (error) {
        user = await findUserByIdentity(db, identity);
        if (!user) throw error;
      }
      user ??= await findUserByIdentity(db, identity);
    }

    if (!user) throw new Error('Unable to provision authenticated user.');
    return {
      userId: user.userId,
      publicId: user.publicId,
      provider: identity.provider,
      subject: identity.subject,
      email: user.email,
      displayName: user.displayName ?? user.email,
    };
  };
}

async function findUserByIdentity(db: D1Database, identity: SitesIdentity): Promise<UserRow | null> {
  const result = await db.prepare(`SELECT users.id AS userId, users.public_id AS publicId,
      users.email AS email, users.display_name AS displayName
    FROM user_identities
    INNER JOIN users ON users.id = user_identities.user_id
    WHERE user_identities.provider = ? AND user_identities.subject = ?`)
    .bind(identity.provider, identity.subject)
    .all<UserRow>();
  return result.results[0] ?? null;
}

function defaultPublicId(): string {
  return `usr_${crypto.randomUUID().replaceAll('-', '')}`;
}

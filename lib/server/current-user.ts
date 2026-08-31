import { AuthenticationRequiredError } from './auth-errors.ts';
import { getCurrentIdentity } from './sites-identity.ts';
import { createUserProvisioner, type UserProvisionerOptions } from './user-persistence.ts';

export type AuthenticatedUser = {
  userId: number;
  publicId: string;
  provider: 'openai-sites';
  subject: string;
  email: string;
  displayName: string;
};

export function createCurrentUserResolver(options: UserProvisionerOptions = {}) {
  const findOrCreateUser = createUserProvisioner(options);

  return async function resolveCurrentUser(db: D1Database, request: Request): Promise<AuthenticatedUser | null> {
    const identity = getCurrentIdentity(request);
    if (!identity) return null;
    return findOrCreateUser(db, identity);
  };
}

export const getCurrentUser = createCurrentUserResolver();

export async function requireUser(db: D1Database, request: Request): Promise<AuthenticatedUser> {
  const user = await getCurrentUser(db, request);
  if (!user) throw new AuthenticationRequiredError();
  return user;
}

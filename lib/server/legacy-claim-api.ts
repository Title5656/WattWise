import { ValidationError } from './auth-errors.ts';
import { requireUser } from './current-user.ts';
import { errorResponse } from './http-errors.ts';
import { claimQuarantinedHousehold } from './legacy-cutover.ts';

export function createLegacyClaimApi(
  getDb: () => D1Database,
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  return {
    async claim(request: Request): Promise<Response> {
      try {
        const db = getDb();
        const user = await requireUser(db, request);
        const body = await jsonBody(request);
        const household = await claimQuarantinedHousehold(db, user.userId, body.token, now());
        return Response.json({ household: { id: household.publicId } });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

async function jsonBody(request: Request): Promise<{ token: string }> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || typeof (value as { token?: unknown }).token !== 'string') {
    throw new ValidationError('A claim token is required.');
  }
  return { token: (value as { token: string }).token };
}

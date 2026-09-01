import { ValidationError } from './auth-errors.ts';
import { requireUser } from './current-user.ts';
import { createHouseholdService, type HouseholdServiceOptions } from './household-service.ts';
import { errorResponse } from './http-errors.ts';

type RouteParams = Record<string, string>;
type RouteContext = RouteParams | { params: RouteParams | Promise<RouteParams> };

export function createHouseholdApi(getDb: () => D1Database, options: HouseholdServiceOptions = {}) {
  const service = createHouseholdService(options);

  async function authenticated<T>(request: Request, operation: (db: D1Database, user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>) {
    try {
      const db = getDb();
      const user = await requireUser(db, request);
      return await operation(db, user);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    me(request: Request) {
      return authenticated(request, async (_db, user) => Response.json({
        user: { id: user.publicId, email: user.email, displayName: user.displayName },
      }));
    },

    listHouseholds(request: Request) {
      return authenticated(request, async (db, user) => Response.json({
        households: await service.listHouseholds(db, user),
      }));
    },

    createHousehold(request: Request) {
      return authenticated(request, async (db, user) => Response.json({
        household: await service.createHousehold(db, user, await jsonBody(request)),
      }, { status: 201 }));
    },

    getHousehold(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ household: await service.getHousehold(db, user, householdId) });
      });
    },

    updateHousehold(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ household: await service.updateHousehold(db, user, householdId, await jsonBody(request)) });
      });
    },

    deleteHousehold(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        await service.deleteHousehold(db, user, householdId);
        return new Response(null, { status: 204 });
      });
    },

    listMembers(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ members: await service.listMembers(db, user, householdId) });
      });
    },

    updateMember(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId, userId } = await params(context);
        return Response.json({ member: await service.updateMember(db, user, householdId, userId, await jsonBody(request)) });
      });
    },

    removeMember(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId, userId } = await params(context);
        await service.removeMember(db, user, householdId, userId);
        return new Response(null, { status: 204 });
      });
    },

    leaveHousehold(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        await service.leaveHousehold(db, user, householdId);
        return new Response(null, { status: 204 });
      });
    },

    transferOwnership(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ transfer: await service.transferOwnership(db, user, householdId, await jsonBody(request)) });
      });
    },

    listInvitations(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ invitations: await service.listInvitations(db, user, householdId) });
      });
    },

    createInvitation(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json({ invitation: await service.createInvitation(db, user, householdId, await jsonBody(request)) }, { status: 201 });
      });
    },

    revokeInvitation(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId, invitationId } = await params(context);
        await service.revokeInvitation(db, user, householdId, invitationId);
        return new Response(null, { status: 204 });
      });
    },

    acceptInvitation(request: Request) {
      return authenticated(request, async (db, user) => Response.json({
        household: await service.acceptInvitation(db, user, await jsonBody(request)),
      }));
    },
  };
}

async function params(context: RouteContext): Promise<RouteParams> {
  const routeContext = context as { params?: RouteParams | Promise<RouteParams> };
  if (routeContext.params !== undefined) return await routeContext.params;
  return context as RouteParams;
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
}

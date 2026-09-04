import { requireUser } from './current-user.ts';
import { createHouseholdBillsService, type HouseholdBillsServiceOptions } from './household-bills-service.ts';
import { errorResponse } from './http-errors.ts';

type RouteParams = { householdId: string; month?: string };
type RouteContext = RouteParams | { params: RouteParams | Promise<RouteParams> };

async function params(context: RouteContext): Promise<RouteParams> {
  return 'params' in context ? context.params : context;
}

export function createHouseholdBillsApi(getDb: () => D1Database, options: HouseholdBillsServiceOptions = {}) {
  const service = createHouseholdBillsService(options);

  async function authenticated(
    request: Request,
    operation: (db: D1Database, user: Awaited<ReturnType<typeof requireUser>>) => Promise<Response>,
  ) {
    try {
      const db = getDb();
      const user = await requireUser(db, request);
      return await operation(db, user);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    GET(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId } = await params(context);
        return Response.json(await service.get(db, user, householdId));
      });
    },
    PUT(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId, month = '' } = await params(context);
        return Response.json(await service.put(db, user, householdId, month, request));
      });
    },
    DELETE(request: Request, context: RouteContext) {
      return authenticated(request, async (db, user) => {
        const { householdId, month = '' } = await params(context);
        return Response.json(await service.delete(db, user, householdId, month));
      });
    },
  };
}

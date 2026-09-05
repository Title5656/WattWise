import { requireUser } from './current-user.ts';
import { errorResponse } from './http-errors.ts';
import {
  createHouseholdHomeService,
  HomeRevisionConflictError,
  type HouseholdHomeServiceOptions,
} from './household-home-service.ts';

type RouteParams = { householdId: string };
type RouteContext = RouteParams | { params: RouteParams | Promise<RouteParams> };

async function params(context: RouteContext): Promise<RouteParams> {
  return 'params' in context ? context.params : context;
}

export function createHouseholdHomeApi(getDb: () => D1Database, options: HouseholdHomeServiceOptions = {}) {
  const service = createHouseholdHomeService(options);

  async function authenticated(
    request: Request,
    operationName: string,
    operation: (db: D1Database, user: Awaited<ReturnType<typeof requireUser>>) => Promise<Response>,
  ) {
    try {
      const db = getDb();
      const user = await requireUser(db, request);
      return await operation(db, user);
    } catch (error) {
      if (error instanceof HomeRevisionConflictError) {
        return Response.json({
          code: error.code,
          message: error.message,
          currentRevision: error.currentRevision,
        }, { status: error.status });
      }
      return errorResponse(error, { request, operation: operationName });
    }
  }

  return {
    GET(request: Request, context: RouteContext) {
      return authenticated(request, 'household-home.get', async (db, user) => {
        const { householdId } = await params(context);
        return Response.json(await service.get(db, user, householdId));
      });
    },
    PUT(request: Request, context: RouteContext) {
      return authenticated(request, 'household-home.put', async (db, user) => {
        const { householdId } = await params(context);
        return Response.json(await service.put(db, user, householdId, request));
      });
    },
  };
}

import { requireUser } from './current-user.ts';
import {
  createHouseholdDashboardService,
  type HouseholdDashboardServiceOptions,
} from './household-dashboard-service.ts';
import { errorResponse } from './http-errors.ts';

type RouteParams = { householdId: string };
type RouteContext = RouteParams | { params: RouteParams | Promise<RouteParams> };

async function params(context: RouteContext): Promise<RouteParams> {
  return 'params' in context ? context.params : context;
}

export function createHouseholdDashboardApi(
  getDb: () => D1Database,
  options: HouseholdDashboardServiceOptions = {},
) {
  const service = createHouseholdDashboardService(options);
  return {
    async GET(request: Request, context: RouteContext) {
      try {
        const db = getDb();
        const user = await requireUser(db, request);
        const { householdId } = await params(context);
        return Response.json(await service.get(db, user, householdId));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

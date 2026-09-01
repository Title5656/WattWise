import { householdApi } from '@/lib/server/household-route-api';

export const GET = householdApi.listHouseholds;
export const POST = householdApi.createHousehold;

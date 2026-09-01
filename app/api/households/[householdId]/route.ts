import { householdApi } from '@/lib/server/household-route-api';

export const GET = householdApi.getHousehold;
export const PATCH = householdApi.updateHousehold;
export const DELETE = householdApi.deleteHousehold;

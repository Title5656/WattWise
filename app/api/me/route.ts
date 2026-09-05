import { householdApi } from '@/lib/server/household-route-api';

export const GET = householdApi.me;
export const PATCH = householdApi.updateMe;

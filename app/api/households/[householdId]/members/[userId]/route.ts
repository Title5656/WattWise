import { householdApi } from '@/lib/server/household-route-api';

export const PATCH = householdApi.updateMember;
export const DELETE = householdApi.removeMember;

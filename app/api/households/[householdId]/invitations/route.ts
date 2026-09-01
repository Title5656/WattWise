import { householdApi } from '@/lib/server/household-route-api';

export const GET = householdApi.listInvitations;
export const POST = householdApi.createInvitation;

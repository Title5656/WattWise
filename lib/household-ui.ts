export type HouseholdRole = 'owner' | 'admin' | 'member' | 'viewer';

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type HouseholdMembership = {
  id: string;
  name: string;
  province: string | null;
  electricityProvider: string | null;
  role: HouseholdRole;
};

export type HouseholdDestination = 'dashboard' | 'my-home';

export type HouseholdEntryDecision =
  | { kind: 'create' }
  | { kind: 'redirect'; href: string }
  | { kind: 'choose' };

type HomeAutosaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const roleLabels: Record<HouseholdRole, string> = {
  owner: 'เจ้าของบ้าน',
  admin: 'ผู้ดูแลบ้าน',
  member: 'สมาชิกบ้าน',
  viewer: 'ผู้ชม · อ่านอย่างเดียว',
};

export function displayUserName(user: CurrentUser): string {
  return user.displayName?.trim() || user.email;
}

export function userInitials(user: CurrentUser): string {
  const label = displayUserName(user);
  return [...label].slice(0, 2).join('').toUpperCase();
}

export function householdRoleLabel(role: HouseholdRole): string {
  return roleLabels[role];
}

export function canEditHousehold(role: HouseholdRole): boolean {
  return role !== 'viewer';
}

export function homeAutosaveStorageForRole(
  storage: HomeAutosaveStorage,
  role: HouseholdRole,
): HomeAutosaveStorage {
  if (canEditHousehold(role)) return storage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

export function householdDashboardPath(householdId: string): string {
  return `/households/${encodeURIComponent(householdId)}`;
}

export function householdMyHomePath(householdId: string): string {
  return `${householdDashboardPath(householdId)}/my-home`;
}

export function householdDestinationPath(householdId: string, destination: HouseholdDestination): string {
  return destination === 'dashboard' ? householdDashboardPath(householdId) : householdMyHomePath(householdId);
}

export function householdDashboardApiPath(householdId: string): string {
  return `/api/households/${encodeURIComponent(householdId)}/dashboard`;
}

export function householdHomeApiPath(householdId: string): string {
  return `/api/households/${encodeURIComponent(householdId)}/home`;
}

export function householdBillApiPath(householdId: string, month: string): string {
  return `/api/households/${encodeURIComponent(householdId)}/bills/${encodeURIComponent(month)}`;
}

export function decideHouseholdEntry(
  households: readonly HouseholdMembership[],
  destination: HouseholdDestination,
): HouseholdEntryDecision {
  if (households.length === 0) return { kind: 'create' };
  if (households.length === 1) {
    return { kind: 'redirect', href: householdDestinationPath(households[0].id, destination) };
  }
  return { kind: 'choose' };
}

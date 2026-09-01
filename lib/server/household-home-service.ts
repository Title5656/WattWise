import { readActiveCatalogModelsByKeys } from '../catalog-repository.ts';
import { calculateHomeSummary, type Appliance, type HomeAppliance } from '../home-config.ts';
import { getBillingMonth, selectRecentRecords } from '../monthly-history.ts';
import { getUsageProfile } from '../usage-profiles.ts';
import { normalizeUsageSchedule, scheduleHours, USAGE_PERIODS, type UsageSchedule } from '../usage-schedule.ts';
import { StateConflictError, ValidationError } from './auth-errors.ts';
import { requireHouseholdRole } from './household-access.ts';
import {
  readHouseholdHomeSnapshot,
  replaceHouseholdHome,
  resolveHouseholdHomeConflict,
  type PersistedHouseholdHomeItem,
} from './household-home-repository.ts';
import type { AuthenticatedUser } from './current-user.ts';

const EDIT_ROLES = ['owner', 'admin', 'member'] as const;
const MAX_HOME_ITEMS = 100;
const MAX_KEY_LENGTH = 200;

export class HomeRevisionConflictError extends StateConflictError {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('HOME_REVISION_CONFLICT', 'The Home snapshot has changed.');
    this.name = 'HomeRevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

export type HouseholdHomeServiceOptions = {
  now?: () => number;
};

function invalid(): never {
  throw new ValidationError('Home snapshot is invalid.');
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    invalid();
  }
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateSchedule(raw: unknown, appliance: Appliance): void {
  if (raw === undefined || raw === null) return;
  if (!raw || typeof raw !== 'object') invalid();
  const schedule = raw as { kind?: unknown; hoursByPeriod?: unknown; periods?: unknown };
  const profile = getUsageProfile(appliance.usageProfileId);
  if (appliance.usageProfileId === 'refrigerator') {
    if (schedule.kind !== 'all_day') invalid();
    return;
  }
  if (profile.inputKind === 'cycles') {
    if (schedule.kind !== 'periods' || !Array.isArray(schedule.periods) || schedule.periods.length === 0) invalid();
    if (!schedule.periods.every((period) => typeof period === 'string' && USAGE_PERIODS.includes(period as never))) invalid();
    return;
  }
  if (schedule.kind === 'all_day') return;
  if (schedule.kind !== 'hours' || !schedule.hoursByPeriod || typeof schedule.hoursByPeriod !== 'object') invalid();
  const values = schedule.hoursByPeriod as Record<string, unknown>;
  if (!USAGE_PERIODS.every((period) => finiteInRange(values[period], 0, 6))) invalid();
}

function normalizedCycles(raw: unknown, appliance: Appliance): number | null {
  const profile = getUsageProfile(appliance.usageProfileId);
  if (profile.inputKind !== 'cycles') {
    if (raw !== undefined && raw !== null) invalid();
    return null;
  }
  const value = raw === undefined || raw === null ? profile.defaultCyclesPerMonth ?? 0 : raw;
  if (!finiteInRange(value, profile.min, profile.max)) invalid();
  return Math.round((value as number) / profile.step) * profile.step;
}

async function validateHomeBody(db: D1Database, raw: unknown) {
  if (!raw || typeof raw !== 'object') invalid();
  const body = raw as { expectedRevision?: unknown; items?: unknown };
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) invalid();
  if (!Array.isArray(body.items) || body.items.length > MAX_HOME_ITEMS) invalid();

  const candidates = body.items.map((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object') invalid();
    const item = rawItem as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.trim().length === 0 || item.id.length > MAX_KEY_LENGTH) invalid();
    if (typeof item.instanceId !== 'string' || item.instanceId.trim().length === 0 || item.instanceId.length > MAX_KEY_LENGTH) invalid();
    if (!Number.isInteger(item.quantity) || !finiteInRange(item.quantity, 1, 99)) invalid();
    if (item.hoursPerDay !== undefined && item.hoursPerDay !== null && !finiteInRange(item.hoursPerDay, 0, 24)) invalid();
    return item as Record<string, unknown> & { id: string; instanceId: string; quantity: number };
  });
  if (new Set(candidates.map((item) => item.instanceId)).size !== candidates.length) invalid();

  const models = await readActiveCatalogModelsByKeys(db, candidates.map((item) => item.id));
  const modelsByKey = new Map(models.map((model) => [model.appliance.id, model]));
  const persistedItems: PersistedHouseholdHomeItem[] = [];
  const homeItems: HomeAppliance[] = [];
  for (const [position, item] of candidates.entries()) {
    const model = modelsByKey.get(item.id);
    if (!model) invalid();
    const { appliance } = model;
    validateSchedule(item.usageSchedule, appliance);
    const profile = getUsageProfile(appliance.usageProfileId);
    const legacyHours = typeof item.hoursPerDay === 'number' ? item.hoursPerDay : undefined;
    const usageSchedule = normalizeUsageSchedule(item.usageSchedule, appliance.usageProfileId, legacyHours);
    const hoursPerDay = scheduleHours(usageSchedule);
    const cyclesPerMonth = normalizedCycles(item.cyclesPerMonth, appliance);
    persistedItems.push({
      modelId: model.modelId,
      instanceKey: item.instanceId,
      quantity: item.quantity,
      hoursPerDay,
      cyclesPerMonth,
      usageSchedule: JSON.stringify(usageSchedule),
      position,
    });
    homeItems.push({
      ...appliance,
      instanceId: item.instanceId,
      quantity: item.quantity,
      hoursPerDay: profile.inputKind === 'hours' ? hoursPerDay : null,
      cyclesPerMonth,
      usageSchedule: usageSchedule as UsageSchedule,
    });
  }
  return { expectedRevision: body.expectedRevision as number, persistedItems, homeItems };
}

async function responseBody(
  householdPublicId: string,
  revision: number,
  items: HomeAppliance[],
  history: Awaited<ReturnType<typeof readHouseholdHomeSnapshot>>['history'],
  now: number,
) {
  return {
    householdId: householdPublicId,
    revision,
    items,
    summary: calculateHomeSummary(items, new Date(now)),
    history: selectRecentRecords(history),
  };
}

export function createHouseholdHomeService(options: HouseholdHomeServiceOptions = {}) {
  const now = options.now ?? Date.now;
  return {
    async get(db: D1Database, user: AuthenticatedUser, householdPublicId: string) {
      const timestamp = now();
      const snapshot = await readHouseholdHomeSnapshot(db, user.userId, householdPublicId);
      return responseBody(householdPublicId, snapshot.revision, snapshot.items, snapshot.history, timestamp);
    },

    async put(db: D1Database, user: AuthenticatedUser, householdPublicId: string, request: Request) {
      const access = await requireHouseholdRole(db, user.userId, householdPublicId, EDIT_ROLES);
      const validated = await validateHomeBody(db, await jsonBody(request));
      const timestamp = now();
      const summary = calculateHomeSummary(validated.homeItems, new Date(timestamp));
      const result = await replaceHouseholdHome(db, {
        householdId: access.householdId,
        expectedRevision: validated.expectedRevision,
        userId: user.userId,
        items: validated.persistedItems,
        billingMonth: getBillingMonth(new Date(timestamp)),
        summary,
        now: timestamp,
      });
      if (!result.saved) {
        throw new HomeRevisionConflictError(await resolveHouseholdHomeConflict(db, user.userId, householdPublicId));
      }
      return responseBody(
        householdPublicId,
        validated.expectedRevision + 1,
        validated.homeItems,
        result.history,
        timestamp,
      );
    },
  };
}

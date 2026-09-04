import { usageProfiles } from './usage-profiles.ts';
import { USAGE_PERIODS } from './usage-schedule.ts';

export const HOME_SAVE_OUTBOX_KEY = 'wattwise.home-save-outbox.v2';
export const LEGACY_HOME_SAVE_OUTBOX_KEY = 'wattwise.home-save-outbox.v1';
export const SCOPED_HOME_SAVE_OUTBOX_PREFIX = 'wattwise.home-save-outbox.v3';
export const SCOPED_HOME_SAVE_LOCK_PREFIX = 'wattwise.home-save-lock.v3';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Envelope = { version: 2; body: string };

export type HomeSaveScope = { userId: string; householdId: string };

export type ScopedHomeSaveEnvelope = {
  version: 3;
  userId: string;
  householdId: string;
  expectedRevision: number;
  body: string;
  updatedAt: number;
};

const riceCookerSchedule = {
  kind: 'hours' as const,
  hoursByPeriod: { night: 0, morning: 1, daytime: 0, evening: 0 },
};

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEnergySpec(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Record<string, unknown>;
  switch (spec.calculationMethod) {
    case 'rated_power':
      return finiteNumber(spec.ratedPowerW)
        && (spec.loadFactor === undefined || spec.loadFactor === null || finiteNumber(spec.loadFactor));
    case 'annual_energy':
      return finiteNumber(spec.annualEnergyKwh);
    case 'per_cycle':
      return finiteNumber(spec.energyPerCycleKwh);
    default:
      return false;
  }
}

function isSchedule(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'all_day') return true;
  if (candidate.kind === 'hours' && candidate.hoursByPeriod && typeof candidate.hoursByPeriod === 'object') {
    const hours = candidate.hoursByPeriod as Record<string, unknown>;
    return USAGE_PERIODS.every((period) => finiteNumber(hours[period]));
  }
  if (candidate.kind === 'periods' && Array.isArray(candidate.periods)) {
    return candidate.periods.length > 0
      && candidate.periods.every((period) => USAGE_PERIODS.includes(period));
  }
  return false;
}

function isPendingItem(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const requiredStrings = ['id', 'instanceId', 'brand', 'model', 'name', 'detail', 'image', 'usageProfileId'];
  if (!requiredStrings.every((key) => typeof item[key] === 'string')) return false;
  if (!Object.hasOwn(usageProfiles, item.usageProfileId as string)) return false;
  if (item.watts !== null && !finiteNumber(item.watts)) return false;
  const quantity = item.quantity;
  if (!finiteNumber(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
  if (item.hoursPerDay !== undefined && item.hoursPerDay !== null && !finiteNumber(item.hoursPerDay)) return false;
  if (item.cyclesPerMonth !== undefined && item.cyclesPerMonth !== null && !finiteNumber(item.cyclesPerMonth)) return false;
  if (!isSchedule(item.usageSchedule)) return false;
  return item.energySpec === undefined || isEnergySpec(item.energySpec);
}

function validateBody(body: string) {
  try {
    const parsed = JSON.parse(body) as { items?: unknown };
    return Array.isArray(parsed.items)
      && parsed.items.length <= 100
      && parsed.items.every(isPendingItem);
  } catch {
    return false;
  }
}

function canonicalizePendingItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const quantity = item.quantity;
  if (!finiteNumber(quantity) || quantity <= 0) return null;
  const canonical = item.usageProfileId === 'rice_cooker'
    ? {
      ...item,
      usageProfileId: 'rice_cooker_hours',
      hoursPerDay: 1,
      cyclesPerMonth: null,
      usageSchedule: riceCookerSchedule,
    }
    : { ...item };
  return {
    ...canonical,
    quantity: Math.min(99, Math.max(1, Math.round(quantity))),
  };
}

export function canonicalizePendingHomeSave(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { items?: unknown };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Array.isArray(parsed.items) || parsed.items.length > 100) return null;
    const items = parsed.items.map(canonicalizePendingItem);
    if (items.some((item) => item === null)) return null;
    const canonical = JSON.stringify({ ...parsed, items });
    return validateBody(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

function canonicalizeScopedBody(body: string): string | null {
  try {
    if (!validateBody(body)) return null;
    const parsed = JSON.parse(body) as { items: Record<string, unknown>[] };
    const instanceIds = new Set<string>();
    for (const item of parsed.items) {
      if (typeof item.id !== 'string' || item.id.trim().length === 0 || item.id.length > 200
        || typeof item.instanceId !== 'string' || item.instanceId.trim().length === 0 || item.instanceId.length > 200
        || instanceIds.has(item.instanceId)
        || (item.hoursPerDay !== undefined && item.hoursPerDay !== null
          && (!finiteNumber(item.hoursPerDay) || item.hoursPerDay < 0 || item.hoursPerDay > 24))
        || (item.cyclesPerMonth !== undefined && item.cyclesPerMonth !== null
          && (!finiteNumber(item.cyclesPerMonth) || item.cyclesPerMonth < 0))) return null;
      instanceIds.add(item.instanceId);
      const schedule = item.usageSchedule as { kind?: unknown; hoursByPeriod?: Record<string, unknown> } | undefined;
      if (schedule?.kind === 'hours'
        && USAGE_PERIODS.some((period) => !finiteNumber(schedule.hoursByPeriod?.[period])
          || (schedule.hoursByPeriod?.[period] as number) < 0
          || (schedule.hoursByPeriod?.[period] as number) > 6)) return null;
    }
    return JSON.stringify({ items: parsed.items });
  } catch {
    return null;
  }
}

function encodedScope(scope: HomeSaveScope): string {
  return `${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.householdId)}`;
}

export function homeSaveOutboxKey(scope: HomeSaveScope): string {
  return `${SCOPED_HOME_SAVE_OUTBOX_PREFIX}:${encodedScope(scope)}`;
}

export function homeSaveLockName(scope: HomeSaveScope): string {
  return `${SCOPED_HOME_SAVE_LOCK_PREFIX}:${encodedScope(scope)}`;
}

function parseScopedEnvelope(raw: string, scope: HomeSaveScope): ScopedHomeSaveEnvelope | null {
  try {
    const candidate = JSON.parse(raw) as Partial<ScopedHomeSaveEnvelope>;
    if (candidate.version !== 3
      || candidate.userId !== scope.userId
      || candidate.householdId !== scope.householdId
      || !Number.isSafeInteger(candidate.expectedRevision)
      || (candidate.expectedRevision as number) < 0
      || !Number.isSafeInteger(candidate.updatedAt)
      || (candidate.updatedAt as number) < 0
      || typeof candidate.body !== 'string') return null;
    const body = canonicalizeScopedBody(candidate.body);
    if (!body) return null;
    return {
      version: 3,
      userId: scope.userId,
      householdId: scope.householdId,
      expectedRevision: candidate.expectedRevision as number,
      body,
      updatedAt: candidate.updatedAt as number,
    };
  } catch {
    return null;
  }
}

function sameScopedEnvelope(left: ScopedHomeSaveEnvelope, right: ScopedHomeSaveEnvelope): boolean {
  return left.version === right.version
    && left.userId === right.userId
    && left.householdId === right.householdId
    && left.expectedRevision === right.expectedRevision
    && left.body === right.body
    && left.updatedAt === right.updatedAt;
}

export function stageScopedPendingHomeSave(
  storage: StorageLike,
  scope: HomeSaveScope,
  expectedRevision: number,
  body: string,
  updatedAt = Date.now(),
): ScopedHomeSaveEnvelope | null {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  const canonicalBody = canonicalizeScopedBody(body);
  if (!canonicalBody) return null;
  const envelope: ScopedHomeSaveEnvelope = {
    version: 3,
    userId: scope.userId,
    householdId: scope.householdId,
    expectedRevision,
    body: canonicalBody,
    updatedAt,
  };
  try {
    storage.setItem(homeSaveOutboxKey(scope), JSON.stringify(envelope));
  } catch {
    // Keep the in-memory envelope usable when durable storage is unavailable.
  }
  return envelope;
}

export function readScopedPendingHomeSave(
  storage: StorageLike,
  scope: HomeSaveScope,
): ScopedHomeSaveEnvelope | null {
  const key = homeSaveOutboxKey(scope);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const envelope = parseScopedEnvelope(raw, scope);
    if (envelope) return envelope;
    storage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}

export function clearScopedPendingHomeSave(
  storage: StorageLike,
  scope: HomeSaveScope,
  expected: ScopedHomeSaveEnvelope | null,
): boolean {
  if (!expected) return false;
  const key = homeSaveOutboxKey(scope);
  try {
    const current = parseScopedEnvelope(storage.getItem(key) ?? '', scope);
    if (!current || !sameScopedEnvelope(current, expected)) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function rebaseScopedPendingHomeSave(
  storage: StorageLike,
  scope: HomeSaveScope,
  expected: ScopedHomeSaveEnvelope,
  expectedRevision: number,
  updatedAt = Date.now(),
): ScopedHomeSaveEnvelope | null {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  const key = homeSaveOutboxKey(scope);
  try {
    const current = parseScopedEnvelope(storage.getItem(key) ?? '', scope);
    if (!current || !sameScopedEnvelope(current, expected)) return null;
    const rebased = { ...current, expectedRevision, updatedAt };
    storage.setItem(key, JSON.stringify(rebased));
    return rebased;
  } catch {
    return null;
  }
}

export function scopedPendingHomeSaveRequestBody(envelope: ScopedHomeSaveEnvelope): string {
  const parsed = JSON.parse(envelope.body) as { items: unknown[] };
  return JSON.stringify({ expectedRevision: envelope.expectedRevision, items: parsed.items });
}

function parseEnvelope(raw: string): Envelope | null {
  try {
    const envelope = JSON.parse(raw) as Partial<Envelope>;
    return envelope.version === 2 && typeof envelope.body === 'string' ? envelope as Envelope : null;
  } catch {
    return null;
  }
}

export function stagePendingHomeSave(storage: StorageLike, body: string) {
  try {
    const canonicalBody = canonicalizePendingHomeSave(body);
    const legacyBody = storage.getItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
    storage.setItem(HOME_SAVE_OUTBOX_KEY, JSON.stringify({ version: 2, body: canonicalBody ?? body } satisfies Envelope));
    if (canonicalBody && legacyBody !== null && storage.getItem(LEGACY_HOME_SAVE_OUTBOX_KEY) === legacyBody) {
      storage.removeItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing or when quota is exhausted.
  }
}

export function readPendingHomeSave(storage: StorageLike): string | null {
  try {
    const raw = storage.getItem(HOME_SAVE_OUTBOX_KEY);
    if (raw !== null) {
      const envelope = parseEnvelope(raw);
      const canonicalBody = envelope && canonicalizePendingHomeSave(envelope.body);
      if (canonicalBody) return canonicalBody;
      storage.removeItem(HOME_SAVE_OUTBOX_KEY);
    }

    const legacyBody = storage.getItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
    if (legacyBody === null) return null;
    const canonicalBody = canonicalizePendingHomeSave(legacyBody);
    if (!canonicalBody) {
      storage.removeItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
      return null;
    }
    try {
      storage.setItem(HOME_SAVE_OUTBOX_KEY, JSON.stringify({ version: 2, body: canonicalBody } satisfies Envelope));
    } catch {
      return canonicalBody;
    }
    if (storage.getItem(LEGACY_HOME_SAVE_OUTBOX_KEY) === legacyBody) storage.removeItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
    return canonicalBody;
  } catch {
    return null;
  }
}

export function clearPendingHomeSave(storage: StorageLike, body: string) {
  try {
    const canonicalBody = canonicalizePendingHomeSave(body);
    if (!canonicalBody) return;
    const envelope = parseEnvelope(storage.getItem(HOME_SAVE_OUTBOX_KEY) ?? '');
    if (envelope && canonicalizePendingHomeSave(envelope.body) === canonicalBody) storage.removeItem(HOME_SAVE_OUTBOX_KEY);
    const legacyBody = storage.getItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
    if (legacyBody && canonicalizePendingHomeSave(legacyBody) === canonicalBody) storage.removeItem(LEGACY_HOME_SAVE_OUTBOX_KEY);
  } catch {
    // A successful server save is still safe if storage becomes unavailable.
  }
}

export function syncPendingHomeSave(
  storage: StorageLike,
  currentBody: string,
  lastSavedBody: string | null,
  ownedPendingBody: string | null,
): string | null {
  const canonicalCurrent = canonicalizePendingHomeSave(currentBody);
  const canonicalSaved = lastSavedBody === null ? null : canonicalizePendingHomeSave(lastSavedBody);
  if (canonicalCurrent && canonicalCurrent === canonicalSaved) {
    if (ownedPendingBody) clearPendingHomeSave(storage, ownedPendingBody);
    return null;
  }
  const pendingBody = canonicalCurrent ?? currentBody;
  stagePendingHomeSave(storage, pendingBody);
  return pendingBody;
}

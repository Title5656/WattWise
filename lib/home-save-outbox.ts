import { usageProfiles } from './usage-profiles.ts';
import { USAGE_PERIODS } from './usage-schedule.ts';

export const HOME_SAVE_OUTBOX_KEY = 'wattwise.home-save-outbox.v2';
export const LEGACY_HOME_SAVE_OUTBOX_KEY = 'wattwise.home-save-outbox.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Envelope = { version: 2; body: string };

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

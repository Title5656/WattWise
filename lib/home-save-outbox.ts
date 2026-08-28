import { usageProfiles } from './usage-profiles.ts';
import { USAGE_PERIODS } from './usage-schedule.ts';

export const HOME_SAVE_OUTBOX_KEY = 'wattwise.home-save-outbox.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isPendingItem(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const requiredStrings = ['id', 'instanceId', 'brand', 'model', 'name', 'detail', 'image', 'usageProfileId'];
  if (!requiredStrings.every((key) => typeof item[key] === 'string')) return false;
  if (!Object.hasOwn(usageProfiles, item.usageProfileId as string)) return false;
  if (typeof item.watts !== 'number' || !Number.isFinite(item.watts)) return false;
  if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) return false;

  const schedule = item.usageSchedule;
  if (schedule === undefined) return true;
  if (!schedule || typeof schedule !== 'object') return false;
  const candidate = schedule as Record<string, unknown>;
  if (candidate.kind === 'all_day') return true;
  if (candidate.kind === 'hours' && candidate.hoursByPeriod && typeof candidate.hoursByPeriod === 'object') {
    const hours = candidate.hoursByPeriod as Record<string, unknown>;
    return USAGE_PERIODS.every((period) => typeof hours[period] === 'number' && Number.isFinite(hours[period]));
  }
  if (candidate.kind === 'periods' && Array.isArray(candidate.periods)) {
    return candidate.periods.every((period) => USAGE_PERIODS.includes(period));
  }
  return false;
}

export function stagePendingHomeSave(storage: StorageLike, body: string) {
  try {
    storage.setItem(HOME_SAVE_OUTBOX_KEY, body);
  } catch {
    // Storage can be unavailable in private browsing or when quota is exhausted.
  }
}

export function readPendingHomeSave(storage: StorageLike): string | null {
  try {
    const body = storage.getItem(HOME_SAVE_OUTBOX_KEY);
    if (!body) return null;
    const parsed = JSON.parse(body) as { items?: unknown };
    if (!Array.isArray(parsed.items) || parsed.items.length > 100 || !parsed.items.every(isPendingItem)) {
      storage.removeItem(HOME_SAVE_OUTBOX_KEY);
      return null;
    }
    return body;
  } catch {
    try { storage.removeItem(HOME_SAVE_OUTBOX_KEY); } catch { /* ignore unavailable storage */ }
    return null;
  }
}

export function clearPendingHomeSave(storage: StorageLike, body: string) {
  try {
    if (storage.getItem(HOME_SAVE_OUTBOX_KEY) === body) storage.removeItem(HOME_SAVE_OUTBOX_KEY);
  } catch {
    // A successful server save is still safe if storage becomes unavailable.
  }
}

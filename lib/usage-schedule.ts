import { getUsageProfile, type UsageProfileId } from './usage-profiles.ts';

export type UsagePeriod = 'night' | 'morning' | 'daytime' | 'evening';

export type UsageSchedule =
  | { kind: 'hours'; hoursByPeriod: Record<UsagePeriod, number> }
  | { kind: 'periods'; periods: UsagePeriod[] }
  | { kind: 'all_day' };

export const USAGE_PERIODS: UsagePeriod[] = ['night', 'morning', 'daytime', 'evening'];

const EMPTY_HOURS: Record<UsagePeriod, number> = {
  night: 0,
  morning: 0,
  daytime: 0,
  evening: 0,
};

const periodOrder: Record<UsagePeriod, number> = Object.fromEntries(
  USAGE_PERIODS.map((period, index) => [period, index]),
) as Record<UsagePeriod, number>;

function hoursSchedule(hoursByPeriod: Partial<Record<UsagePeriod, number>>, step: number): UsageSchedule {
  return {
    kind: 'hours',
    hoursByPeriod: USAGE_PERIODS.reduce((result, period) => {
      result[period] = clampHours(hoursByPeriod[period] ?? 0, step);
      return result;
    }, { ...EMPTY_HOURS }),
  };
}

function clampHours(value: number, step: number) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(Math.max(0, Math.min(6, value)) / step) * step;
  return Math.round(rounded * 100) / 100;
}

function isCycleProfile(profileId: UsageProfileId) {
  return profileId === 'washing_machine';
}

function preferredPeriods(profileId: UsageProfileId): UsagePeriod[] {
  switch (profileId) {
    case 'inverter_ac': return ['night', 'evening', 'morning', 'daytime'];
    case 'television': return ['evening', 'night', 'daytime', 'morning'];
    case 'fan': return ['night', 'evening', 'morning', 'daytime'];
    case 'water_heater': return ['morning', 'evening', 'daytime', 'night'];
    case 'microwave': return ['evening', 'morning', 'daytime', 'night'];
    default: return ['morning', 'daytime', 'evening', 'night'];
  }
}

export function createDefaultUsageSchedule(profileId: UsageProfileId): UsageSchedule {
  const step = getUsageProfile(profileId).step;
  switch (profileId) {
    case 'inverter_ac': return hoursSchedule({ night: 6, evening: 2 }, step);
    case 'refrigerator': return { kind: 'all_day' };
    case 'television': return hoursSchedule({ evening: 4 }, step);
    case 'washing_machine': return { kind: 'periods', periods: ['daytime'] };
    case 'fan': return hoursSchedule({ night: 6, evening: 2 }, step);
    case 'water_heater': return hoursSchedule({ morning: 0.25 }, step);
    case 'microwave': return hoursSchedule({ evening: 0.25 }, step);
    case 'rice_cooker_hours': return hoursSchedule({ morning: 1 }, step);
  }
}

export function scheduleHours(schedule: UsageSchedule): number {
  if (schedule.kind === 'all_day') return 24;
  if (schedule.kind === 'periods') return 0;
  return USAGE_PERIODS.reduce((total, period) => total + schedule.hoursByPeriod[period], 0);
}

export function setAllDayUsageSchedule(): UsageSchedule {
  return hoursSchedule({ night: 6, morning: 6, daytime: 6, evening: 6 }, 1);
}

export function toggleUsagePeriod(schedule: UsageSchedule, period: UsagePeriod, step: number): UsageSchedule {
  if (schedule.kind === 'all_day') return schedule;
  if (schedule.kind === 'hours') {
    return hoursSchedule({ ...schedule.hoursByPeriod, [period]: schedule.hoursByPeriod[period] > 0 ? 0 : step }, step);
  }

  const selected = new Set(schedule.periods);
  if (selected.has(period)) {
    if (selected.size === 1) return { kind: 'periods', periods: [...schedule.periods] };
    selected.delete(period);
  } else {
    selected.add(period);
  }
  return { kind: 'periods', periods: [...selected].sort((a, b) => periodOrder[a] - periodOrder[b]) };
}

export function updateUsagePeriodHours(
  schedule: UsageSchedule,
  period: UsagePeriod,
  value: number,
  step: number,
): UsageSchedule {
  if (schedule.kind !== 'hours') return schedule;
  return hoursSchedule({ ...schedule.hoursByPeriod, [period]: clampHours(value, step) }, step);
}

export function usageScheduleFromLegacyHours(
  profileId: UsageProfileId,
  legacyHours: number | null | undefined,
): UsageSchedule {
  const fallback = createDefaultUsageSchedule(profileId);
  if (profileId === 'refrigerator' || isCycleProfile(profileId)) return fallback;

  const total = Math.max(0, Math.min(24, Number.isFinite(legacyHours) ? Number(legacyHours) : scheduleHours(fallback)));
  let remaining = total;
  const hoursByPeriod = { ...EMPTY_HOURS };
  for (const period of preferredPeriods(profileId)) {
    const hours = Math.min(6, remaining);
    hoursByPeriod[period] = Math.round(hours * 100) / 100;
    remaining -= hours;
  }
  return hoursSchedule(hoursByPeriod, getUsageProfile(profileId).step);
}

function validPeriod(value: unknown): value is UsagePeriod {
  return typeof value === 'string' && USAGE_PERIODS.includes(value as UsagePeriod);
}

export function normalizeUsageSchedule(
  raw: unknown,
  profileId: UsageProfileId,
  legacyHours?: number | null,
): UsageSchedule {
  if (profileId === 'refrigerator') return { kind: 'all_day' };
  const fallback = usageScheduleFromLegacyHours(profileId, legacyHours);
  if (!raw || typeof raw !== 'object') return fallback;

  const candidate = raw as { kind?: unknown; hoursByPeriod?: unknown; periods?: unknown };
  if (candidate.kind === 'all_day' && !isCycleProfile(profileId)) return setAllDayUsageSchedule();
  if (candidate.kind === 'hours' && !isCycleProfile(profileId) && candidate.hoursByPeriod && typeof candidate.hoursByPeriod === 'object') {
    const values = candidate.hoursByPeriod as Record<string, unknown>;
    if (!USAGE_PERIODS.every((period) => typeof values[period] === 'number' && Number.isFinite(values[period]))) return fallback;
    const step = getUsageProfile(profileId).step;
    return {
      kind: 'hours',
      hoursByPeriod: USAGE_PERIODS.reduce((result, period) => {
        result[period] = clampHours(Number(values[period]), step);
        return result;
      }, { ...EMPTY_HOURS }),
    };
  }
  if (candidate.kind === 'periods' && isCycleProfile(profileId) && Array.isArray(candidate.periods)) {
    const periods = [...new Set(candidate.periods.filter(validPeriod))].sort((a, b) => periodOrder[a] - periodOrder[b]);
    if (periods.length > 0) return { kind: 'periods', periods };
  }
  return fallback;
}

export function parseUsageSchedule(
  raw: string | null | undefined,
  profileId: UsageProfileId,
  legacyHours?: number | null,
): UsageSchedule {
  if (!raw) return normalizeUsageSchedule(null, profileId, legacyHours);
  try {
    return normalizeUsageSchedule(JSON.parse(raw), profileId, legacyHours);
  } catch {
    return normalizeUsageSchedule(null, profileId, legacyHours);
  }
}

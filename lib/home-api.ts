import { readCatalogModelsByKeys } from './catalog-repository.ts';
import { type Appliance, type HomeAppliance } from './home-config.ts';
import { readHomeResponse } from './home-response.ts';
import { householdKey, readSavedHomeItems } from './home-storage.ts';
import { getUsageProfile } from './usage-profiles.ts';
import { normalizeUsageSchedule, scheduleHours } from './usage-schedule.ts';

const INVALID_HOME_ERROR = 'ข้อมูลอุปกรณ์ไม่ถูกต้อง';

class InvalidHomePayloadError extends Error {}

type SavedItem = {
  applianceKey: string;
  quantity: number;
  hoursPerDay: number;
  cyclesPerMonth: number | null;
  usageSchedule: string;
};

function invalid(): never {
  throw new InvalidHomePayloadError(INVALID_HOME_ERROR);
}

function normalizedCycles(raw: unknown, appliance: Appliance) {
  const profile = getUsageProfile(appliance.usageProfileId);
  if (profile.inputKind !== 'cycles') return null;
  if (raw === undefined || raw === null) return profile.defaultCyclesPerMonth ?? 0;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) invalid();
  const bounded = Math.max(profile.min, Math.min(profile.max, raw));
  return Math.round(bounded / profile.step) * profile.step;
}

async function validateItems(db: D1Database, rawItems: unknown[]): Promise<SavedItem[]> {
  const candidates = rawItems.map((raw) => {
    if (!raw || typeof raw !== 'object') invalid();
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.length === 0) invalid();
    if (typeof item.instanceId !== 'string' || item.instanceId.length === 0) invalid();
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) invalid();
    return item as Record<string, unknown> & { id: string; quantity: number };
  });

  const models = await readCatalogModelsByKeys(db, candidates.map((item) => item.id));
  const modelsById = new Map(models.map((model) => [model.id, model]));
  return candidates.map((item) => {
    const appliance = modelsById.get(item.id);
    if (!appliance) invalid();
    const legacyHours = typeof item.hoursPerDay === 'number' && Number.isFinite(item.hoursPerDay)
      ? item.hoursPerDay
      : undefined;
    const usageSchedule = normalizeUsageSchedule(item.usageSchedule, appliance.usageProfileId, legacyHours);
    return {
      applianceKey: appliance.id,
      quantity: item.quantity,
      hoursPerDay: scheduleHours(usageSchedule),
      cyclesPerMonth: normalizedCycles(item.cyclesPerMonth, appliance),
      usageSchedule: JSON.stringify(usageSchedule),
    };
  });
}

export function createHomeHandlers(getDb: () => D1Database) {
  async function readResponse(db: D1Database, items: HomeAppliance[], now = Date.now()) {
    return readHomeResponse(db, householdKey, items, now, (error) => {
      console.error('Unable to read monthly energy history', error);
    });
  }

  async function GET() {
    try {
      const db = getDb();
      const items = await readSavedHomeItems(db);
      return Response.json(await readResponse(db, items));
    } catch (error) {
      console.error('Unable to read home configuration', error);
      return Response.json({ error: 'ไม่สามารถโหลดข้อมูลบ้านได้' }, { status: 500 });
    }
  }

  async function save(request: Request) {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return Response.json({ error: INVALID_HOME_ERROR }, { status: 400 });
    }
    if (!parsed || typeof parsed !== 'object') {
      return Response.json({ error: INVALID_HOME_ERROR }, { status: 400 });
    }
    const body = parsed as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length > 100) {
      return Response.json({ error: INVALID_HOME_ERROR }, { status: 400 });
    }

    try {
      const db = getDb();
      const items = await validateItems(db, body.items);
      const now = Date.now();
      await db.batch([
        db.prepare('DELETE FROM saved_home_appliances WHERE household_key = ?').bind(householdKey),
        ...items.map((item, position) => db.prepare(
          'INSERT INTO saved_home_appliances (household_key, appliance_key, quantity, hours_per_day, cycles_per_month, usage_schedule, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(householdKey, item.applianceKey, item.quantity, item.hoursPerDay, item.cyclesPerMonth, item.usageSchedule, position, now)),
      ]);
      const savedItems = await readSavedHomeItems(db);
      return Response.json({ ...(await readResponse(db, savedItems, now)), savedAt: now });
    } catch (error) {
      if (error instanceof InvalidHomePayloadError) {
        return Response.json({ error: INVALID_HOME_ERROR }, { status: 400 });
      }
      console.error('Unable to save home configuration', error);
      return Response.json({ error: 'ไม่สามารถบันทึกข้อมูลบ้านได้' }, { status: 500 });
    }
  }

  return { GET, PUT: save, POST: save };
}

import { env } from 'cloudflare:workers';
import { applianceCatalog, calculateHomeSummary, hydrateHomeItem, type HomeAppliance } from '@/lib/home-config';
import { getUsageProfile } from '@/lib/usage-profiles';

const householdKey = 'default-home';

type SavedRow = { id: number; appliance_key: string; quantity: number; hours_per_day: number; cycles_per_month: number | null };

function getDb() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

async function readItems() {
  const db = getDb();
  const result = await db.prepare(
    'SELECT id, appliance_key, quantity, hours_per_day, cycles_per_month FROM saved_home_appliances WHERE household_key = ? ORDER BY position, id',
  ).bind(householdKey).all<SavedRow>();
  return result.results.map((row) => hydrateHomeItem({
    id: row.id,
    applianceKey: row.appliance_key,
    quantity: row.quantity,
    hoursPerDay: row.hours_per_day,
    cyclesPerMonth: row.cycles_per_month,
  })).filter((item): item is HomeAppliance => item !== null);
}

export async function GET() {
  try {
    const items = await readItems();
    return Response.json({ items, summary: calculateHomeSummary(items) });
  } catch (error) {
    console.error('Unable to read home configuration', error);
    return Response.json({ error: 'ไม่สามารถโหลดข้อมูลบ้านได้' }, { status: 500 });
  }
}

async function save(request: Request) {
  try {
    const body = await request.json() as { items?: Array<Partial<HomeAppliance>> };
    if (!Array.isArray(body.items) || body.items.length > 100) {
      return Response.json({ error: 'ข้อมูลอุปกรณ์ไม่ถูกต้อง' }, { status: 400 });
    }

    const items = body.items.map((item) => {
      const appliance = applianceCatalog.find((entry) => entry.id === item.id);
      if (!appliance) return null;
      const profile = getUsageProfile(appliance.usageProfileId);
      const rawHours = Number(item.hoursPerDay);
      const rawCycles = Number(item.cyclesPerMonth);
      return {
        applianceKey: appliance.id,
        quantity: Math.max(1, Math.min(20, Math.round(Number(item.quantity) || 1))),
        hoursPerDay: profile.inputKind === 'hours'
          ? Math.max(0, Math.min(24, Number.isFinite(rawHours) ? rawHours : profile.defaultHoursPerDay ?? 0))
          : 0,
        cyclesPerMonth: profile.inputKind === 'cycles'
          ? Math.max(0, Math.min(310, Number.isFinite(rawCycles) ? rawCycles : profile.defaultCyclesPerMonth ?? 0))
          : null,
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const db = getDb();
    const now = Date.now();
    const statements = [
      db.prepare('DELETE FROM saved_home_appliances WHERE household_key = ?').bind(householdKey),
      ...items.map((item, position) => db.prepare(
        'INSERT INTO saved_home_appliances (household_key, appliance_key, quantity, hours_per_day, cycles_per_month, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(householdKey, item.applianceKey, item.quantity, item.hoursPerDay, item.cyclesPerMonth, position, now)),
    ];
    await db.batch(statements);
    const savedItems = await readItems();
    return Response.json({ items: savedItems, summary: calculateHomeSummary(savedItems), savedAt: now });
  } catch (error) {
    console.error('Unable to save home configuration', error);
    return Response.json({ error: 'ไม่สามารถบันทึกข้อมูลบ้านได้' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return save(request);
}

export async function POST(request: Request) {
  return save(request);
}

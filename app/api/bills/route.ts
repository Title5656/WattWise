import { env } from 'cloudflare:workers';
import { householdKey } from '@/lib/home-storage';
import { deleteMonthlyActual, readMonthlyEnergyRecords, upsertMonthlyActual } from '@/lib/monthly-history-db';
import { selectRecentRecords, validateActualBillInput } from '@/lib/monthly-history';

function getDb() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

async function response() {
  const records = await readMonthlyEnergyRecords(getDb(), householdKey);
  return Response.json({ records: selectRecentRecords(records) });
}

export async function GET() {
  try {
    return await response();
  } catch (error) {
    console.error('Unable to read monthly energy records', error);
    return Response.json({ error: 'ไม่สามารถโหลดประวัติค่าไฟได้' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { month?: unknown; actualBill?: unknown; actualKwh?: unknown };
    const input = validateActualBillInput(body);
    if ('error' in input) return Response.json({ error: input.error }, { status: 400 });

    const now = Date.now();
    await upsertMonthlyActual(getDb(), householdKey, input.month, input.actualBill, input.actualKwh, now);
    return await response();
  } catch (error) {
    console.error('Unable to save actual electricity bill', error);
    return Response.json({ error: 'ไม่สามารถบันทึกบิลจริงได้' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get('month');
    const input = validateActualBillInput({ month, actualBill: 0 });
    if ('error' in input) return Response.json({ error: input.error }, { status: 400 });

    await deleteMonthlyActual(getDb(), householdKey, input.month);
    return await response();
  } catch (error) {
    console.error('Unable to delete actual electricity bill', error);
    return Response.json({ error: 'ไม่สามารถลบบิลจริงได้' }, { status: 500 });
  }
}


import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard labels the point estimate and usage sensitivity range distinctly', async () => {
  const source = await readProjectFile('app/components/HouseholdDashboard.tsx');

  assert.match(source, /ค่าไฟตามที่ตั้งไว้/);
  assert.match(source, /ช่วงค่าไฟโดยประมาณ/);
  assert.match(source, /การใช้งานจริงต่างจากที่ตั้งไว้ ±10%/);
  assert.doesNotMatch(source, /คาดการณ์สิ้นเดือน/);
  assert.doesNotMatch(source, /งบประมาณ 3,500 บาท/);
  assert.doesNotMatch(source, /budgetProgress/);
});

test('dashboard provides an empty-state label when no appliances can produce a range', async () => {
  const source = await readProjectFile('app/components/HouseholdDashboard.tsx');

  assert.match(source, /เพิ่มอุปกรณ์เพื่อดูช่วงค่าไฟ/);
});

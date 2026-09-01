import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readOptional(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  } catch {
    return '';
  }
}

test('explicit dashboard and My Home route wrappers pass the route household ID', async () => {
  const [dashboardRoute, myHomeRoute] = await Promise.all([
    readOptional('app/households/[householdId]/page.tsx'),
    readOptional('app/households/[householdId]/my-home/page.tsx'),
  ]);

  assert.match(dashboardRoute, /HouseholdDashboard householdId=\{householdId\}/);
  assert.match(myHomeRoute, /HouseholdMyHome householdId=\{householdId\}/);
});

test('switching the route household remounts scoped UI state before rendering the new home', async () => {
  const [dashboard, myHome] = await Promise.all([
    readOptional('app/components/HouseholdDashboard.tsx'),
    readOptional('app/components/HouseholdMyHome.tsx'),
  ]);

  assert.match(dashboard, /<HouseholdDashboardContent\s+key=\{householdId\}/);
  assert.match(myHome, /<HouseholdMyHomeContent\s+key=\{householdId\}/);
});

test('dashboard loads and mutates only household-scoped dashboard and bill resources', async () => {
  const dashboard = await readOptional('app/components/HouseholdDashboard.tsx');

  assert.match(dashboard, /householdDashboardApiPath\(householdId\)/);
  assert.match(dashboard, /householdBillApiPath\(householdId, billMonth\)/);
  assert.match(dashboard, /householdBillApiPath\(householdId, month\)/);
  assert.doesNotMatch(dashboard, /['"]\/api\/(?:home|bills)/);
});

test('My Home activates Task 6 autosave only with verified user and route membership scope', async () => {
  const myHome = await readOptional('app/components/HouseholdMyHome.tsx');

  assert.match(myHome, /createScopedHomeAutosaveController/);
  assert.match(myHome, /controller\.activate\(\{ userId: user\.id, householdId \}\)/);
  assert.match(myHome, /discardDraftAndReload/);
  assert.match(myHome, /controller\.retry\(\)/);
  assert.doesNotMatch(myHome, /['"]\/api\/home/);
});

test('viewer UI exposes a read-only explanation and gates every home and bill mutation surface', async () => {
  const [dashboard, myHome] = await Promise.all([
    readOptional('app/components/HouseholdDashboard.tsx'),
    readOptional('app/components/HouseholdMyHome.tsx'),
  ]);

  assert.match(dashboard, /const canEdit = canEditHousehold\(household\.role\)/);
  assert.match(dashboard, /คุณมีสิทธิ์ดูข้อมูลเท่านั้น/);
  assert.match(dashboard, /\{canEdit && <Button[^>]+onClick=\{\(\) => openBillForm\(\)\}/);
  assert.match(myHome, /const readOnly = !canEditHousehold\(household\.role\)/);
  assert.match(myHome, /คุณมีสิทธิ์ดูข้อมูลเท่านั้น/);
  assert.match(myHome, /disabled=\{readOnly \|\| !canMutate\}/);
});

test('compatibility entries use the zero-one-many household decision instead of a first-household fallback', async () => {
  const [root, legacyHome, entry] = await Promise.all([
    readOptional('app/page.tsx'),
    readOptional('app/my-home/page.tsx'),
    readOptional('app/components/HouseholdEntry.tsx'),
  ]);

  assert.match(root, /<HouseholdEntry destination="dashboard"/);
  assert.match(legacyHome, /<HouseholdEntry destination="my-home"/);
  assert.match(entry, /decideHouseholdEntry\(households, destination\)/);
  assert.match(entry, /method: 'POST'/);
  assert.match(entry, /เลือกบ้านที่ต้องการ/);
  assert.doesNotMatch(entry, /households\[0\]/);
});

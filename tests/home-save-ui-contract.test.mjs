import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = () => readFile(new URL('../app/components/HouseholdMyHome.tsx', import.meta.url), 'utf8');

test('My Home delegates durable scoped drafts and save scheduling to the Task 6 controller', async () => {
  const source = await read();

  assert.match(source, /createScopedHomeAutosaveController/);
  assert.match(source, /controller\.activate\(\{ userId: user\.id, householdId \}\)/);
  assert.match(source, /controller\.dispose\(\)/);
  assert.doesNotMatch(source, /syncPendingHomeSave|readPendingHomeSave|\/api\/home/);
});

test('server and pending loads preserve separate saved appliance instances', async () => {
  const source = await read();

  assert.doesNotMatch(source, /mergeHomeItems/);
  assert.match(source, /const homeItems = autosaveState\.items/);
  assert.match(source, /controller\.subscribe\(setAutosaveState\)/);
});

test('quantity UI caps and snaps typed values to the 1 through 99 save contract', async () => {
  const source = await read();

  assert.match(source, /label="จำนวน" unit="เครื่อง" value=\{item\.quantity\} min=\{1\} max=\{99\} step=\{1\}/);
  assert.match(source, /Math\.min\(99, Math\.max\(1, Math\.round\(Number\.isFinite\(value\) \? value : 1\)\)\)/);
});

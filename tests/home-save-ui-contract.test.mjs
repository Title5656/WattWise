import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = () => readFile(new URL('../app/my-home/page.tsx', import.meta.url), 'utf8');

test('My Home synchronizes pending storage before scheduling a save', async () => {
  const source = await read();

  assert.match(source, /syncPendingHomeSave/);
  assert.doesNotMatch(source, /stagePendingHomeSave\(storage, body\)/);
});

test('server and pending loads preserve separate saved appliance instances', async () => {
  const source = await read();

  assert.doesNotMatch(source, /mergeHomeItems/);
  assert.match(source, /setHomeItems\(pending\.items\)/);
  assert.match(source, /setHomeItems\(data\.items\)/);
});

test('quantity UI caps and snaps typed values to the 1 through 99 save contract', async () => {
  const source = await read();

  assert.match(source, /label="จำนวน" unit="เครื่อง" value=\{item\.quantity\} min=\{1\} max=\{99\} step=\{1\}/);
  assert.match(source, /Math\.min\(99, Math\.max\(1, Math\.round\(Number\.isFinite\(value\) \? value : 1\)\)\)/);
});

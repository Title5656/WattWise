import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('My Home uses button-based usage periods without drag and drop handlers', async () => {
  const source = await read('../app/my-home/page.tsx');

  assert.doesNotMatch(source, /draggable|onDragStart|onDragOver|onDrop|dataTransfer/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /type="button"/);
  assert.match(source, /setAllDayUsageSchedule/);
});

test('dashboard graph is based on the home daily load profile', async () => {
  const source = await read('../app/page.tsx');

  assert.match(source, /calculateDailyLoadProfile/);
  assert.doesNotMatch(source, /const chartData/);
  assert.doesNotMatch(source, /period-switch/);
  assert.match(source, /ประมาณการจากช่วงเวลาที่ตั้งไว้/);
});

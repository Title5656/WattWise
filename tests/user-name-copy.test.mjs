import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const statusPage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../app/components/WattWiseSidebar.tsx', import.meta.url), 'utf8');

test('status and account copy uses the current user name', () => {
  const combinedCopy = `${statusPage}\n${sidebar}`;

  assert.match(combinedCopy, /สวัสดีคุณวิทวัส/);
  assert.match(combinedCopy, /บ้านวิทวัส/);
  assert.match(combinedCopy, /สถานะบ้าน/);
  assert.doesNotMatch(sidebar, />วิทวัส</);
  assert.doesNotMatch(combinedCopy, /วรปรัชญ์/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the shared sidebar renders the supplied WattWise logo', async () => {
  const sidebar = await readFile(new URL('../app/components/WattWiseSidebar.tsx', import.meta.url), 'utf8');

  assert.match(sidebar, /<Image[^>]+src="\/wattwise-logo\.png"[^>]+alt="WattWise"/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the shared sidebar renders the supplied WattWise logo', async () => {
  const sidebar = await readFile(new URL('../app/components/WattWiseSidebar.tsx', import.meta.url), 'utf8');

  // The adjacent wordmark names the link; the image is decorative to avoid repetition.
  assert.match(sidebar, /<Image[^>]+src="\/wattwise-logo-small\.png"[^>]+alt=""/);
  assert.match(sidebar, /<b>WattWise<\/b>/);
});

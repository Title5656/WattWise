import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public pages do not include the meteor field or its animation styles', async () => {
  const [dashboard, myHome, styles] = await Promise.all([
    readProjectFile('app/page.tsx'),
    readProjectFile('app/my-home/page.tsx'),
    readProjectFile('app/globals.css'),
  ]);

  for (const source of [dashboard, myHome, styles]) {
    assert.doesNotMatch(source, /meteor-field|meteor-shower|star-breathe/);
  }
});

test('the root metadata uses the supplied WattWise logo as its favicon', async () => {
  const layout = await readProjectFile('app/layout.tsx');

  assert.match(layout, /icons:\s*{\s*icon:\s*['"]\/wattwise-logo\.png['"]/);
});

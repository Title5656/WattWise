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

test('the root metadata and sidebar use the optimized WattWise logo', async () => {
  const [layout, sidebar] = await Promise.all([
    readProjectFile('app/layout.tsx'),
    readProjectFile('app/components/WattWiseSidebar.tsx'),
  ]);

  for (const source of [layout, sidebar]) {
    assert.match(source, /\/wattwise-logo-small\.png/);
    assert.doesNotMatch(source, /\/wattwise-logo\.png/);
  }
});

test('public styles do not use blur-based glass rendering', async () => {
  const styles = await readProjectFile('app/globals.css');

  assert.doesNotMatch(styles, /(?:-webkit-)?backdrop-filter\s*:/);
  assert.doesNotMatch(styles, /filter\s*:\s*blur\s*\(/);
});

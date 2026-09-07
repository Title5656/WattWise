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

test('glass rendering stays on outer shells while data cards remain opaque', async () => {
  const styles = await readProjectFile('app/globals.css');

  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/(?:-webkit-)?backdrop-filter\s*:/.test(rule[2])) {
      assert.ok(['.sidebar', '.dashboard-content', '.my-home-content'].includes(rule[1].trim()));
    }
  }
  for (const selector of ['load-card', 'devices-card', 'bill-card', 'metric-card']) {
    const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`));
    assert.ok(rule, `${selector} styles exist`);
    assert.match(rule[1], /background:\s*var\(--surface\)/);
  }
  assert.doesNotMatch(styles, /(?:^|[;{\s])filter\s*:\s*blur\s*\(/);
});

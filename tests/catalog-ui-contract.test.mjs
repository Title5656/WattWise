import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('My Home fetches the catalog API with a 300 ms search debounce instead of filtering the static catalog', async () => {
  const source = await read('../app/my-home/page.tsx');

  assert.match(source, /buildCatalogUrl/);
  assert.match(source, /debounce\([^]*300\)/);
  assert.doesNotMatch(source, /applianceCatalog\s+as\s+catalog|filteredCatalog|catalog\.filter/);
});

test('query and category changes reset results and obsolete catalog requests are cancelled', async () => {
  const source = await read('../app/my-home/page.tsx');

  assert.match(source, /createLatestRequestTracker/);
  assert.match(source, /dispatchCatalog\(\{ type: 'reset' \}\)/);
  assert.match(source, /signal:\s*request\.signal/);
  assert.match(source, /catalogRequests\.current\.isLatest\(request\.generation\)/);
  assert.match(source, /catalogRequests\.current\.cancel\(\)/);
});

test('catalog UI exposes accessible loading, retry, empty, and non-blocking load-more states', async () => {
  const source = await read('../app/my-home/page.tsx');

  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /ลองอีกครั้ง/);
  assert.match(source, /ไม่พบเครื่องใช้ไฟฟ้า/);
  assert.match(source, /โหลดเพิ่ม/);
  assert.match(source, /disabled=\{catalogState\.loadingMore\}/);
  assert.match(source, /catalogState\.pagination\.hasMore/);
});

test('catalog cards use API imagery and honest energy-spec units when adding full models', async () => {
  const source = await read('../app/my-home/page.tsx');

  assert.match(source, /src=\{item\.image\}/);
  assert.match(source, /formatCatalogEnergySpec\(item\.energySpec/);
  assert.match(source, /createHomeItem\(appliance\)/);
  assert.match(source, /addOrIncrementHomeItem/);
  assert.doesNotMatch(source, /watts === null \? '\u2014'/);
});

test('dashboard refreshes use latest-only cancellation and bill saves trigger the guarded refresh', async () => {
  const source = await read('../app/page.tsx');

  assert.match(source, /createLatestRequestTracker/);
  assert.match(source, /signal:\s*request\.signal/);
  assert.match(source, /dashboardRequests\.current\.isLatest\(request\.generation\)/);
  assert.match(source, /dashboardRequests\.current\.cancel\(\)/);
  assert.match(source, /await refreshHome\(\)/);
  assert.match(source, /isAbortError/);
});

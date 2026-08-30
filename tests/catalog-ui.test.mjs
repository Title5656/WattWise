import assert from 'node:assert/strict';
import test from 'node:test';

const catalogUi = await import('../lib/catalog-ui.ts').catch(() => ({}));
const latestRequest = await import('../lib/latest-request.ts').catch(() => ({}));

const categories = [
  { slug: 'fan', name: 'พัดลม', count: 2, image: '/products/fan.jpg' },
  { slug: 'water-heater', name: 'เครื่องทำน้ำอุ่น', count: 1, image: '/products/heater.jpg' },
];

const item = (id) => ({ id, category: 'พัดลม', brand: 'Hatari', model: id, name: id, detail: '', watts: 45, usageProfileId: 'fan', image: '/products/fan.jpg' });

test('catalog URL uses the exact category slug, trimmed search, and 24-item pages', () => {
  assert.equal(typeof catalogUi.buildCatalogUrl, 'function');
  assert.equal(
    catalogUi.buildCatalogUrl({ q: '  inverter fan  ', category: 'water-heater', page: 2 }),
    '/api/catalog?q=inverter+fan&category=water-heater&page=2&pageSize=24',
  );
  assert.equal(catalogUi.buildCatalogUrl({ q: '', category: null, page: 1 }), '/api/catalog?page=1&pageSize=24');
});

test('catalog requests wait until the debounced search matches the current trimmed query', () => {
  assert.equal(typeof catalogUi.isCatalogQueryReady, 'function');
  assert.equal(catalogUi.isCatalogQueryReady('new search', 'old search'), false);
  assert.equal(catalogUi.isCatalogQueryReady('  new search  ', 'new search'), true);
});

test('catalog energy formatter reports the model calculation unit without fake watts', () => {
  assert.equal(typeof catalogUi.formatCatalogEnergySpec, 'function');
  assert.deepEqual(catalogUi.formatCatalogEnergySpec({ calculationMethod: 'rated_power', ratedPowerW: 1234.6, loadFactor: null }), { value: '1,235', unit: 'W' });
  assert.deepEqual(catalogUi.formatCatalogEnergySpec({ calculationMethod: 'annual_energy', annualEnergyKwh: 365.25 }), { value: '365.25', unit: 'kWh/year' });
  assert.deepEqual(catalogUi.formatCatalogEnergySpec({ calculationMethod: 'per_cycle', energyPerCycleKwh: 1.25 }), { value: '1.25', unit: 'kWh/cycle' });
});

test('reset clears obsolete results and pagination while preserving category metadata', () => {
  assert.equal(typeof catalogUi.catalogReducer, 'function');
  const previous = {
    items: [item('old')], categories,
    pagination: { page: 3, pageSize: 24, total: 50, totalPages: 3, hasMore: false },
    loading: false, loadingMore: false, error: null, loadMoreError: null,
  };

  const next = catalogUi.catalogReducer(previous, { type: 'reset' });

  assert.deepEqual(next.items, []);
  assert.deepEqual(next.categories, categories);
  assert.deepEqual(next.pagination, { page: 0, pageSize: 24, total: 0, totalPages: 0, hasMore: false });
  assert.equal(next.loading, true);
});

test('load-more success appends catalog keys once and advances pagination', () => {
  const previous = {
    items: [item('fan-a'), item('fan-b')], categories,
    pagination: { page: 1, pageSize: 24, total: 4, totalPages: 2, hasMore: true },
    loading: false, loadingMore: true, error: null, loadMoreError: null,
  };
  const response = {
    items: [item('fan-b'), item('fan-c')], categories,
    pagination: { page: 2, pageSize: 24, total: 3, totalPages: 2, hasMore: false },
  };

  const next = catalogUi.catalogReducer(previous, { type: 'success', response, append: true });

  assert.deepEqual(next.items.map(({ id }) => id), ['fan-a', 'fan-b', 'fan-c']);
  assert.deepEqual(next.pagination, response.pagination);
  assert.equal(next.loadingMore, false);
});

test('load-more failure is non-blocking and leaves current catalog results available', () => {
  const previous = {
    items: [item('fan-a')], categories,
    pagination: { page: 1, pageSize: 24, total: 2, totalPages: 2, hasMore: true },
    loading: false, loadingMore: true, error: null, loadMoreError: null,
  };

  const next = catalogUi.catalogReducer(previous, { type: 'failure', append: true, message: 'โหลดเพิ่มไม่สำเร็จ' });

  assert.deepEqual(next.items.map(({ id }) => id), ['fan-a']);
  assert.equal(next.error, null);
  assert.equal(next.loadMoreError, 'โหลดเพิ่มไม่สำเร็จ');
});

test('latest request tracker aborts the obsolete request and recognizes only the latest generation', () => {
  assert.equal(typeof latestRequest.createLatestRequestTracker, 'function');
  const tracker = latestRequest.createLatestRequestTracker();
  const first = tracker.begin();
  const second = tracker.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(tracker.isLatest(first.generation), false);
  assert.equal(tracker.isLatest(second.generation), true);

  tracker.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(tracker.isLatest(second.generation), false);
});

test('AbortError detection does not classify ordinary failures as cancellation', () => {
  assert.equal(latestRequest.isAbortError(new DOMException('stopped', 'AbortError')), true);
  assert.equal(latestRequest.isAbortError(new Error('network failed')), false);
});

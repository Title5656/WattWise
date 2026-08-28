import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readStyles = () => readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

function latestRule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return rules.at(-1)?.[1] ?? '';
}

test('readability-critical copy uses the shared minimum type scale', async () => {
  const styles = await readStyles();

  assert.match(styles, /--text-caption:\s*12px/);
  assert.match(styles, /--text-body:\s*14px/);

  const selectors = [
    '.metric-title small',
    '.metric-value span',
    '.bar-column small',
    '.builder-summary small',
    '.builder-summary em',
    '.builder-bill-breakdown small',
    '.builder-product-copy>em',
    '.builder-product-copy>span',
    '.builder-product-copy>small',
    '.builder-item-name small',
    '.number-stepper-label',
    '.number-stepper-control small',
    '.save-pill',
    '.back-status',
    '.side-nav a small',
    '.sidebar-account small',
    '.builder-method span',
    '.sidebar-account>i',
    '.dashboard-header>div>span',
    '.device-empty b',
    '.insight-action',
  ];

  for (const selector of selectors) {
    assert.match(latestRule(styles, selector), /font-size\s*:\s*var\(--text-(?:caption|body)\)/, selector);
  }
});

test('responsive readability rules preserve touch targets and compact empty states', async () => {
  const styles = await readStyles();

  assert.match(styles, /\.number-stepper-control button\s*\{[^}]*min-width:\s*44px/);
  assert.match(styles, /\.number-stepper-control button\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.builder-dropzone\s*\{[^}]*min-height:\s*320px/);
  assert.match(styles, /@media\s*\(max-width:\s*480px\)[^{]*\{[\s\S]*\.builder-home-item-controls\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('mobile My Home keeps the heading full width and groups summary units with values', async () => {
  const styles = await readStyles();

  assert.match(styles, /@media\s*\(max-width:\s*700px\)[^{]*\{[\s\S]*\.builder-header\s*\{[^}]*flex-direction:\s*column/);
  assert.match(styles, /\.builder-summary article>span\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
});

test('interactive controls keep a 44px touch target', async () => {
  const styles = await readStyles();
  const selectors = [
    '.builder-tabs button',
    '.builder-period-chip',
    '.builder-usage-schedule-header button',
    '.number-stepper-control button',
    '.monthly-record-actions button',
    '.bill-form-header button',
    '.mobile-sidebar-toggle',
    '.sidebar-close',
    '.notify',
    '.home-status button',
    '.sidebar-account',
    '.insight-action',
  ];

  for (const selector of selectors) {
    assert.match(latestRule(styles, selector), /min-height\s*:\s*44px/, selector);
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function latestRule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return rules.at(-1)?.[1] ?? '';
}

test('header profile and notification controls share the same 44px height', async () => {
  const styles = await readProjectFile('app/globals.css');

  assert.match(latestRule(styles, '.notify'), /height:\s*44px/);
  assert.match(latestRule(styles, '.header-actions>.profile'), /height:\s*44px/);
  assert.match(latestRule(styles, '.header-actions>.profile'), /min-height:\s*44px/);
  assert.match(latestRule(styles, '.profile>i'), /width:\s*32px/);
  assert.match(latestRule(styles, '.profile>i'), /height:\s*32px/);
});

test('sidebar footer is a useful My Home status link', async () => {
  const [dashboard, myHome, sidebar] = await Promise.all([
    readProjectFile('app/components/HouseholdDashboard.tsx'),
    readProjectFile('app/components/HouseholdMyHome.tsx'),
    readProjectFile('app/components/WattWiseSidebar.tsx'),
  ]);

  assert.match(sidebar, /householdId\?: string; homeItemCount\?: number/);
  assert.match(sidebar, /className="sidebar-account"/);
  assert.match(sidebar, /href=\{myHomePath\}/);
  assert.match(sidebar, /householdMyHomePath\(householdId\)/);
  assert.match(sidebar, /aria-label="ไปจัดการอุปกรณ์ใน My Home"/);
  assert.match(sidebar, /อุปกรณ์ · ออนไลน์/);
  assert.doesNotMatch(sidebar, /เปิดโปรไฟล์|<i>WP<\/i>/);
  assert.match(dashboard, /householdId=\{householdId\} homeItemCount=\{homeLoading \? undefined : homeItems\.length\}/);
  assert.match(myHome, /householdId=\{householdId\} homeItemCount=\{autosaveState\.phase === 'loading' \? undefined : homeItems\.length\}/);
});

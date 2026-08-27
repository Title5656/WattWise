import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production deployment is main-only and applies D1 migrations before Worker deploy', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(workflow, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(workflow, /d1 migrations apply/);
  assert.match(workflow, /migrations_dir.*drizzle/);
  assert.ok(workflow.indexOf('d1 migrations apply') < workflow.indexOf('wrangler deploy'));
  assert.match(workflow, /api\/home/);
});

test('production artifacts use current artifact actions', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact@v4/);
});

test('D1 migration bootstrap is additive and idempotent', async () => {
  const bootstrap = await readFile(new URL('../scripts/d1-baseline.sql', import.meta.url), 'utf8');

  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS d1_migrations/);
  assert.match(bootstrap, /INSERT OR IGNORE INTO d1_migrations/);
  assert.doesNotMatch(bootstrap, /\b(?:DROP|DELETE|UPDATE)\b/i);
});

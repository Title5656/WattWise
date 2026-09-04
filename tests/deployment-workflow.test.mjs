import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production deployment is main-only, migrates before deploy, and smokes a global endpoint', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(workflow, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(workflow, /d1 migrations apply/);
  assert.match(workflow, /migrations_dir.*drizzle/);
  assert.ok(workflow.indexOf('d1 migrations apply') < workflow.indexOf('wrangler deploy'));
  assert.match(workflow, /MULTI_USER_CUTOVER_COMPLETE/);
  assert.match(workflow, /MULTI_USER_CUTOVER_COMPLETE\s*==\s*'true'/);
  assert.match(workflow, /cutover:remote -- verify/);
  assert.ok(workflow.indexOf('cutover:remote -- verify') < workflow.indexOf('wrangler deploy'));
  assert.match(workflow, /api\/catalog/);
  assert.doesNotMatch(workflow, /api\/home/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_TEAM_DOMAIN/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_AUD/);
  assert.match(workflow, /CF-Access-Client-Id/);
  assert.match(workflow, /CF-Access-Client-Secret/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_CLIENT_ID/);
  assert.match(workflow, /CLOUDFLARE_ACCESS_CLIENT_SECRET/);
});

test('manual production cutover backs up D1 and verifies without deploying', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cutover.yml', import.meta.url), 'utf8');

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /d1 export DB --remote/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /cutover:migrate/);
  assert.match(workflow, /cutover:remote -- preview/);
  assert.match(workflow, /cutover:remote -- backfill/);
  assert.match(workflow, /cutover:remote -- verify/);
  assert.ok(workflow.indexOf('d1 export DB --remote') < workflow.indexOf('cutover:migrate'));
  assert.ok(workflow.indexOf('cutover:migrate') < workflow.indexOf('cutover:remote -- preview'));
  assert.ok(workflow.indexOf('cutover:remote -- preview') < workflow.indexOf('cutover:remote -- backfill'));
  assert.ok(workflow.indexOf('cutover:remote -- backfill') < workflow.indexOf('cutover:remote -- verify'));
  assert.doesNotMatch(workflow, /wrangler deploy/);
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

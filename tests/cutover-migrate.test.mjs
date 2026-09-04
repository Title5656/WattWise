import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCutoverMigrations } from '../scripts/cutover-migrate.mjs';

test('cutover migration runner creates an isolated config and reconciles before listing and applying migrations', async () => {
  const invocations = [];
  const configurations = [];

  await runCutoverMigrations({
    environment: {
      CLOUDFLARE_API_TOKEN: 'secret-api-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_D1_DATABASE_ID: 'database-id',
    },
    runCommand: async (arguments_) => {
      const configPath = arguments_[arguments_.indexOf('--config') + 1];
      invocations.push(arguments_);
      configurations.push({
        path: configPath,
        value: JSON.parse(await readFile(configPath, 'utf8')),
      });
      return { exitCode: 0 };
    },
  });

  const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const [config] = configurations;
  assert.equal(config.value.d1_databases[0].database_id, 'database-id');
  assert.equal(config.value.d1_databases[0].migrations_dir, path.join(repository, 'drizzle'));
  assert.equal(JSON.stringify(config.value).includes('secret-api-token'), false);
  assert.deepEqual(invocations, [
    ['d1', 'execute', 'DB', '--remote', '--file', path.join(repository, 'scripts', 'd1-baseline.sql'), '--config', config.path],
    ['d1', 'migrations', 'list', 'DB', '--remote', '--config', config.path],
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config.path],
  ]);
  await assert.rejects(access(config.path));
});

test('cutover migration runner stops after the first failed Wrangler operation', async () => {
  const invocations = [];

  await assert.rejects(() => runCutoverMigrations({
    environment: {
      CLOUDFLARE_API_TOKEN: 'secret-api-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_D1_DATABASE_ID: 'database-id',
    },
    runCommand: async (arguments_) => {
      invocations.push(arguments_);
      return { exitCode: invocations.length === 2 ? 1 : 0 };
    },
  }), /Wrangler command failed/);

  assert.equal(invocations.length, 2);
});

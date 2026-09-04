import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCutoverMigrations } from '../scripts/cutover-migrate.mjs';

async function createBuildConfigFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'wattwise-cutover-test-'));
  const buildConfigPath = path.join(directory, 'wrangler.json');
  await writeFile(buildConfigPath, JSON.stringify({
    marker: 'self-contained-test',
    d1_databases: [{ binding: 'DB', database_id: 'placeholder' }],
  }), 'utf8');
  return {
    buildConfigPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('cutover migration runner creates an isolated config and reconciles before listing and applying migrations', async () => {
  const invocations = [];
  const configurations = [];
  const fixture = await createBuildConfigFixture();

  try {
    await runCutoverMigrations({
      buildConfigPath: fixture.buildConfigPath,
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
  } finally {
    await fixture.cleanup();
  }

  const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const [config] = configurations;
  assert.equal(config.value.marker, 'self-contained-test');
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
  const fixture = await createBuildConfigFixture();

  try {
    await assert.rejects(() => runCutoverMigrations({
      buildConfigPath: fixture.buildConfigPath,
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
  } finally {
    await fixture.cleanup();
  }

  assert.equal(invocations.length, 2);
});

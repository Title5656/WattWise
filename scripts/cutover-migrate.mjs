import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distConfigPath = path.join(repositoryPath, 'dist', 'server', 'wrangler.json');
const migrationsPath = path.join(repositoryPath, 'drizzle');
const baselinePath = path.join(repositoryPath, 'scripts', 'd1-baseline.sql');

const USAGE = 'Usage: npm run cutover:migrate';

export async function runCutoverMigrations({
  environment = process.env,
  runCommand = runWrangler,
} = {}) {
  const required = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_D1_DATABASE_ID',
  ];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`Missing environment values: ${missing.join(', ')}`);

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wattwise-cutover-'));
  const configPath = path.join(temporaryDirectory, 'wrangler.json');
  try {
    const config = JSON.parse(await readFile(distConfigPath, 'utf8'));
    const database = config.d1_databases?.find(({ binding }) => binding === 'DB');
    if (!database) throw new Error('Production build configuration does not define the DB D1 binding. Run npm run build first.');
    database.database_id = environment.CLOUDFLARE_D1_DATABASE_ID;
    database.migrations_dir = migrationsPath;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const commands = [
      ['d1', 'execute', 'DB', '--remote', '--file', baselinePath, '--config', configPath],
      ['d1', 'migrations', 'list', 'DB', '--remote', '--config', configPath],
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath],
    ];
    for (const arguments_ of commands) {
      const result = await runCommand(arguments_, environment);
      if (result?.exitCode !== 0) throw new Error('Wrangler command failed.');
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function runWrangler(arguments_, environment) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['wrangler', ...arguments_], {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve({ exitCode: exitCode ?? 1 }));
  });
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.length > 0) throw new Error(USAGE);
  await runCutoverMigrations({ environment });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Migration command failed.'}\n`);
    process.exitCode = 1;
  });
}

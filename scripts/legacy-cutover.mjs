import { pathToFileURL } from 'node:url';

import {
  issueHouseholdClaimToken,
  previewLegacyCutover,
  readLegacyCutoverVerification,
  runLegacyCutover,
} from '../lib/server/legacy-cutover.ts';
import { createD1RestDatabase } from './d1-rest-database.mjs';

const USAGE = `Usage:
  npm run cutover:remote -- preview
  npm run cutover:remote -- backfill
  npm run cutover:remote -- verify
  npm run cutover:remote -- issue-token --source-id <id> --expires-at <ISO-8601>`;

export async function executeCutoverCommand(args, options) {
  const [command, ...flags] = args;
  const { db, now = Date.now(), randomBytes } = options;
  if (command === 'preview') return previewLegacyCutover(db);
  if (command === 'backfill') return runLegacyCutover(db, { now });
  if (command === 'verify') return readLegacyCutoverVerification(db);
  if (command === 'issue-token') {
    const sourceId = parsePositiveInteger(readFlag(flags, '--source-id'));
    const expiresAt = Date.parse(readFlag(flags, '--expires-at') ?? '');
    if (!sourceId || !Number.isFinite(expiresAt)) throw new Error(USAGE);
    return issueHouseholdClaimToken(db, sourceId, { now, expiresAt, randomBytes });
  }
  throw new Error(USAGE);
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const required = {
    accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    databaseId: environment.CLOUDFLARE_D1_DATABASE_ID,
    apiToken: environment.CLOUDFLARE_API_TOKEN,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing environment values: ${missing.join(', ')}`);
  const db = createD1RestDatabase(required);
  const result = await executeCutoverCommand(args, { db });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args[0] === 'verify' && result.readyForClaims !== true) process.exitCode = 2;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function parsePositiveInteger(value) {
  if (!/^\d+$/u.test(value ?? '')) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Cutover command failed.'}\n`);
    process.exitCode = 1;
  });
}

import { StateConflictError, ValidationError } from './auth-errors.ts';

type SourceKind = 'relational' | 'saved-home';
type VerificationStatus = 'pending' | 'verified' | 'blocked' | 'claimed';

type CutoverSourceRow = {
  id: number;
  householdId: number;
  householdPublicId: string;
  verificationStatus: VerificationStatus;
};

type RelationalApplianceRow = {
  id: number;
  applianceModelId: number | null;
  customName: string | null;
  customPowerW: number | null;
  room: string;
  quantity: number;
  hoursPerDay: number | null;
  daysPerMonth: number;
  cyclesPerMonth: number | null;
  loadFactor: number | null;
  startMinute: number | null;
  endMinute: number | null;
  usageSchedule: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

type SavedApplianceRow = {
  id: number;
  applianceKey: string;
  quantity: number;
  hoursPerDay: number;
  cyclesPerMonth: number | null;
  usageSchedule: string | null;
  position: number;
  updatedAt: number;
};

type MonthlyRow = {
  id: number;
  billingMonth: string;
  estimatedKwh: number | null;
  estimatedBill: number | null;
  actualKwh: number | null;
  actualBill: number | null;
  estimatedAt: number | null;
  actualAt: number | null;
};

type CanonicalAppliance = Omit<RelationalApplianceRow, 'id'> & { instanceKey: string };

export type CutoverSourceResult = {
  sourceKind: SourceKind;
  sourceKey: string;
  householdPublicId: string;
  status: VerificationStatus;
};

export type CutoverVerification = {
  readyForClaims: boolean;
  totals: {
    sources: number;
    verified: number;
    blocked: number;
    claimed: number;
    issues: number;
    foreignKeyViolations: number;
  };
  sources: Array<CutoverSourceResult & {
    countsMatch: boolean;
    checksumsMatch: boolean;
    liveTargetMatches: boolean;
  }>;
};

export class HouseholdClaimNotFoundError extends Error {
  readonly code = 'HOUSEHOLD_CLAIM_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Household claim was not found.');
    this.name = 'HouseholdClaimNotFoundError';
  }
}

export async function runLegacyCutover(
  db: D1Database,
  options: { now?: number } = {},
): Promise<{ sources: CutoverSourceResult[] }> {
  const now = options.now ?? Date.now();
  const relationalRows = await db.prepare(`SELECT id FROM households
    WHERE public_id IS NULL ORDER BY id`).all<{ id: number }>();
  const keyedRows = await db.prepare(`SELECT household_key AS sourceKey FROM saved_home_appliances
    UNION SELECT household_key AS sourceKey FROM monthly_energy_records
    ORDER BY sourceKey`).all<{ sourceKey: string }>();

  const sources: Array<{ sourceKind: SourceKind; sourceKey: string }> = [
    ...relationalRows.results.map(({ id }) => ({ sourceKind: 'relational' as const, sourceKey: String(id) })),
    ...keyedRows.results.map(({ sourceKey }) => ({ sourceKind: 'saved-home' as const, sourceKey })),
  ];
  const results: CutoverSourceResult[] = [];

  for (const source of sources) {
    const mapping = await ensureQuarantineSource(db, source.sourceKind, source.sourceKey, now);
    if (mapping.verificationStatus === 'claimed') {
      results.push({ ...source, householdPublicId: mapping.householdPublicId, status: 'claimed' });
      continue;
    }
    const status = await copyAndVerifySource(db, mapping, source.sourceKind, source.sourceKey, now);
    results.push({ ...source, householdPublicId: mapping.householdPublicId, status });
  }

  return { sources: results };
}

export async function readLegacyCutoverVerification(db: D1Database): Promise<CutoverVerification> {
  type VerificationRow = {
    sourceKind: SourceKind;
    sourceKey: string;
    householdId: number;
    householdPublicId: string;
    status: VerificationStatus;
    sourceApplianceCount: number;
    copiedApplianceCount: number;
    sourceMonthlyCount: number;
    copiedMonthlyCount: number;
    sourceChecksum: string | null;
    targetChecksum: string | null;
    issueCount: number;
  };
  const rows = await db.prepare(`SELECT legacy_cutover_sources.source_kind AS sourceKind,
      legacy_cutover_sources.source_key AS sourceKey,
      legacy_cutover_sources.household_id AS householdId,
      households.public_id AS householdPublicId,
      legacy_cutover_sources.verification_status AS status,
      legacy_cutover_sources.source_appliance_count AS sourceApplianceCount,
      legacy_cutover_sources.copied_appliance_count AS copiedApplianceCount,
      legacy_cutover_sources.source_monthly_count AS sourceMonthlyCount,
      legacy_cutover_sources.copied_monthly_count AS copiedMonthlyCount,
      legacy_cutover_sources.source_checksum AS sourceChecksum,
      legacy_cutover_sources.target_checksum AS targetChecksum,
      legacy_cutover_sources.issue_count AS issueCount
    FROM legacy_cutover_sources
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    ORDER BY legacy_cutover_sources.source_kind, legacy_cutover_sources.source_key`)
    .all<VerificationRow>();
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
  const sources: CutoverVerification['sources'] = [];
  for (const row of rows.results) {
    const appliances = await readTargetAppliances(db, row.householdId);
    const monthly = await readTargetMonthly(db, row.householdId);
    const liveTargetChecksum = await checksum(appliances, monthly, []);
    sources.push({
      sourceKind: row.sourceKind,
      sourceKey: row.sourceKey,
      householdPublicId: row.householdPublicId,
      status: row.status,
      countsMatch: row.sourceApplianceCount === row.copiedApplianceCount
        && row.sourceMonthlyCount === row.copiedMonthlyCount
        && row.copiedApplianceCount === appliances.length
        && row.copiedMonthlyCount === monthly.length,
      checksumsMatch: row.sourceChecksum !== null && row.sourceChecksum === row.targetChecksum,
      liveTargetMatches: row.targetChecksum !== null && row.targetChecksum === liveTargetChecksum,
    });
  }
  const totals = {
    sources: rows.results.length,
    verified: rows.results.filter(({ status }) => status === 'verified').length,
    blocked: rows.results.filter(({ status }) => status === 'blocked').length,
    claimed: rows.results.filter(({ status }) => status === 'claimed').length,
    issues: rows.results.reduce((sum, { issueCount }) => sum + issueCount, 0),
    foreignKeyViolations: foreignKeys.results.length,
  };
  return {
    readyForClaims: foreignKeys.results.length === 0
      && sources.every((source) => (source.status === 'verified' || source.status === 'claimed')
        && source.countsMatch && source.checksumsMatch && source.liveTargetMatches),
    totals,
    sources,
  };
}

export async function issueHouseholdClaimToken(
  db: D1Database,
  sourceId: number,
  options: {
    now?: number;
    expiresAt: number;
    randomBytes?: () => Uint8Array;
  },
): Promise<{ token: string; householdPublicId: string; expiresAt: number }> {
  const now = options.now ?? Date.now();
  if (!Number.isInteger(sourceId) || sourceId < 1 || !Number.isFinite(options.expiresAt) || options.expiresAt <= now) {
    throw new ValidationError('Claim source and expiry must be valid.');
  }
  const rows = await db.prepare(`SELECT households.public_id AS householdPublicId
    FROM legacy_cutover_sources
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    WHERE legacy_cutover_sources.id = ?
      AND legacy_cutover_sources.verification_status = 'verified'
      AND households.status = 'quarantined'`)
    .bind(sourceId)
    .all<{ householdPublicId: string }>();
  const source = rows.results[0];
  if (!source) throw new StateConflictError('HOUSEHOLD_CLAIM_NOT_VERIFIED', 'Household quarantine is not verified.');

  const bytes = options.randomBytes?.() ?? crypto.getRandomValues(new Uint8Array(32));
  if (bytes.byteLength < 32) throw new ValidationError('Claim tokens require at least 256 bits of entropy.');
  const token = encodeBase64Url(bytes);
  const tokenHash = await sha256(token);
  const inserted = await db.prepare(`INSERT INTO household_claim_tokens
      (source_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET token_hash = excluded.token_hash,
      expires_at = excluded.expires_at, created_at = excluded.created_at
    WHERE household_claim_tokens.consumed_at IS NULL
      AND household_claim_tokens.expires_at <= ?`)
    .bind(sourceId, tokenHash, options.expiresAt, now, now)
    .run();
  if (Number(inserted.meta.changes) !== 1) {
    throw new StateConflictError('HOUSEHOLD_CLAIM_TOKEN_EXISTS', 'A claim token has already been issued.');
  }
  return { token, householdPublicId: source.householdPublicId, expiresAt: options.expiresAt };
}

export async function claimQuarantinedHousehold(
  db: D1Database,
  userId: number,
  token: string,
  now = Date.now(),
): Promise<{ publicId: string }> {
  if (!Number.isInteger(userId) || userId < 1 || typeof token !== 'string' || token.length < 40 || token.length > 256) {
    throw new HouseholdClaimNotFoundError();
  }
  const tokenHash = await sha256(token);
  const result = await db.prepare(`UPDATE household_claim_tokens
    SET consumed_at = ?, claimed_by_user_id = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
      AND EXISTS (
        SELECT 1 FROM legacy_cutover_sources
        INNER JOIN households ON households.id = legacy_cutover_sources.household_id
        WHERE legacy_cutover_sources.id = household_claim_tokens.source_id
          AND legacy_cutover_sources.verification_status = 'verified'
          AND households.status = 'quarantined'
          AND NOT EXISTS (SELECT 1 FROM household_members
            WHERE household_members.household_id = households.id)
      )`)
    .bind(now, userId, tokenHash, now)
    .run();
  if (Number(result.meta.changes) !== 1) throw new HouseholdClaimNotFoundError();

  const rows = await db.prepare(`SELECT households.public_id AS publicId
    FROM household_claim_tokens
    INNER JOIN legacy_cutover_sources ON legacy_cutover_sources.id = household_claim_tokens.source_id
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    WHERE household_claim_tokens.token_hash = ? AND household_claim_tokens.claimed_by_user_id = ?
      AND household_claim_tokens.consumed_at = ? AND households.status = 'active'`)
    .bind(tokenHash, userId, now)
    .all<{ publicId: string }>();
  const household = rows.results[0];
  if (!household) throw new HouseholdClaimNotFoundError();
  return { publicId: household.publicId };
}

async function ensureQuarantineSource(
  db: D1Database,
  sourceKind: SourceKind,
  sourceKey: string,
  now: number,
): Promise<CutoverSourceRow> {
  const publicId = `hh_legacy_${(await sha256(`${sourceKind}\0${sourceKey}`)).slice(0, 24)}`;
  await db.batch([
    db.prepare(`INSERT INTO households
        (public_id, name, status, home_revision, created_at, updated_at)
      VALUES (?, ?, 'quarantined', 0, ?, ?)
      ON CONFLICT(public_id) DO NOTHING`)
      .bind(publicId, `Recovered WattWise home ${publicId.slice(-6)}`, now, now),
    db.prepare(`INSERT INTO legacy_cutover_sources
        (source_kind, source_key, household_id, verification_status, created_at, updated_at)
      SELECT ?, ?, id, 'pending', ?, ? FROM households WHERE public_id = ?
      ON CONFLICT(source_kind, source_key) DO NOTHING`)
      .bind(sourceKind, sourceKey, now, now, publicId),
  ]);
  const rows = await db.prepare(`SELECT legacy_cutover_sources.id AS id,
      legacy_cutover_sources.household_id AS householdId,
      legacy_cutover_sources.verification_status AS verificationStatus,
      households.public_id AS householdPublicId
    FROM legacy_cutover_sources
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    WHERE legacy_cutover_sources.source_kind = ? AND legacy_cutover_sources.source_key = ?`)
    .bind(sourceKind, sourceKey)
    .all<CutoverSourceRow>();
  const row = rows.results[0];
  if (!row) throw new Error('Unable to create quarantine source mapping.');
  return { ...row };
}

async function copyAndVerifySource(
  db: D1Database,
  mapping: CutoverSourceRow,
  sourceKind: SourceKind,
  sourceKey: string,
  now: number,
): Promise<VerificationStatus> {
  const issues: Array<{ code: string; table: string; rowId: string; details: string }> = [];
  let appliances: CanonicalAppliance[];
  let monthly: MonthlyRow[];

  if (sourceKind === 'relational') {
    const rows = await db.prepare(`SELECT id, appliance_model_id AS applianceModelId,
        custom_name AS customName, custom_power_w AS customPowerW, room, quantity,
        hours_per_day AS hoursPerDay, days_per_month AS daysPerMonth,
        cycles_per_month AS cyclesPerMonth, load_factor AS loadFactor,
        start_minute AS startMinute, end_minute AS endMinute,
        usage_schedule AS usageSchedule, position, created_at AS createdAt, updated_at AS updatedAt
      FROM household_appliances WHERE household_id = ? ORDER BY id`)
      .bind(Number(sourceKey))
      .all<RelationalApplianceRow>();
    appliances = rows.results.map(({ id, ...row }) => ({ ...row, instanceKey: `legacy-relational:${id}` }));
    monthly = [];
  } else {
    const savedRows = await db.prepare(`SELECT id, appliance_key AS applianceKey, quantity,
        hours_per_day AS hoursPerDay, cycles_per_month AS cyclesPerMonth,
        usage_schedule AS usageSchedule, position, updated_at AS updatedAt
      FROM saved_home_appliances WHERE household_key = ? ORDER BY id`)
      .bind(sourceKey)
      .all<SavedApplianceRow>();
    const modelIds = await readCatalogModelIds(db, savedRows.results.map(({ applianceKey }) => applianceKey));
    appliances = [];
    for (const row of savedRows.results) {
      const applianceModelId = modelIds.get(row.applianceKey);
      if (applianceModelId === undefined) {
        issues.push({
          code: 'UNKNOWN_CATALOG_KEY',
          table: 'saved_home_appliances',
          rowId: String(row.id),
          details: JSON.stringify({ applianceKey: row.applianceKey }),
        });
        continue;
      }
      appliances.push({
        applianceModelId,
        customName: null,
        customPowerW: null,
        room: 'ไม่ระบุ',
        quantity: row.quantity,
        hoursPerDay: row.hoursPerDay,
        daysPerMonth: 30,
        cyclesPerMonth: row.cyclesPerMonth,
        loadFactor: null,
        startMinute: null,
        endMinute: null,
        instanceKey: `legacy-saved:${row.id}`,
        usageSchedule: row.usageSchedule,
        position: row.position,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
      });
    }
    const rows = await db.prepare(`SELECT id, billing_month AS billingMonth,
        estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill,
        actual_kwh AS actualKwh, actual_bill AS actualBill,
        estimated_at AS estimatedAt, actual_at AS actualAt
      FROM monthly_energy_records WHERE household_key = ? ORDER BY billing_month, id`)
      .bind(sourceKey)
      .all<MonthlyRow>();
    monthly = rows.results.map((row) => ({ ...row }));
  }

  const sourceApplianceCount = appliances.length + issues.filter(({ code }) => code === 'UNKNOWN_CATALOG_KEY').length;
  const sourceChecksum = await checksum(appliances, monthly, issues);
  await runBatches(db, [
    db.prepare(`UPDATE legacy_cutover_sources SET verification_status = 'pending', verified_at = NULL,
      issue_count = 0, updated_at = ? WHERE id = ? AND verification_status != 'claimed'`).bind(now, mapping.id),
    db.prepare('DELETE FROM legacy_cutover_issues WHERE source_id = ?').bind(mapping.id),
    db.prepare('DELETE FROM household_appliances WHERE household_id = ?').bind(mapping.householdId),
    db.prepare('DELETE FROM household_monthly_energy_records WHERE household_id = ?').bind(mapping.householdId),
  ]);

  const insertStatements = [
    ...appliances.map((row) => db.prepare(`INSERT INTO household_appliances
      (household_id, appliance_model_id, custom_name, custom_power_w, room, quantity,
       hours_per_day, days_per_month, cycles_per_month, load_factor, start_minute, end_minute,
       instance_key, usage_schedule, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mapping.householdId, row.applianceModelId, row.customName, row.customPowerW, row.room,
        row.quantity, row.hoursPerDay, row.daysPerMonth, row.cyclesPerMonth, row.loadFactor,
        row.startMinute, row.endMinute, row.instanceKey, row.usageSchedule, row.position,
        row.createdAt, row.updatedAt)),
    ...monthly.map((row) => db.prepare(`INSERT INTO household_monthly_energy_records
      (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill,
       estimated_at, actual_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mapping.householdId, row.billingMonth, row.estimatedKwh, row.estimatedBill,
        row.actualKwh, row.actualBill, row.estimatedAt, row.actualAt)),
    ...issues.map((issue) => db.prepare(`INSERT INTO legacy_cutover_issues
      (source_id, code, source_table, source_row_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(mapping.id, issue.code, issue.table, issue.rowId, issue.details, now)),
  ];
  await runBatches(db, insertStatements);

  const targetAppliances = await readTargetAppliances(db, mapping.householdId);
  const targetMonthly = await readTargetMonthly(db, mapping.householdId);
  const targetChecksum = await checksum(targetAppliances, targetMonthly, []);
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
  const verified = issues.length === 0
    && sourceApplianceCount === targetAppliances.length
    && monthly.length === targetMonthly.length
    && sourceChecksum === targetChecksum
    && foreignKeys.results.length === 0;
  const status: VerificationStatus = verified ? 'verified' : 'blocked';

  await db.prepare(`UPDATE legacy_cutover_sources SET verification_status = ?,
      source_appliance_count = ?, copied_appliance_count = ?, source_monthly_count = ?,
      copied_monthly_count = ?, source_checksum = ?, target_checksum = ?, issue_count = ?,
      verified_at = ?, updated_at = ? WHERE id = ? AND verification_status != 'claimed'`)
    .bind(status, sourceApplianceCount, targetAppliances.length, monthly.length, targetMonthly.length,
      sourceChecksum, targetChecksum, issues.length, verified ? now : null, now, mapping.id)
    .run();
  return status;
}

async function readCatalogModelIds(db: D1Database, keys: string[]): Promise<Map<string, number>> {
  const uniqueKeys = [...new Set(keys)];
  const result = new Map<string, number>();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    if (chunk.length === 0) continue;
    const rows = await db.prepare(`SELECT id, catalog_key AS catalogKey FROM appliance_models
      WHERE catalog_key IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ id: number; catalogKey: string }>();
    for (const row of rows.results) result.set(row.catalogKey, row.id);
  }
  return result;
}

async function readTargetAppliances(db: D1Database, householdId: number): Promise<CanonicalAppliance[]> {
  const rows = await db.prepare(`SELECT appliance_model_id AS applianceModelId,
      custom_name AS customName, custom_power_w AS customPowerW, room, quantity,
      hours_per_day AS hoursPerDay, days_per_month AS daysPerMonth,
      cycles_per_month AS cyclesPerMonth, load_factor AS loadFactor,
      start_minute AS startMinute, end_minute AS endMinute, instance_key AS instanceKey,
      usage_schedule AS usageSchedule, position, created_at AS createdAt, updated_at AS updatedAt
    FROM household_appliances WHERE household_id = ? ORDER BY instance_key`)
    .bind(householdId)
    .all<CanonicalAppliance>();
  return rows.results.map((row) => ({ ...row }));
}

async function readTargetMonthly(db: D1Database, householdId: number): Promise<MonthlyRow[]> {
  const rows = await db.prepare(`SELECT id, billing_month AS billingMonth,
      estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill,
      actual_kwh AS actualKwh, actual_bill AS actualBill,
      estimated_at AS estimatedAt, actual_at AS actualAt
    FROM household_monthly_energy_records WHERE household_id = ? ORDER BY billing_month, id`)
    .bind(householdId)
    .all<MonthlyRow>();
  return rows.results.map((row) => ({ ...row }));
}

async function checksum(
  appliances: CanonicalAppliance[],
  monthly: MonthlyRow[],
  issues: Array<{ code: string; rowId: string; details: string }>,
): Promise<string> {
  const normalizedAppliances = appliances.map(({ instanceKey, ...row }) => ({ instanceKey, ...row }))
    .sort((left, right) => left.instanceKey.localeCompare(right.instanceKey));
  const normalizedMonthly = monthly.map((row) => ({
    billingMonth: row.billingMonth,
    estimatedKwh: row.estimatedKwh,
    estimatedBill: row.estimatedBill,
    actualKwh: row.actualKwh,
    actualBill: row.actualBill,
    estimatedAt: row.estimatedAt,
    actualAt: row.actualAt,
  }))
    .sort((left, right) => left.billingMonth.localeCompare(right.billingMonth));
  const normalizedIssues = issues.map(({ code, rowId, details }) => ({ code, rowId, details }))
    .sort((left, right) => left.rowId.localeCompare(right.rowId));
  return sha256(JSON.stringify({ appliances: normalizedAppliances, monthly: normalizedMonthly, issues: normalizedIssues }));
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 80) {
    const chunk = statements.slice(offset, offset + 80);
    if (chunk.length > 0) await db.batch(chunk);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

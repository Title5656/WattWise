import { StateConflictError, ValidationError } from './auth-errors.ts';

type SourceKind = 'relational' | 'saved-home';
type VerificationStatus = 'pending' | 'verified' | 'blocked' | 'claimed';
type ManifestItemKind = 'config' | 'appliance' | 'monthly';

type CutoverSourceRow = {
  id: number;
  householdId: number;
  householdPublicId: string;
  verificationStatus: VerificationStatus;
  manifestChecksum: string | null;
};

type HouseholdConfig = {
  name: string;
  province: string | null;
  electricityProvider: string | null;
  tariffProductId: number | null;
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

type ManifestRow = {
  itemKind: ManifestItemKind;
  sourceTable: string;
  sourceRowId: string;
  payload: string;
  payloadChecksum: string;
};

type CutoverIssue = { code: string; table: string; rowId: string; details: string };

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
    sourceId: number;
    countsMatch: boolean;
    checksumsMatch: boolean;
    liveTargetMatches: boolean;
    sourceDrift: boolean;
    verificationEpoch: number;
    targetChecksum: string | null;
  }>;
};

export type CutoverPreview = {
  sources: Array<{ sourceKind: SourceKind; sourceKey: string; captured: boolean }>;
};

export class HouseholdClaimNotFoundError extends Error {
  readonly code = 'HOUSEHOLD_CLAIM_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Household claim was not found.');
    this.name = 'HouseholdClaimNotFoundError';
  }
}

export async function previewLegacyCutover(db: D1Database): Promise<CutoverPreview> {
  const sources = await discoverSources(db);
  const existing = await db.prepare(`SELECT source_kind AS sourceKind, source_key AS sourceKey,
      manifest_checksum AS manifestChecksum FROM legacy_cutover_sources`)
    .all<{ sourceKind: SourceKind; sourceKey: string; manifestChecksum: string | null }>();
  const captured = new Set(existing.results
    .filter(({ manifestChecksum }) => manifestChecksum !== null)
    .map(({ sourceKind, sourceKey }) => `${sourceKind}\0${sourceKey}`));
  return { sources: sources.map((source) => ({
    ...source,
    captured: captured.has(`${source.sourceKind}\0${source.sourceKey}`),
  })) };
}

export async function runLegacyCutover(
  db: D1Database,
  options: { now?: number } = {},
): Promise<{ sources: CutoverSourceResult[] }> {
  const now = options.now ?? Date.now();
  const sources = await discoverSources(db);
  const results: CutoverSourceResult[] = [];
  for (const source of sources) {
    const mapping = await ensureQuarantineSource(db, source.sourceKind, source.sourceKey, now);
    if (mapping.verificationStatus === 'claimed') {
      results.push({ ...source, householdPublicId: mapping.householdPublicId, status: 'claimed' });
      continue;
    }
    await ensureFrozenManifest(db, mapping, source.sourceKind, source.sourceKey, now);
    const status = await copyAndVerifySource(db, mapping, source.sourceKind, source.sourceKey, now);
    results.push({ ...source, householdPublicId: mapping.householdPublicId, status });
  }
  return { sources: results };
}

export async function readLegacyCutoverVerification(db: D1Database): Promise<CutoverVerification> {
  type VerificationRow = {
    id: number;
    sourceKind: SourceKind;
    sourceKey: string;
    householdId: number;
    householdPublicId: string;
    status: VerificationStatus;
    sourceApplianceCount: number;
    copiedApplianceCount: number;
    sourceMonthlyCount: number;
    copiedMonthlyCount: number;
    manifestChecksum: string | null;
    verificationChecksum: string | null;
    targetChecksum: string | null;
    issueCount: number;
    verificationEpoch: number;
  };
  const rows = await db.prepare(`SELECT legacy_cutover_sources.id AS id,
      legacy_cutover_sources.source_kind AS sourceKind,
      legacy_cutover_sources.source_key AS sourceKey,
      legacy_cutover_sources.household_id AS householdId,
      households.public_id AS householdPublicId,
      legacy_cutover_sources.verification_status AS status,
      legacy_cutover_sources.source_appliance_count AS sourceApplianceCount,
      legacy_cutover_sources.copied_appliance_count AS copiedApplianceCount,
      legacy_cutover_sources.source_monthly_count AS sourceMonthlyCount,
      legacy_cutover_sources.copied_monthly_count AS copiedMonthlyCount,
      legacy_cutover_sources.manifest_checksum AS manifestChecksum,
      legacy_cutover_sources.verification_checksum AS verificationChecksum,
      legacy_cutover_sources.target_checksum AS targetChecksum,
      legacy_cutover_sources.issue_count AS issueCount,
      legacy_cutover_sources.verification_epoch AS verificationEpoch
    FROM legacy_cutover_sources
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    ORDER BY legacy_cutover_sources.source_kind, legacy_cutover_sources.source_key`)
    .all<VerificationRow>();
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
  const sources: CutoverVerification['sources'] = [];
  for (const row of rows.results) {
    if (row.status === 'claimed') {
      sources.push({
        sourceId: row.id, sourceKind: row.sourceKind, sourceKey: row.sourceKey,
        householdPublicId: row.householdPublicId, status: row.status,
        countsMatch: true, checksumsMatch: true, liveTargetMatches: true, sourceDrift: false,
        verificationEpoch: row.verificationEpoch, targetChecksum: row.targetChecksum,
      });
      continue;
    }
    const liveManifest = await readLiveManifestRows(db, row.sourceKind, row.sourceKey, row.householdPublicId);
    const liveManifestChecksum = await manifestChecksum(liveManifest);
    const appliances = await readTargetAppliances(db, row.householdId);
    const monthly = await readTargetMonthly(db, row.householdId);
    const config = await readTargetConfig(db, row.householdId);
    const liveTargetChecksum = config ? await transformedChecksum(config, appliances, monthly) : null;
    sources.push({
      sourceId: row.id, sourceKind: row.sourceKind, sourceKey: row.sourceKey,
      householdPublicId: row.householdPublicId, status: row.status,
      countsMatch: row.sourceApplianceCount === row.copiedApplianceCount
        && row.sourceMonthlyCount === row.copiedMonthlyCount
        && row.copiedApplianceCount === appliances.length
        && row.copiedMonthlyCount === monthly.length,
      checksumsMatch: row.verificationChecksum !== null && row.verificationChecksum === row.targetChecksum,
      liveTargetMatches: row.targetChecksum !== null && row.targetChecksum === liveTargetChecksum,
      sourceDrift: row.manifestChecksum === null || row.manifestChecksum !== liveManifestChecksum,
      verificationEpoch: row.verificationEpoch,
      targetChecksum: row.targetChecksum,
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
      && sources.every((source) => source.status === 'claimed'
        || (source.status === 'verified' && !source.sourceDrift
          && source.countsMatch && source.checksumsMatch && source.liveTargetMatches)),
    totals,
    sources,
  };
}

export async function issueHouseholdClaimToken(
  db: D1Database,
  sourceId: number,
  options: { now?: number; expiresAt: number; randomBytes?: () => Uint8Array },
): Promise<{ token: string; householdPublicId: string; expiresAt: number }> {
  const now = options.now ?? Date.now();
  if (!Number.isInteger(sourceId) || sourceId < 1 || !Number.isFinite(options.expiresAt) || options.expiresAt <= now) {
    throw new ValidationError('Claim source and expiry must be valid.');
  }
  const verification = await readLegacyCutoverVerification(db);
  const verified = verification.sources.find((source) => source.sourceId === sourceId);
  if (!verified || verified.status !== 'verified' || verified.sourceDrift
    || !verified.countsMatch || !verified.checksumsMatch || !verified.liveTargetMatches
    || !verified.targetChecksum) {
    throw new StateConflictError('HOUSEHOLD_CLAIM_NOT_VERIFIED', 'Household quarantine is not verified.');
  }
  const bytes = options.randomBytes?.() ?? crypto.getRandomValues(new Uint8Array(32));
  if (bytes.byteLength < 32) throw new ValidationError('Claim tokens require at least 256 bits of entropy.');
  const token = encodeBase64Url(bytes);
  const tokenHash = await sha256(token);
  const inserted = await db.prepare(`INSERT INTO household_claim_tokens
      (source_id, token_hash, verification_epoch, target_checksum, expires_at, created_at)
    SELECT id, ?, verification_epoch, target_checksum, ?, ? FROM legacy_cutover_sources
    WHERE id = ? AND verification_status = 'verified' AND source_drift = 0
      AND verification_epoch = ? AND target_checksum = ? AND sealed_at IS NOT NULL
    ON CONFLICT(source_id) DO UPDATE SET token_hash = excluded.token_hash,
      verification_epoch = excluded.verification_epoch, target_checksum = excluded.target_checksum,
      expires_at = excluded.expires_at, created_at = excluded.created_at
    WHERE household_claim_tokens.consumed_at IS NULL AND (
      household_claim_tokens.expires_at <= excluded.created_at
      OR household_claim_tokens.verification_epoch IS NOT excluded.verification_epoch
      OR household_claim_tokens.target_checksum IS NOT excluded.target_checksum
    )`)
    .bind(tokenHash, options.expiresAt, now, sourceId, verified.verificationEpoch, verified.targetChecksum)
    .run();
  if (Number(inserted.meta.changes) !== 1) {
    throw new StateConflictError('HOUSEHOLD_CLAIM_TOKEN_EXISTS', 'A claim token has already been issued.');
  }
  return { token, householdPublicId: verified.householdPublicId, expiresAt: options.expiresAt };
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
  const [consumeResult, memberResult, householdResult, sourceResult] = await db.batch([
    db.prepare(`UPDATE household_claim_tokens
    SET consumed_at = ?, claimed_by_user_id = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
      AND EXISTS (
        SELECT 1 FROM legacy_cutover_sources
        INNER JOIN households ON households.id = legacy_cutover_sources.household_id
        WHERE legacy_cutover_sources.id = household_claim_tokens.source_id
          AND legacy_cutover_sources.verification_status = 'verified'
          AND legacy_cutover_sources.source_drift = 0
          AND legacy_cutover_sources.verification_epoch = household_claim_tokens.verification_epoch
          AND legacy_cutover_sources.target_checksum = household_claim_tokens.target_checksum
          AND legacy_cutover_sources.sealed_at IS NOT NULL
          AND households.status = 'quarantined'
          AND NOT EXISTS (SELECT 1 FROM household_members
            WHERE household_members.household_id = households.id)
      )`).bind(now, userId, tokenHash, now),
    db.prepare(`INSERT INTO household_members (household_id, user_id, role, created_at, updated_at)
      SELECT legacy_cutover_sources.household_id, ?, 'owner', ?, ?
      FROM household_claim_tokens
      INNER JOIN legacy_cutover_sources ON legacy_cutover_sources.id = household_claim_tokens.source_id
      INNER JOIN households ON households.id = legacy_cutover_sources.household_id
      WHERE household_claim_tokens.token_hash = ? AND household_claim_tokens.claimed_by_user_id = ?
        AND household_claim_tokens.consumed_at = ? AND households.status = 'quarantined'
        AND NOT EXISTS (SELECT 1 FROM household_members WHERE household_members.household_id = households.id)`)
      .bind(userId, now, now, tokenHash, userId, now),
    db.prepare(`UPDATE households SET status = 'active', updated_at = ?
      WHERE status = 'quarantined' AND id = (
        SELECT legacy_cutover_sources.household_id FROM household_claim_tokens
        INNER JOIN legacy_cutover_sources ON legacy_cutover_sources.id = household_claim_tokens.source_id
        WHERE household_claim_tokens.token_hash = ? AND household_claim_tokens.claimed_by_user_id = ?
          AND household_claim_tokens.consumed_at = ?
      ) AND EXISTS (SELECT 1 FROM household_members
        WHERE household_members.household_id = households.id AND user_id = ? AND role = 'owner')`)
      .bind(now, tokenHash, userId, now, userId),
    db.prepare(`UPDATE legacy_cutover_sources
      SET verification_status = 'claimed', claimed_at = ?, updated_at = ?
      WHERE verification_status = 'verified' AND id = (
        SELECT source_id FROM household_claim_tokens
        WHERE token_hash = ? AND claimed_by_user_id = ? AND consumed_at = ?
      ) AND EXISTS (SELECT 1 FROM households
        WHERE households.id = legacy_cutover_sources.household_id AND status = 'active')`)
      .bind(now, now, tokenHash, userId, now),
  ]);
  if ([consumeResult, memberResult, householdResult, sourceResult]
    .some((result) => Number(result.meta.changes) !== 1)) throw new HouseholdClaimNotFoundError();
  const rows = await db.prepare(`SELECT households.public_id AS publicId
    FROM household_claim_tokens
    INNER JOIN legacy_cutover_sources ON legacy_cutover_sources.id = household_claim_tokens.source_id
    INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    WHERE household_claim_tokens.token_hash = ? AND household_claim_tokens.claimed_by_user_id = ?
      AND household_claim_tokens.consumed_at = ? AND households.status = 'active'`)
    .bind(tokenHash, userId, now).all<{ publicId: string }>();
  const household = rows.results[0];
  if (!household) throw new HouseholdClaimNotFoundError();
  return { publicId: household.publicId };
}

async function discoverSources(db: D1Database): Promise<Array<{ sourceKind: SourceKind; sourceKey: string }>> {
  const [existing, relational, keyed] = await Promise.all([
    db.prepare(`SELECT source_kind AS sourceKind, source_key AS sourceKey FROM legacy_cutover_sources`)
      .all<{ sourceKind: SourceKind; sourceKey: string }>(),
    db.prepare(`SELECT id FROM households WHERE public_id IS NULL ORDER BY id`).all<{ id: number }>(),
    db.prepare(`SELECT household_key AS sourceKey FROM saved_home_appliances
      UNION SELECT household_key AS sourceKey FROM monthly_energy_records`).all<{ sourceKey: string }>(),
  ]);
  const sources = new Map<string, { sourceKind: SourceKind; sourceKey: string }>();
  for (const source of existing.results) sources.set(`${source.sourceKind}\0${source.sourceKey}`, source);
  for (const { id } of relational.results) {
    const source = { sourceKind: 'relational' as const, sourceKey: String(id) };
    sources.set(`${source.sourceKind}\0${source.sourceKey}`, source);
  }
  for (const { sourceKey } of keyed.results) {
    const source = { sourceKind: 'saved-home' as const, sourceKey };
    sources.set(`${source.sourceKind}\0${source.sourceKey}`, source);
  }
  return [...sources.values()].sort((left, right) =>
    left.sourceKind.localeCompare(right.sourceKind) || left.sourceKey.localeCompare(right.sourceKey));
}

async function ensureQuarantineSource(
  db: D1Database,
  sourceKind: SourceKind,
  sourceKey: string,
  now: number,
): Promise<CutoverSourceRow> {
  const publicId = await legacyHouseholdPublicId(sourceKind, sourceKey);
  await db.batch([
    db.prepare(`INSERT INTO households
        (public_id, name, status, home_revision, created_at, updated_at)
      VALUES (?, ?, 'quarantined', 0, ?, ?) ON CONFLICT(public_id) DO NOTHING`)
      .bind(publicId, recoveredName(publicId), now, now),
    db.prepare(`INSERT INTO legacy_cutover_sources
        (source_kind, source_key, household_id, verification_status, created_at, updated_at)
      SELECT ?, ?, id, 'pending', ?, ? FROM households WHERE public_id = ?
      ON CONFLICT(source_kind, source_key) DO NOTHING`)
      .bind(sourceKind, sourceKey, now, now, publicId),
  ]);
  const rows = await db.prepare(`SELECT legacy_cutover_sources.id AS id,
      legacy_cutover_sources.household_id AS householdId,
      legacy_cutover_sources.verification_status AS verificationStatus,
      legacy_cutover_sources.manifest_checksum AS manifestChecksum,
      households.public_id AS householdPublicId
    FROM legacy_cutover_sources INNER JOIN households ON households.id = legacy_cutover_sources.household_id
    WHERE legacy_cutover_sources.source_kind = ? AND legacy_cutover_sources.source_key = ?`)
    .bind(sourceKind, sourceKey).all<CutoverSourceRow>();
  const row = rows.results[0];
  if (!row) throw new Error('Unable to create quarantine source mapping.');
  return { ...row };
}

async function ensureFrozenManifest(
  db: D1Database,
  mapping: CutoverSourceRow,
  sourceKind: SourceKind,
  sourceKey: string,
  now: number,
): Promise<void> {
  if (mapping.manifestChecksum !== null) return;
  const liveRows = await readLiveManifestRows(db, sourceKind, sourceKey, mapping.householdPublicId);
  await db.prepare(`DELETE FROM legacy_cutover_manifest_rows WHERE source_id = ?
    AND EXISTS (SELECT 1 FROM legacy_cutover_sources WHERE id = ? AND manifest_checksum IS NULL)`)
    .bind(mapping.id, mapping.id).run();
  await runBatches(db, liveRows.map((row) => db.prepare(`INSERT INTO legacy_cutover_manifest_rows
    (source_id, item_kind, source_table, source_row_id, payload, payload_checksum, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(mapping.id, row.itemKind, row.sourceTable, row.sourceRowId, row.payload, row.payloadChecksum, now)));
  const frozenRows = await readManifestRows(db, mapping.id);
  const frozenChecksum = await manifestChecksum(frozenRows);
  const applianceCount = frozenRows.filter(({ itemKind }) => itemKind === 'appliance').length;
  const monthlyCount = frozenRows.filter(({ itemKind }) => itemKind === 'monthly').length;
  const result = await db.prepare(`UPDATE legacy_cutover_sources SET
      source_appliance_count = ?, source_monthly_count = ?, source_checksum = ?,
      manifest_row_count = ?, manifest_checksum = ?, updated_at = ?
    WHERE id = ? AND manifest_checksum IS NULL`)
    .bind(applianceCount, monthlyCount, frozenChecksum, frozenRows.length, frozenChecksum, now, mapping.id).run();
  if (Number(result.meta.changes) !== 1) throw new Error('Unable to freeze legacy source manifest.');
}

async function copyAndVerifySource(
  db: D1Database,
  mapping: CutoverSourceRow,
  sourceKind: SourceKind,
  sourceKey: string,
  now: number,
): Promise<VerificationStatus> {
  const manifest = await readManifestRows(db, mapping.id);
  const sourceRows = await db.prepare(`SELECT manifest_checksum AS manifestChecksum,
      source_appliance_count AS sourceApplianceCount, source_monthly_count AS sourceMonthlyCount
    FROM legacy_cutover_sources WHERE id = ?`).bind(mapping.id)
    .all<{ manifestChecksum: string; sourceApplianceCount: number; sourceMonthlyCount: number }>();
  const baseline = sourceRows.results[0];
  if (!baseline) throw new Error('Legacy source baseline is unavailable.');
  const liveManifest = await readLiveManifestRows(db, sourceKind, sourceKey, mapping.householdPublicId);
  const liveChecksum = await manifestChecksum(liveManifest);
  const sourceDrift = liveChecksum !== baseline.manifestChecksum;
  const transformed = await transformManifest(db, sourceKind, manifest);
  const issues = [...transformed.issues];
  if (sourceDrift) issues.push({
    code: 'SOURCE_DRIFT',
    table: sourceKind === 'relational' ? 'households' : 'legacy_keyed_home',
    rowId: sourceKey,
    details: JSON.stringify({ expectedChecksum: baseline.manifestChecksum, liveChecksum }),
  });

  await runBatches(db, [
    db.prepare(`UPDATE legacy_cutover_sources SET verification_status = 'pending', verified_at = NULL,
      sealed_at = NULL, issue_count = 0, updated_at = ? WHERE id = ? AND verification_status != 'claimed'`)
      .bind(now, mapping.id),
    db.prepare('DELETE FROM legacy_cutover_issues WHERE source_id = ?').bind(mapping.id),
    db.prepare('DELETE FROM household_appliances WHERE household_id = ?').bind(mapping.householdId),
    db.prepare('DELETE FROM household_monthly_energy_records WHERE household_id = ?').bind(mapping.householdId),
    db.prepare(`UPDATE households SET name = ?, province = ?, electricity_provider = ?,
      tariff_product_id = ?, updated_at = ? WHERE id = ? AND status = 'quarantined'`)
      .bind(transformed.config.name, transformed.config.province, transformed.config.electricityProvider,
        transformed.config.tariffProductId, now, mapping.householdId),
  ]);
  await runBatches(db, [
    ...transformed.appliances.map((row) => applianceInsert(db, mapping.householdId, row)),
    ...transformed.monthly.map((row) => monthlyInsert(db, mapping.householdId, row)),
    ...issues.flatMap((issue) => [
      db.prepare(`INSERT INTO legacy_cutover_issues
        (source_id, code, source_table, source_row_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(mapping.id, issue.code, issue.table, issue.rowId, issue.details, now),
      db.prepare(`INSERT OR IGNORE INTO legacy_cutover_issue_events
        (source_id, code, source_table, source_row_id, details, observed_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(mapping.id, issue.code, issue.table, issue.rowId, issue.details, now),
    ]),
  ]);

  const targetConfig = await readTargetConfig(db, mapping.householdId);
  const targetAppliances = await readTargetAppliances(db, mapping.householdId);
  const targetMonthly = await readTargetMonthly(db, mapping.householdId);
  const verificationChecksum = await transformedChecksum(transformed.config, transformed.appliances, transformed.monthly);
  const targetChecksum = targetConfig ? await transformedChecksum(targetConfig, targetAppliances, targetMonthly) : null;
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
  const verified = issues.length === 0
    && baseline.sourceApplianceCount === targetAppliances.length
    && baseline.sourceMonthlyCount === targetMonthly.length
    && verificationChecksum === targetChecksum
    && foreignKeys.results.length === 0;
  const status: VerificationStatus = verified ? 'verified' : 'blocked';
  await db.prepare(`UPDATE legacy_cutover_sources SET verification_status = ?,
      copied_appliance_count = ?, copied_monthly_count = ?, verification_checksum = ?, target_checksum = ?,
      issue_count = ?, source_drift = ?, verification_epoch = verification_epoch + ?,
      verified_at = ?, sealed_at = ?, updated_at = ?
    WHERE id = ? AND verification_status != 'claimed'`)
    .bind(status, targetAppliances.length, targetMonthly.length, verificationChecksum, targetChecksum,
      issues.length, sourceDrift ? 1 : 0, verified ? 1 : 0,
      verified ? now : null, verified ? now : null, now, mapping.id).run();
  return status;
}

async function transformManifest(
  db: D1Database,
  sourceKind: SourceKind,
  manifest: ManifestRow[],
): Promise<{ config: HouseholdConfig; appliances: CanonicalAppliance[]; monthly: MonthlyRow[]; issues: CutoverIssue[] }> {
  const configRow = manifest.find(({ itemKind }) => itemKind === 'config');
  if (!configRow) throw new Error('Legacy source manifest has no configuration row.');
  const config = JSON.parse(configRow.payload) as HouseholdConfig;
  const monthly = manifest.filter(({ itemKind }) => itemKind === 'monthly')
    .map((row) => JSON.parse(row.payload) as MonthlyRow);
  const issues: CutoverIssue[] = [];
  if (sourceKind === 'relational') {
    const appliances = manifest.filter(({ itemKind }) => itemKind === 'appliance').map((manifestRow) => {
      const { id, ...row } = JSON.parse(manifestRow.payload) as RelationalApplianceRow;
      return { ...row, instanceKey: `legacy-relational:${id}` };
    });
    return { config, appliances, monthly, issues };
  }
  const saved = manifest.filter(({ itemKind }) => itemKind === 'appliance')
    .map((row) => JSON.parse(row.payload) as SavedApplianceRow);
  const modelIds = await readCatalogModelIds(db, saved.map(({ applianceKey }) => applianceKey));
  const appliances: CanonicalAppliance[] = [];
  for (const row of saved) {
    const applianceModelId = modelIds.get(row.applianceKey);
    if (applianceModelId === undefined) {
      issues.push({
        code: 'UNKNOWN_CATALOG_KEY', table: 'saved_home_appliances', rowId: String(row.id),
        details: JSON.stringify({ applianceKey: row.applianceKey }),
      });
      continue;
    }
    appliances.push({
      applianceModelId, customName: null, customPowerW: null, room: 'ไม่ระบุ',
      quantity: row.quantity, hoursPerDay: row.hoursPerDay, daysPerMonth: 30,
      cyclesPerMonth: row.cyclesPerMonth, loadFactor: null, startMinute: null, endMinute: null,
      instanceKey: `legacy-saved:${row.id}`, usageSchedule: row.usageSchedule, position: row.position,
      createdAt: row.updatedAt, updatedAt: row.updatedAt,
    });
  }
  return { config, appliances, monthly, issues };
}

async function readLiveManifestRows(
  db: D1Database,
  sourceKind: SourceKind,
  sourceKey: string,
  householdPublicId: string,
): Promise<ManifestRow[]> {
  const rows: ManifestRow[] = [];
  if (sourceKind === 'relational') {
    const configs = await db.prepare(`SELECT name, province, electricity_provider AS electricityProvider,
        tariff_product_id AS tariffProductId FROM households WHERE id = ? AND public_id IS NULL`)
      .bind(Number(sourceKey)).all<HouseholdConfig>();
    if (configs.results[0]) rows.push(await manifestRow('config', 'households', sourceKey, configs.results[0]));
    const appliances = await db.prepare(`SELECT id, appliance_model_id AS applianceModelId,
        custom_name AS customName, custom_power_w AS customPowerW, room, quantity,
        hours_per_day AS hoursPerDay, days_per_month AS daysPerMonth,
        cycles_per_month AS cyclesPerMonth, load_factor AS loadFactor,
        start_minute AS startMinute, end_minute AS endMinute,
        usage_schedule AS usageSchedule, position, created_at AS createdAt, updated_at AS updatedAt
      FROM household_appliances WHERE household_id = ? ORDER BY id`)
      .bind(Number(sourceKey)).all<RelationalApplianceRow>();
    for (const row of appliances.results) rows.push(await manifestRow('appliance', 'household_appliances', String(row.id), row));
  } else {
    rows.push(await manifestRow('config', 'legacy_keyed_home', sourceKey, {
      name: recoveredName(householdPublicId), province: null,
      electricityProvider: null, tariffProductId: null,
    } satisfies HouseholdConfig));
    const appliances = await db.prepare(`SELECT id, appliance_key AS applianceKey, quantity,
        hours_per_day AS hoursPerDay, cycles_per_month AS cyclesPerMonth,
        usage_schedule AS usageSchedule, position, updated_at AS updatedAt
      FROM saved_home_appliances WHERE household_key = ? ORDER BY id`)
      .bind(sourceKey).all<SavedApplianceRow>();
    for (const row of appliances.results) rows.push(await manifestRow('appliance', 'saved_home_appliances', String(row.id), row));
    const monthly = await db.prepare(`SELECT id, billing_month AS billingMonth,
        estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill,
        actual_kwh AS actualKwh, actual_bill AS actualBill,
        estimated_at AS estimatedAt, actual_at AS actualAt
      FROM monthly_energy_records WHERE household_key = ? ORDER BY billing_month, id`)
      .bind(sourceKey).all<MonthlyRow>();
    for (const row of monthly.results) rows.push(await manifestRow('monthly', 'monthly_energy_records', String(row.id), row));
  }
  return sortManifest(rows);
}

async function readManifestRows(db: D1Database, sourceId: number): Promise<ManifestRow[]> {
  const rows = await db.prepare(`SELECT item_kind AS itemKind, source_table AS sourceTable,
      source_row_id AS sourceRowId, payload, payload_checksum AS payloadChecksum
    FROM legacy_cutover_manifest_rows WHERE source_id = ? ORDER BY item_kind, source_table, source_row_id`)
    .bind(sourceId).all<ManifestRow>();
  return rows.results.map((row) => ({ ...row }));
}

async function manifestRow(
  itemKind: ManifestItemKind,
  sourceTable: string,
  sourceRowId: string,
  value: object,
): Promise<ManifestRow> {
  const payload = JSON.stringify(value);
  return { itemKind, sourceTable, sourceRowId, payload, payloadChecksum: await sha256(payload) };
}

function sortManifest(rows: ManifestRow[]): ManifestRow[] {
  return rows.sort((left, right) => left.itemKind.localeCompare(right.itemKind)
    || left.sourceTable.localeCompare(right.sourceTable)
    || left.sourceRowId.localeCompare(right.sourceRowId));
}

async function manifestChecksum(rows: ManifestRow[]): Promise<string> {
  return sha256(JSON.stringify(sortManifest(rows.map((row) => ({ ...row })))));
}

async function transformedChecksum(
  config: HouseholdConfig,
  appliances: CanonicalAppliance[],
  monthly: MonthlyRow[],
): Promise<string> {
  const normalizedAppliances = appliances.map(({ instanceKey, ...row }) => ({ instanceKey, ...row }))
    .sort((left, right) => left.instanceKey.localeCompare(right.instanceKey));
  const normalizedMonthly = monthly.map((row) => ({
    billingMonth: row.billingMonth, estimatedKwh: row.estimatedKwh, estimatedBill: row.estimatedBill,
    actualKwh: row.actualKwh, actualBill: row.actualBill, estimatedAt: row.estimatedAt, actualAt: row.actualAt,
  })).sort((left, right) => left.billingMonth.localeCompare(right.billingMonth));
  return sha256(JSON.stringify({ config, appliances: normalizedAppliances, monthly: normalizedMonthly }));
}

function applianceInsert(db: D1Database, householdId: number, row: CanonicalAppliance): D1PreparedStatement {
  return db.prepare(`INSERT INTO household_appliances
    (household_id, appliance_model_id, custom_name, custom_power_w, room, quantity,
     hours_per_day, days_per_month, cycles_per_month, load_factor, start_minute, end_minute,
     instance_key, usage_schedule, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(householdId, row.applianceModelId, row.customName, row.customPowerW, row.room,
      row.quantity, row.hoursPerDay, row.daysPerMonth, row.cyclesPerMonth, row.loadFactor,
      row.startMinute, row.endMinute, row.instanceKey, row.usageSchedule, row.position,
      row.createdAt, row.updatedAt);
}

function monthlyInsert(db: D1Database, householdId: number, row: MonthlyRow): D1PreparedStatement {
  return db.prepare(`INSERT INTO household_monthly_energy_records
    (household_id, billing_month, estimated_kwh, estimated_bill, actual_kwh, actual_bill,
     estimated_at, actual_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(householdId, row.billingMonth, row.estimatedKwh, row.estimatedBill,
      row.actualKwh, row.actualBill, row.estimatedAt, row.actualAt);
}

async function readCatalogModelIds(db: D1Database, keys: string[]): Promise<Map<string, number>> {
  const uniqueKeys = [...new Set(keys)];
  const result = new Map<string, number>();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    if (chunk.length === 0) continue;
    const rows = await db.prepare(`SELECT id, catalog_key AS catalogKey FROM appliance_models
      WHERE catalog_key IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk).all<{ id: number; catalogKey: string }>();
    for (const row of rows.results) result.set(row.catalogKey, row.id);
  }
  return result;
}

async function readTargetConfig(db: D1Database, householdId: number): Promise<HouseholdConfig | null> {
  const rows = await db.prepare(`SELECT name, province, electricity_provider AS electricityProvider,
      tariff_product_id AS tariffProductId FROM households WHERE id = ?`)
    .bind(householdId).all<HouseholdConfig>();
  return rows.results[0] ? { ...rows.results[0] } : null;
}

async function readTargetAppliances(db: D1Database, householdId: number): Promise<CanonicalAppliance[]> {
  const rows = await db.prepare(`SELECT appliance_model_id AS applianceModelId,
      custom_name AS customName, custom_power_w AS customPowerW, room, quantity,
      hours_per_day AS hoursPerDay, days_per_month AS daysPerMonth,
      cycles_per_month AS cyclesPerMonth, load_factor AS loadFactor,
      start_minute AS startMinute, end_minute AS endMinute, instance_key AS instanceKey,
      usage_schedule AS usageSchedule, position, created_at AS createdAt, updated_at AS updatedAt
    FROM household_appliances WHERE household_id = ? ORDER BY instance_key`)
    .bind(householdId).all<CanonicalAppliance>();
  return rows.results.map((row) => ({ ...row }));
}

async function readTargetMonthly(db: D1Database, householdId: number): Promise<MonthlyRow[]> {
  const rows = await db.prepare(`SELECT id, billing_month AS billingMonth,
      estimated_kwh AS estimatedKwh, estimated_bill AS estimatedBill,
      actual_kwh AS actualKwh, actual_bill AS actualBill,
      estimated_at AS estimatedAt, actual_at AS actualAt
    FROM household_monthly_energy_records WHERE household_id = ? ORDER BY billing_month, id`)
    .bind(householdId).all<MonthlyRow>();
  return rows.results.map((row) => ({ ...row }));
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 80) {
    const chunk = statements.slice(offset, offset + 80);
    if (chunk.length > 0) await db.batch(chunk);
  }
}

async function legacyHouseholdPublicId(sourceKind: SourceKind, sourceKey: string): Promise<string> {
  return `hh_legacy_${(await sha256(`${sourceKind}\0${sourceKey}`)).slice(0, 24)}`;
}

function recoveredName(publicId: string): string {
  return `Recovered WattWise home ${publicId.slice(-6)}`;
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

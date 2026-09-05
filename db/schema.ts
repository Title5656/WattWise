import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  nameTh: text('name_th').notNull(),
  nameEn: text('name_en').notNull(),
  calculationMethod: text('calculation_method', {
    enum: ['watt_hours', 'per_cycle', 'annual_energy', 'variable_load'],
  }).notNull(),
}, (table) => [uniqueIndex('idx_categories_slug').on(table.slug)]);

export const brands = sqliteTable('brands', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  countryCode: text('country_code'),
}, (table) => [uniqueIndex('idx_brands_name').on(table.name)]);

export const applianceModels = sqliteTable('appliance_models', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  catalogKey: text('catalog_key').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  modelCode: text('model_code').notNull(),
  displayName: text('display_name').notNull(),
  calculationMethod: text('calculation_method', {
    enum: ['rated_power', 'annual_energy', 'per_cycle'],
  }).notNull(),
  ratedPowerW: real('rated_power_w'),
  standbyPowerW: real('standby_power_w'),
  annualEnergyKwh: real('annual_energy_kwh'),
  energyPerCycleKwh: real('energy_per_cycle_kwh'),
  loadFactor: real('load_factor'),
  usageProfile: text('usage_profile'),
  capacityValue: real('capacity_value'),
  capacityUnit: text('capacity_unit'),
  efficiencyLabel: text('efficiency_label'),
  sourceUrl: text('source_url'),
  sourceName: text('source_name'),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  confidence: text('confidence', { enum: ['high', 'medium', 'low', 'sample'] }).notNull().default('sample'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_appliance_models_catalog_key').on(table.catalogKey),
  index('idx_appliance_models_active_category_sort').on(table.isActive, table.categoryId, table.sortOrder, table.catalogKey),
  index('idx_appliance_models_active_search').on(table.isActive, table.displayName, table.modelCode, table.catalogKey),
]);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicId: text('public_id').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  displayNameConfirmedAt: integer('display_name_confirmed_at', { mode: 'timestamp' }),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_users_public_id').on(table.publicId),
  index('idx_users_email').on(table.email),
]);

export const userIdentities = sqliteTable('user_identities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_user_identities_provider_subject').on(table.provider, table.subject),
  index('idx_user_identities_user').on(table.userId),
]);

export const tariffProducts = sqliteTable('tariff_products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productKey: text('product_key').notNull(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_tariff_products_product_key').on(table.productKey),
  index('idx_tariff_products_provider').on(table.provider),
]);

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicId: text('public_id'),
  name: text('name').notNull(),
  province: text('province'),
  electricityProvider: text('electricity_provider'),
  tariffProductId: integer('tariff_product_id').references(() => tariffProducts.id, { onDelete: 'set null' }),
  homeRevision: integer('home_revision').notNull().default(0),
  status: text('status', { enum: ['active', 'quarantined', 'deleted'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_households_public_id').on(table.publicId),
  index('idx_households_tariff_product').on(table.tariffProductId),
  check('households_status_check', sql`${table.status} IN ('active', 'quarantined', 'deleted')`),
]);

export const householdMembers = sqliteTable('household_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_household_members_household_user').on(table.householdId, table.userId),
  uniqueIndex('idx_household_members_one_owner').on(table.householdId).where(sql`${table.role} = 'owner'`),
  index('idx_household_members_user').on(table.userId, table.householdId),
  index('idx_household_members_household_role').on(table.householdId, table.role),
  check('household_members_role_check', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer')`),
]);

export const householdInvites = sqliteTable('household_invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  invitedByUserId: integer('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emailNormalized: text('email_normalized').notNull(),
  role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_household_invites_token_hash').on(table.tokenHash),
  index('idx_household_invites_household_email').on(table.householdId, table.emailNormalized),
  index('idx_household_invites_email').on(table.emailNormalized, table.expiresAt),
  index('idx_household_invites_inviter').on(table.invitedByUserId),
  check('household_invites_role_check', sql`${table.role} IN ('admin', 'member', 'viewer')`),
  check('household_invites_email_normalized_check', sql`${table.emailNormalized} = lower(trim(${table.emailNormalized}))`),
]);

export const householdAppliances = sqliteTable('household_appliances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  applianceModelId: integer('appliance_model_id').references(() => applianceModels.id),
  customName: text('custom_name'),
  customPowerW: real('custom_power_w'),
  room: text('room').notNull().default('ไม่ระบุ'),
  quantity: integer('quantity').notNull().default(1),
  hoursPerDay: real('hours_per_day'),
  daysPerMonth: integer('days_per_month').notNull().default(30),
  cyclesPerMonth: real('cycles_per_month'),
  loadFactor: real('load_factor'),
  startMinute: integer('start_minute'),
  endMinute: integer('end_minute'),
  instanceKey: text('instance_key'),
  usageSchedule: text('usage_schedule'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_household_appliances_household').on(table.householdId),
  uniqueIndex('idx_household_appliances_household_instance').on(table.householdId, table.instanceKey),
  index('idx_household_appliances_household_position').on(table.householdId, table.position),
]);

export const savedHomeAppliances = sqliteTable('saved_home_appliances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdKey: text('household_key').notNull(),
  applianceKey: text('appliance_key').notNull(),
  quantity: integer('quantity').notNull().default(1),
  hoursPerDay: real('hours_per_day').notNull().default(0),
  cyclesPerMonth: real('cycles_per_month'),
  usageSchedule: text('usage_schedule'),
  position: integer('position').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_saved_home_appliances_household').on(table.householdKey, table.position)]);

export const tariffPlans = sqliteTable('tariff_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').references(() => tariffProducts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  effectiveFrom: integer('effective_from', { mode: 'timestamp' }).notNull(),
  effectiveTo: integer('effective_to', { mode: 'timestamp' }),
  serviceCharge: real('service_charge').notNull().default(0),
  ftRatePerKwh: real('ft_rate_per_kwh').notNull().default(0),
  vatRate: real('vat_rate').notNull().default(0.07),
  sourceUrl: text('source_url'),
}, (table) => [
  index('idx_tariff_plans_effective').on(table.effectiveFrom),
  index('idx_tariff_plans_product_effective').on(table.productId, table.effectiveFrom),
]);

export const tariffTiers = sqliteTable('tariff_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tariffPlanId: integer('tariff_plan_id').notNull().references(() => tariffPlans.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  fromKwh: real('from_kwh').notNull(),
  toKwh: real('to_kwh'),
  ratePerKwh: real('rate_per_kwh').notNull(),
}, (table) => [uniqueIndex('idx_tariff_tiers_plan_sequence').on(table.tariffPlanId, table.sequence)]);

export const legacyMonthlyEnergyRecords = sqliteTable('monthly_energy_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdKey: text('household_key').notNull(),
  billingMonth: text('billing_month').notNull(),
  estimatedKwh: real('estimated_kwh'),
  estimatedBill: real('estimated_bill'),
  actualKwh: real('actual_kwh'),
  actualBill: real('actual_bill'),
  estimatedAt: integer('estimated_at'),
  actualAt: integer('actual_at'),
}, (table) => [
  uniqueIndex('idx_monthly_energy_records_household_month').on(table.householdKey, table.billingMonth),
]);

export const monthlyEnergyRecords = sqliteTable('household_monthly_energy_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  billingMonth: text('billing_month').notNull(),
  estimatedKwh: real('estimated_kwh'),
  estimatedBill: real('estimated_bill'),
  actualKwh: real('actual_kwh'),
  actualBill: real('actual_bill'),
  estimatedAt: integer('estimated_at'),
  actualAt: integer('actual_at'),
}, (table) => [
  uniqueIndex('idx_household_monthly_energy_records_household_month').on(table.householdId, table.billingMonth),
]);

export const legacyCutoverSources = sqliteTable('legacy_cutover_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceKind: text('source_kind', { enum: ['relational', 'saved-home'] }).notNull(),
  sourceKey: text('source_key').notNull(),
  householdId: integer('household_id').notNull().references(() => households.id, { onDelete: 'restrict' }),
  verificationStatus: text('verification_status', {
    enum: ['pending', 'verified', 'blocked', 'claimed'],
  }).notNull().default('pending'),
  sourceApplianceCount: integer('source_appliance_count').notNull().default(0),
  copiedApplianceCount: integer('copied_appliance_count').notNull().default(0),
  sourceMonthlyCount: integer('source_monthly_count').notNull().default(0),
  copiedMonthlyCount: integer('copied_monthly_count').notNull().default(0),
  sourceChecksum: text('source_checksum'),
  manifestRowCount: integer('manifest_row_count'),
  manifestChecksum: text('manifest_checksum'),
  verificationChecksum: text('verification_checksum'),
  targetChecksum: text('target_checksum'),
  issueCount: integer('issue_count').notNull().default(0),
  sourceDrift: integer('source_drift', { mode: 'boolean' }).notNull().default(false),
  verificationEpoch: integer('verification_epoch').notNull().default(0),
  sealedAt: integer('sealed_at'),
  verifiedAt: integer('verified_at'),
  claimedAt: integer('claimed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_legacy_cutover_sources_kind_key').on(table.sourceKind, table.sourceKey),
  uniqueIndex('idx_legacy_cutover_sources_household').on(table.householdId),
  index('idx_legacy_cutover_sources_status').on(table.verificationStatus),
  check('legacy_cutover_sources_kind_check', sql`${table.sourceKind} IN ('relational', 'saved-home')`),
  check('legacy_cutover_sources_status_check', sql`${table.verificationStatus} IN ('pending', 'verified', 'blocked', 'claimed')`),
]);

export const legacyCutoverManifestRows = sqliteTable('legacy_cutover_manifest_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => legacyCutoverSources.id, { onDelete: 'restrict' }),
  itemKind: text('item_kind', { enum: ['config', 'appliance', 'monthly'] }).notNull(),
  sourceTable: text('source_table').notNull(),
  sourceRowId: text('source_row_id').notNull(),
  payload: text('payload').notNull(),
  payloadChecksum: text('payload_checksum').notNull(),
  capturedAt: integer('captured_at').notNull(),
}, (table) => [
  uniqueIndex('idx_legacy_cutover_manifest_source_row').on(table.sourceId, table.itemKind, table.sourceTable, table.sourceRowId),
  index('idx_legacy_cutover_manifest_source').on(table.sourceId, table.itemKind),
  check('legacy_cutover_manifest_kind_check', sql`${table.itemKind} IN ('config', 'appliance', 'monthly')`),
]);

export const legacyCutoverIssues = sqliteTable('legacy_cutover_issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => legacyCutoverSources.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  sourceTable: text('source_table').notNull(),
  sourceRowId: text('source_row_id'),
  details: text('details').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_legacy_cutover_issues_source').on(table.sourceId, table.code),
]);

export const legacyCutoverIssueEvents = sqliteTable('legacy_cutover_issue_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => legacyCutoverSources.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  sourceTable: text('source_table').notNull(),
  sourceRowId: text('source_row_id'),
  details: text('details').notNull(),
  observedAt: integer('observed_at').notNull(),
}, (table) => [
  uniqueIndex('idx_legacy_cutover_issue_events_identity').on(
    table.sourceId,
    table.code,
    table.sourceTable,
    table.sourceRowId,
    table.details,
  ),
  index('idx_legacy_cutover_issue_events_source').on(table.sourceId, table.observedAt),
]);

export const householdClaimTokens = sqliteTable('household_claim_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => legacyCutoverSources.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  verificationEpoch: integer('verification_epoch'),
  targetChecksum: text('target_checksum'),
  expiresAt: integer('expires_at').notNull(),
  claimedByUserId: integer('claimed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  consumedAt: integer('consumed_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_household_claim_tokens_source').on(table.sourceId),
  uniqueIndex('idx_household_claim_tokens_hash').on(table.tokenHash),
  index('idx_household_claim_tokens_expiry').on(table.expiresAt),
]);

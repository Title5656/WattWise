import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  categoryId: integer('category_id').notNull().references(() => categories.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  modelCode: text('model_code').notNull(),
  displayName: text('display_name').notNull(),
  ratedPowerW: real('rated_power_w'),
  standbyPowerW: real('standby_power_w'),
  annualEnergyKwh: real('annual_energy_kwh'),
  energyPerCycleKwh: real('energy_per_cycle_kwh'),
  capacityValue: real('capacity_value'),
  capacityUnit: text('capacity_unit'),
  efficiencyLabel: text('efficiency_label'),
  sourceUrl: text('source_url'),
  sourceName: text('source_name'),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  confidence: text('confidence', { enum: ['high', 'medium', 'low', 'sample'] }).notNull().default('sample'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('idx_appliance_models_brand_model').on(table.brandId, table.modelCode),
  index('idx_appliance_models_category').on(table.categoryId),
]);

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  province: text('province'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('idx_household_appliances_household').on(table.householdId)]);

export const savedHomeAppliances = sqliteTable('saved_home_appliances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdKey: text('household_key').notNull(),
  applianceKey: text('appliance_key').notNull(),
  quantity: integer('quantity').notNull().default(1),
  hoursPerDay: real('hours_per_day').notNull().default(0),
  position: integer('position').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_saved_home_appliances_household').on(table.householdKey, table.position)]);

export const tariffPlans = sqliteTable('tariff_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  effectiveFrom: integer('effective_from', { mode: 'timestamp' }).notNull(),
  effectiveTo: integer('effective_to', { mode: 'timestamp' }),
  serviceCharge: real('service_charge').notNull().default(0),
  ftRatePerKwh: real('ft_rate_per_kwh').notNull().default(0),
  vatRate: real('vat_rate').notNull().default(0.07),
  sourceUrl: text('source_url'),
}, (table) => [index('idx_tariff_plans_effective').on(table.effectiveFrom)]);

export const tariffTiers = sqliteTable('tariff_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tariffPlanId: integer('tariff_plan_id').notNull().references(() => tariffPlans.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  fromKwh: real('from_kwh').notNull(),
  toKwh: real('to_kwh'),
  ratePerKwh: real('rate_per_kwh').notNull(),
}, (table) => [uniqueIndex('idx_tariff_tiers_plan_sequence').on(table.tariffPlanId, table.sequence)]);

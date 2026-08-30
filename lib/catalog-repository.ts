import { imageForCategory } from './catalog-images.ts';
import type { Appliance } from './home-config.ts';
import type { ApplianceEnergySpec, CalculationConfidence } from './energy.ts';
import { usageProfiles, type UsageProfileId } from './usage-profiles.ts';

export type CatalogCategory = {
  slug: string;
  name: string;
  count: number;
  image: string;
};

export type CatalogResponse = {
  items: Appliance[];
  categories: CatalogCategory[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export type CatalogQuery = {
  q: string;
  category: string | null;
  page: number;
  pageSize: number;
};

type CatalogRow = {
  catalogKey: string;
  categorySlug: string;
  categoryName: string;
  brand: string;
  model: string;
  displayName: string;
  calculationMethod: string | null;
  ratedPowerW: number | null;
  annualEnergyKwh: number | null;
  energyPerCycleKwh: number | null;
  loadFactor: number | null;
  usageProfile: string | null;
  capacityValue: number | null;
  capacityUnit: string | null;
  efficiencyLabel: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedAt: number | null;
  confidence: CalculationConfidence;
};

type CountRow = { total: number };
type CategoryRow = { slug: string; name: string; count: number };

function escapedLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function energySpec(row: CatalogRow): ApplianceEnergySpec {
  const required = (value: number | null, column: string) => {
    if (value === null) throw new Error(`Active catalog row ${row.catalogKey} is missing ${column}`);
    return value;
  };
  switch (row.calculationMethod) {
    case 'rated_power':
      return {
        calculationMethod: 'rated_power',
        ratedPowerW: required(row.ratedPowerW, 'rated_power_w'),
        loadFactor: row.loadFactor,
      };
    case 'annual_energy':
      return { calculationMethod: 'annual_energy', annualEnergyKwh: required(row.annualEnergyKwh, 'annual_energy_kwh') };
    case 'per_cycle':
      return { calculationMethod: 'per_cycle', energyPerCycleKwh: required(row.energyPerCycleKwh, 'energy_per_cycle_kwh') };
    default:
      throw new Error(`Active catalog row ${row.catalogKey} has an invalid calculation_method`);
  }
}

function usageProfile(row: CatalogRow): UsageProfileId {
  if (typeof row.usageProfile !== 'string' || !Object.hasOwn(usageProfiles, row.usageProfile)) {
    throw new Error(`Active catalog row ${row.catalogKey} has an invalid usage_profile`);
  }
  return row.usageProfile as UsageProfileId;
}

function detail(row: CatalogRow) {
  return [
    row.capacityValue === null ? null : `${row.capacityValue}${row.capacityUnit ? ` ${row.capacityUnit}` : ''}`,
    row.efficiencyLabel,
  ].filter((value): value is string => Boolean(value)).join(' · ');
}

function mapRow(row: CatalogRow): Appliance {
  const spec = energySpec(row);
  const usageProfileId = usageProfile(row);
  return {
    id: row.catalogKey,
    category: row.categoryName,
    categorySlug: row.categorySlug,
    brand: row.brand,
    model: row.model,
    name: row.displayName,
    detail: detail(row),
    watts: row.calculationMethod === 'rated_power' ? row.ratedPowerW : null,
    energySpec: spec,
    usageProfileId,
    image: imageForCategory(row.categorySlug),
    capacityValue: row.capacityValue,
    capacityUnit: row.capacityUnit,
    efficiencyLabel: row.efficiencyLabel,
    source: {
      name: row.sourceName,
      url: row.sourceUrl,
      verifiedAt: row.verifiedAt,
      confidence: row.confidence,
    },
  };
}

function filters(query: CatalogQuery) {
  const clauses = ['m.is_active = 1'];
  const bindings: unknown[] = [];
  if (query.category) {
    clauses.push('c.slug = ?');
    bindings.push(query.category);
  }
  if (query.q) {
    clauses.push(`(
      b.name LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR m.model_code LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR m.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR (COALESCE(CAST(m.capacity_value AS TEXT), '') || ' ' || COALESCE(m.capacity_unit, '') || ' ' || COALESCE(m.efficiency_label, '')) LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    const value = `%${escapedLike(query.q)}%`;
    bindings.push(value, value, value, value);
  }
  return { where: clauses.join(' AND '), bindings };
}

async function all<T>(db: D1Database, sql: string, bindings: unknown[] = []) {
  return (await db.prepare(sql).bind(...bindings).all<T>()).results;
}

export async function readCatalog(db: D1Database, query: CatalogQuery): Promise<CatalogResponse> {
  const { where, bindings } = filters(query);
  const [countRows, itemRows, categoryRows] = await Promise.all([
    all<CountRow>(db, `
      SELECT COUNT(*) AS total
      FROM appliance_models m
      JOIN categories c ON c.id = m.category_id
      JOIN brands b ON b.id = m.brand_id
      WHERE ${where}
    `, bindings),
    all<CatalogRow>(db, `
      SELECT m.catalog_key AS catalogKey, c.slug AS categorySlug, c.name_th AS categoryName,
        b.name AS brand, m.model_code AS model, m.display_name AS displayName,
        m.calculation_method AS calculationMethod, m.rated_power_w AS ratedPowerW,
        m.annual_energy_kwh AS annualEnergyKwh, m.energy_per_cycle_kwh AS energyPerCycleKwh,
        m.load_factor AS loadFactor, m.usage_profile AS usageProfile,
        m.capacity_value AS capacityValue, m.capacity_unit AS capacityUnit,
        m.efficiency_label AS efficiencyLabel, m.source_url AS sourceUrl,
        m.source_name AS sourceName, m.verified_at AS verifiedAt, m.confidence AS confidence
      FROM appliance_models m
      JOIN categories c ON c.id = m.category_id
      JOIN brands b ON b.id = m.brand_id
      WHERE ${where}
      ORDER BY m.sort_order, c.id, b.name COLLATE NOCASE, m.model_code COLLATE NOCASE, m.catalog_key
      LIMIT ? OFFSET ?
    `, [...bindings, query.pageSize, (query.page - 1) * query.pageSize]),
    all<CategoryRow>(db, `
      SELECT c.slug, c.name_th AS name, COUNT(m.id) AS count
      FROM categories c
      JOIN appliance_models m ON m.category_id = c.id AND m.is_active = 1
      GROUP BY c.id, c.slug, c.name_th
      HAVING COUNT(m.id) > 0
      ORDER BY c.id, c.slug COLLATE NOCASE
    `),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
  return {
    items: itemRows.map(mapRow),
    categories: categoryRows.map((row) => ({ ...row, count: Number(row.count), image: imageForCategory(row.slug) })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasMore: query.page < totalPages,
    },
  };
}

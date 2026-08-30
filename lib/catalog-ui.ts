import type { CatalogCategory, CatalogResponse } from './catalog-repository.ts';
import type { Appliance } from './home-config.ts';
import type { ApplianceEnergySpec } from './energy.ts';

const PAGE_SIZE = 24;

export type CatalogUiState = {
  items: Appliance[];
  categories: CatalogCategory[];
  pagination: CatalogResponse['pagination'];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
};

export type CatalogUiAction =
  | { type: 'reset' }
  | { type: 'request'; append: boolean }
  | { type: 'success'; response: CatalogResponse; append: boolean }
  | { type: 'failure'; append: boolean; message: string };

const emptyPagination: CatalogResponse['pagination'] = {
  page: 0,
  pageSize: PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasMore: false,
};

export const initialCatalogState: CatalogUiState = {
  items: [],
  categories: [],
  pagination: emptyPagination,
  loading: true,
  loadingMore: false,
  error: null,
  loadMoreError: null,
};

export function buildCatalogUrl({ q, category, page }: { q: string; category: string | null; page: number }) {
  const params = new URLSearchParams();
  const trimmedQuery = q.trim();
  if (trimmedQuery) params.set('q', trimmedQuery);
  if (category) params.set('category', category);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  return `/api/catalog?${params.toString()}`;
}

export function isCatalogQueryReady(query: string, debouncedQuery: string) {
  return query.trim() === debouncedQuery;
}

function localized(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

export function formatCatalogEnergySpec(spec: ApplianceEnergySpec) {
  switch (spec.calculationMethod) {
    case 'rated_power':
      return { value: localized(Math.round(spec.ratedPowerW), 0), unit: 'W' };
    case 'annual_energy':
      return { value: localized(spec.annualEnergyKwh, 2), unit: 'kWh/year' };
    case 'per_cycle':
      return { value: localized(spec.energyPerCycleKwh, 2), unit: 'kWh/cycle' };
  }
}

function appendUnique(current: Appliance[], incoming: Appliance[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })];
}

export function catalogReducer(state: CatalogUiState, action: CatalogUiAction): CatalogUiState {
  switch (action.type) {
    case 'reset':
      return {
        ...state,
        items: [],
        pagination: emptyPagination,
        loading: true,
        loadingMore: false,
        error: null,
        loadMoreError: null,
      };
    case 'request':
      return {
        ...state,
        loading: !action.append,
        loadingMore: action.append,
        error: action.append ? state.error : null,
        loadMoreError: null,
      };
    case 'success':
      return {
        items: action.append ? appendUnique(state.items, action.response.items) : action.response.items,
        categories: action.response.categories,
        pagination: action.response.pagination,
        loading: false,
        loadingMore: false,
        error: null,
        loadMoreError: null,
      };
    case 'failure':
      return {
        ...state,
        loading: false,
        loadingMore: false,
        error: action.append ? state.error : action.message,
        loadMoreError: action.append ? action.message : null,
      };
  }
}

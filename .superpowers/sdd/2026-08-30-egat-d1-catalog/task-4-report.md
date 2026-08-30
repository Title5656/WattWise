# Task 4 report: D1 catalog repository and API

## Delivered

- Added `lib/catalog-repository.ts` for active D1 catalog reads, escaped case-insensitive search, exact category filtering, separate counts, stable pagination, and metadata category counts.
- Added `GET /api/catalog` through a thin route adapter with validated `q`, `category`, `page`, and `pageSize` parameters.
- Added public `CatalogResponse` and category types, shared generic category image mapping with a fallback, and API model mapping that preserves the energy discriminator and nullable non-rated-power wattage.
- Extended `Appliance` metadata for catalog source/display fields while safely handling nullable watts in existing consumers.
- Added deterministic D1-shaped SQLite API tests covering defaults, active-only reads, search, literal wildcard escaping, exact/unknown categories, bounds, stable paging, images/counts, energy mapping, and unavailable D1 errors.

## TDD evidence

- RED: `npm test -- tests/catalog-api.test.mjs` failed with eight expected assertions because `createCatalogGetHandler` did not exist.
- GREEN: `node --experimental-strip-types --test tests/catalog-api.test.mjs` passed 8/8 after the minimal repository, handler, and route implementation.

## Verification

- `node --experimental-strip-types --test tests/catalog-api.test.mjs` — 8 passed.
- `npm test` — 89 passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `git diff --check` — passed.

## Review

Self-review found no blocking issues. The schema has no separate category sort-order column, so the stable database category position (`c.id`) is used as the category tie-breaker after `m.sort_order`; the seeded category creation order is deterministic.

## Review-fix round 1

- Updated the deterministic fixture so `usage_profile` is nullable like production, then added null and unknown profile regression cases.
- Changed catalog row decoding to reject null/unknown `usage_profile` values and null/unknown `calculation_method` values. Invalid rows now follow the controlled internal-error path and never invent a profile or rated-power specification.
- Captured and asserted the expected error log in all malformed-D1 tests, restoring `console.error` in `finally`; the focused test output is now pristine.

### TDD evidence

- RED: `node --experimental-strip-types --test tests/catalog-api.test.mjs` passed 8/10 and failed the two new malformed-row cases with `200 !== 500`.
- GREEN: the same focused command passed 10/10 after explicit decoding guards were added.
